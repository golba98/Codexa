import type { ResolvedRuntimeConfig } from "../../config/runtimeConfig.js";
import {
  loadCachedProviderModels,
  loadSeededOpenAiModels,
  saveCachedProviderModels,
} from "../models/modelCache.js";
import type {
  ProviderActiveRoute,
  ProviderId,
  ProviderWorkspaceConfig,
  ProviderWorkspaceOverride,
} from "../providerLauncher/types.js";
import { codexSubprocessProvider } from "../providers/codexSubprocess.js";
import type { BackendProvider, BackendRunHandlers } from "../providers/types.js";
import { isLocalDevChannel } from "../version/channel.js";
import type {
  LocalHarnessSessionMetadata,
  NativeSessionReference,
} from "../workspace/conversationStore.js";
import { anthropicRuntime } from "./anthropic.js";
import {
  ANTIGRAVITY_DEFAULT_MODEL_ID,
  antigravityRuntime,
  migrateAntigravityLegacyModelId,
} from "./antigravity.js";
import { CODEXA_NATIVE_MODEL_ID, codexaCupyRuntime, codexaNativeRuntime } from "./codexaNative.js";
import { geminiRuntime } from "./gemini.js";
import { localRuntime } from "./local.js";
import { mistralVibeRuntime } from "./mistralVibe.js";
import {
  ANTHROPIC_FALLBACK_MODELS,
  GEMINI_DEFAULT_MODEL_ID,
  GEMINI_FALLBACK_MODELS,
  normalizeGeminiModelId,
} from "./models.js";
import type {
  ActiveProviderRoute,
  GeminiModelSelection,
  ProviderChatRequest,
  ProviderModelDiscoveryResult,
  ProviderRoute,
  ProviderRouteValidationResult,
  ProviderRuntime,
} from "./types.js";

const openAiRuntime: ProviderRuntime = {
  providerId: "openai",
  label: "OpenAI/Codex",
  backendKind: "codex-cli-auth",
  routeAvailable: true,
  routeStatus: "Uses the configured Codex/OpenAI backend inside Ubume.",
  launchAvailable: true,
  discoverModels: () => ({
    status: "ready",
    providerId: "openai",
    backendKind: "codex-cli-auth",
    models: loadSeededOpenAiModels()?.models ?? [],
  }),
  run: (request: ProviderChatRequest, handlers: BackendRunHandlers) => {
    handlers.onProgress?.({
      id: "openai-route",
      source: "stdout",
      text: "Starting Codex CLI",
    });
    return codexSubprocessProvider.run!(
      request.prompt,
      {
        runtime: request.runtime,
        workspaceRoot: request.workspaceRoot,
        projectInstructions: request.projectInstructions,
        promptPolicy: request.promptPolicy,
        conversationHistory: request.conversationHistory,
        imageAttachments: request.imageAttachments,
      },
      handlers,
    );
  },
};

const PROVIDER_RUNTIMES: Record<ProviderId, ProviderRuntime> = {
  openai: openAiRuntime,
  anthropic: anthropicRuntime,
  google: geminiRuntime,
  mistral: mistralVibeRuntime,
  local: localRuntime,
  "codexa-native": codexaNativeRuntime,
  "codexa-cupy": codexaCupyRuntime,
  antigravity: antigravityRuntime,
};

export function getProviderRuntime(providerId: ProviderId): ProviderRuntime {
  return PROVIDER_RUNTIMES[providerId];
}

export function isProviderRoutableInUbume(
  providerId: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if ((providerId === "codexa-native" || providerId === "codexa-cupy") && !isLocalDevChannel(env)) {
    return false;
  }
  return getProviderRuntime(providerId).routeAvailable;
}

export function isProviderRouteConfigured(
  providerId: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const runtime = getProviderRuntime(providerId);
  return isProviderRoutableInUbume(providerId, env) && (runtime.isRouteConfigured?.() ?? true);
}

export function getProviderRouteSetupMessage(providerId: ProviderId): string {
  const runtime = getProviderRuntime(providerId);
  return runtime.routeSetupMessage ?? runtime.routeStatus;
}

export function discoverProviderModels(providerId: ProviderId): ProviderModelDiscoveryResult {
  const result = getProviderRuntime(providerId).discoverModels();
  const hasRuntimeModels = result.models.some(
    (model) => model.source && model.source !== "fallback",
  );
  if (result.status === "ready" && !hasRuntimeModels) {
    const cached = loadCachedProviderModels(providerId);
    if (cached) {
      return { ...result, models: cached.models };
    }
  }
  return result;
}

export function persistProviderDiscovery(discovery: ProviderModelDiscoveryResult): void {
  const runtimeModels = discovery.models.filter(
    (model) => model.source && model.source !== "fallback",
  );
  if (discovery.status !== "ready" || runtimeModels.length === 0) {
    return;
  }
  saveCachedProviderModels(discovery.providerId, {
    discoveredAt: Date.now(),
    models: runtimeModels,
  });
}

export async function validateProviderRouteActivation(options: {
  route: ProviderRoute;
  workspaceRoot: string;
  geminiCommandPath?: string | null;
  claudeCommandPath?: string | null;
  antigravityCommandPath?: string | null;
  localConfig?: ProviderWorkspaceOverride | null;
}): Promise<ProviderRouteValidationResult> {
  const runtime = getProviderRuntime(options.route.providerId);
  if (!runtime.routeAvailable) {
    return {
      status: "not-configured",
      providerId: options.route.providerId,
      backendKind: "unavailable",
      message: getProviderRouteSetupMessage(options.route.providerId),
    };
  }

  if (runtime.validateRoute) {
    return runtime.validateRoute(options);
  }

  if (!isProviderRouteConfigured(options.route.providerId)) {
    return {
      status: "not-configured",
      providerId: options.route.providerId,
      backendKind: "unavailable",
      message: getProviderRouteSetupMessage(options.route.providerId),
    };
  }

  return {
    status: "ready",
    providerId: options.route.providerId,
    backendKind: runtime.backendKind,
  };
}

function resolveGeminiModelId(selection: GeminiModelSelection): string {
  if (selection.kind === "manual") {
    return normalizeGeminiModelId(selection.modelId);
  }
  if (selection.family === "gemini-3") {
    return "gemini-3-flash-preview";
  }
  if (selection.family === "gemini-2.5") {
    return "gemini-2.5-pro";
  }
  return GEMINI_DEFAULT_MODEL_ID;
}

export function resolveActiveProviderRoute(options: {
  workspaceConfigActiveRoute?: ProviderActiveRoute;
  currentModel: string;
  currentReasoning: string;
}): ActiveProviderRoute {
  const configuredRoute = options.workspaceConfigActiveRoute;
  if (
    configuredRoute &&
    configuredRoute.providerId !== "google" &&
    isProviderRoutableInUbume(configuredRoute.providerId)
  ) {
    const route: ActiveProviderRoute = {
      providerId: configuredRoute.providerId,
      modelId: configuredRoute.modelId,
      backendKind:
        configuredRoute.backendKind ?? getProviderRuntime(configuredRoute.providerId).backendKind,
      ...(configuredRoute.reasoning ? { reasoning: configuredRoute.reasoning } : {}),
      ...(configuredRoute.modelSelection ? { modelSelection: configuredRoute.modelSelection } : {}),
      ...(configuredRoute.providerId === "local"
        ? { localBackend: configuredRoute.localBackend ?? "lm-studio" }
        : {}),
    };

    if (route.providerId === "google" && route.modelSelection) {
      route.modelId = resolveGeminiModelId(route.modelSelection);
    } else if (route.providerId === "google") {
      route.modelId = normalizeGeminiModelId(route.modelId);
    } else if (route.providerId === "anthropic") {
      const discovery = discoverProviderModels("anthropic");
      const stillAvailable = discovery.models.some(
        (model) =>
          model.modelId === route.modelId ||
          model.id === route.modelId ||
          model.canonicalId === route.modelId,
      );
      const hasNonFallbackModels = discovery.models.some((model) => model.source !== "fallback");
      const isKnownShortAlias = ANTHROPIC_FALLBACK_MODELS.some(
        (model) => model.modelId === route.modelId,
      );
      if (
        discovery.status === "ready" &&
        hasNonFallbackModels &&
        discovery.models.length > 0 &&
        !stillAvailable &&
        isKnownShortAlias
      ) {
        route.modelId = discovery.models[0]!.modelId;
      }
    } else if (route.providerId === "antigravity") {
      const migrated = migrateAntigravityLegacyModelId(route.modelId);
      route.modelId = migrated.modelId;
      if (!route.reasoning && migrated.reasoning) {
        route.reasoning = migrated.reasoning;
      }
      const discovery = discoverProviderModels("antigravity");
      if (discovery.status === "ready" && discovery.models.length > 0) {
        let model = discovery.models.find(
          (item) => item.modelId === route.modelId || item.id === route.modelId,
        );
        if (!model) {
          model = discovery.models[0];
          route.modelId = model.modelId;
        }
        const levels = model.supportedReasoningLevels;
        if (
          levels?.length &&
          (!route.reasoning || !levels.some((level) => level.id === route.reasoning))
        ) {
          route.reasoning = model.defaultReasoningLevel ?? levels[0]?.id;
        }
      }
    }

    return route;
  }

  return {
    providerId: "openai",
    modelId: options.currentModel,
    backendKind: "codex-cli-auth",
    reasoning: options.currentReasoning,
  };
}

export function getDefaultRouteModel(providerId: ProviderId, currentOpenAiModel: string): string {
  if (providerId === "anthropic") {
    const discovered = discoverProviderModels("anthropic");
    if (discovered.status === "ready" && discovered.models.length > 0) {
      return discovered.models[0].modelId;
    }
    return ANTHROPIC_FALLBACK_MODELS[0]?.modelId ?? "sonnet";
  }
  if (providerId === "google") {
    return GEMINI_FALLBACK_MODELS[0]?.modelId ?? GEMINI_DEFAULT_MODEL_ID;
  }
  if (providerId === "local") {
    const discovery = discoverProviderModels("local");
    return discovery.models[0]?.modelId ?? "Local default";
  }
  if (providerId === "codexa-native") {
    return CODEXA_NATIVE_MODEL_ID;
  }
  if (providerId === "mistral") {
    const discovery = discoverProviderModels("mistral");
    return discovery.models[0]?.modelId ?? "Vibe default";
  }
  if (providerId === "antigravity") {
    return discoverProviderModels("antigravity").models[0]?.modelId ?? ANTIGRAVITY_DEFAULT_MODEL_ID;
  }
  return currentOpenAiModel;
}

/** Common adapter for interactive and non-interactive requests. */
export function createRoutedProvider(
  route: ProviderRoute,
  backend: BackendProvider,
  config: ProviderWorkspaceConfig,
  localHarnessSession?: () => LocalHarnessSessionMetadata | undefined,
  nativeSessions?: () => readonly NativeSessionReference[] | undefined,
): BackendProvider {
  const override = config.providers?.[route.providerId];
  if (route.providerId === "openai")
    return {
      ...backend,
      run: backend.run
        ? (prompt, options, handlers) =>
            backend.run!(
              prompt,
              {
                ...options,
                runtime: override?.codexCommandPath
                  ? { ...options.runtime, codexCommandPath: override.codexCommandPath }
                  : options.runtime,
              },
              handlers,
            )
        : undefined,
    };
  const provider = getProviderRuntime(route.providerId);
  return {
    id: backend.id,
    label: provider.label,
    description: provider.routeStatus,
    authState: provider.routeAvailable ? "delegated" : "coming-soon",
    authLabel: provider.routeAvailable ? "Configured" : "Not configured",
    statusMessage: provider.routeStatus,
    supportsModels: (model) => model === route.modelId,
    run: provider.run
      ? (prompt, options, handlers) =>
          provider.run!(
            {
              prompt,
              route,
              runtime: effectiveProviderRuntime(options.runtime, config, route),
              workspaceRoot: options.workspaceRoot,
              projectInstructions: options.projectInstructions,
              promptPolicy: options.promptPolicy,
              claudeCommandPath: override?.claudeCommandPath,
              antigravityCommandPath: override?.antigravityCommandPath,
              nativeSessions: nativeSessions?.(),
              localConfig: route.providerId === "local" ? override : undefined,
              runIntent: options.runIntent,
              conversationHistory: options.conversationHistory,
              localContextCheckpoint: options.localContextCheckpoint,
              imageAttachments: options.imageAttachments,
              localHarnessSession:
                route.providerId === "local" ? localHarnessSession?.() : undefined,
            },
            handlers,
          )
      : undefined,
  };
}
export function effectiveProviderRuntime(
  runtime: ResolvedRuntimeConfig,
  config: ProviderWorkspaceConfig,
  route: ProviderRoute,
): ResolvedRuntimeConfig {
  const override = config.providers?.[route.providerId];
  return {
    ...runtime,
    model: route.modelId,
    reasoningLevel: (route.reasoning ??
      runtime.reasoningLevel) as ResolvedRuntimeConfig["reasoningLevel"],
    ...(override?.geminiCommandPath ? { geminiCommandPath: override.geminiCommandPath } : {}),
    ...(override?.codexCommandPath ? { codexCommandPath: override.codexCommandPath } : {}),
  };
}

export function formatRuntimeProviderLabel(providerId: ProviderId): string {
  if (providerId === "local") return "Local";
  if (providerId === "codexa-native" || providerId === "codexa-cupy") return "Codexa Native";
  if (providerId === "google") return "Google";
  if (providerId === "anthropic") return "Anthropic";
  if (providerId === "mistral") return "Mistral Vibe CLI";
  if (providerId === "antigravity") return "Antigravity";
  return "OpenAI";
}

export interface ProviderSetupPlan {
  installCommand: string | null;
  setupCommand: string;
}

export function getProviderSetupPlan(providerId: ProviderId, windows: boolean): ProviderSetupPlan {
  switch (providerId) {
    case "openai":
      return { installCommand: "npm install -g @openai/codex", setupCommand: "codex login" };
    case "anthropic":
      return { installCommand: "npm install -g @anthropic-ai/claude-code", setupCommand: "claude" };
    case "google":
      return { installCommand: "npm install -g @google/gemini-cli", setupCommand: "gemini" };
    case "mistral":
      return windows
        ? {
            installCommand:
              "if (Get-Command uv -ErrorAction SilentlyContinue) { uv tool install mistral-vibe } else { irm https://astral.sh/uv/install.ps1 | iex; uv tool install mistral-vibe }",
            setupCommand: "vibe --setup",
          }
        : {
            installCommand: "curl -LsSf https://mistral.ai/vibe/install.sh | bash",
            setupCommand: "vibe --setup",
          };
    case "antigravity":
      return windows
        ? {
            installCommand: "irm https://antigravity.google/cli/install.ps1 | iex",
            setupCommand: "agy",
          }
        : {
            installCommand: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
            setupCommand: "agy",
          };
    default:
      return { installCommand: null, setupCommand: "" };
  }
}
