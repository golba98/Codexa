import type { ResolvedRuntimeConfig } from "../../config/runtimeConfig.js";
import {
  getCodexModelCapabilities,
  isVerifiedCodexModelCapabilities,
} from "../models/codexModelCapabilities.js";
import {
  loadCachedProviderModels,
  loadSeededOpenAiModels,
  saveCachedProviderModels,
} from "../models/modelCache.js";
import { type CatalogContext, providerCatalog } from "../models/modelCatalog.js";
import { resolveCatalogModel } from "../models/modelSelection.js";
import { reconcileReasoning } from "../models/reasoningControl.js";
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
  refreshModels: async ({ providerConfig, signal }) => {
    const capabilities = await getCodexModelCapabilities({
      forceRefresh: true,
      executable: providerConfig?.codexCommandPath,
      signal,
    });
    const verified = isVerifiedCodexModelCapabilities(capabilities);
    return {
      status: "ready",
      providerId: "openai",
      backendKind: "codex-cli-auth",
      freshness: verified ? "verified" : "unverified",
      models: capabilities.models
        .filter((model) => !model.hidden)
        .map((model) => ({
          id: model.id,
          modelId: model.model,
          label: model.label,
          description: model.description,
          defaultReasoningLevel: model.defaultReasoningLevel,
          supportedReasoningLevels: model.supportedReasoningLevels,
          source: verified ? "discovered" : "fallback",
        })),
      message:
        capabilities.error ??
        (verified
          ? undefined
          : "Cached Codex inventory is unverified after live discovery failed."),
    };
  },
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
  const snapshot = providerCatalog.get(providerId);
  if (snapshot) return snapshot;
  const result = getProviderRuntime(providerId).discoverModels();
  const hasRuntimeModels = result.models.some(
    (model) => model.source && model.source !== "fallback",
  );
  if (result.status === "ready" && !hasRuntimeModels) {
    const cached = loadCachedProviderModels(providerId);
    if (cached) {
      return {
        ...result,
        models: cached.models,
        freshness: "unverified",
        refreshState: "cached",
        verifiedAt: cached.discoveredAt,
      };
    }
  }
  return result;
}

const persistedDiscovery = new WeakSet<ProviderModelDiscoveryResult>();
export function persistProviderDiscovery(discovery: ProviderModelDiscoveryResult): void {
  if (persistedDiscovery.has(discovery)) return;
  const runtimeModels = discovery.models.filter(
    (model) => model.source && model.source !== "fallback",
  );
  if (
    discovery.status !== "ready" ||
    discovery.freshness === "unverified" ||
    discovery.diagnostics?.refreshFailed === true
  ) {
    return;
  }
  if (!runtimeModels.length && discovery.freshness !== "verified") return;
  saveCachedProviderModels(discovery.providerId, {
    discoveredAt: discovery.verifiedAt ?? Date.now(),
    models: runtimeModels,
  });
  persistedDiscovery.add(discovery);
}

export async function refreshProviderModels(
  providerId: ProviderId,
  context: CatalogContext,
): Promise<ProviderModelDiscoveryResult> {
  const result = await providerCatalog.refresh(getProviderRuntime(providerId), context);
  if (providerCatalog.get(providerId) === result) persistProviderDiscovery(result);
  return result;
}

export async function validateProviderRouteActivation(options: {
  providerConfig?: ProviderWorkspaceOverride;
  route: ProviderRoute;
  workspaceRoot: string;
  geminiCommandPath?: string | null;
  claudeCommandPath?: string | null;
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

export function resolveActiveProviderRoute(options: {
  workspaceConfigActiveRoute?: ProviderActiveRoute;
  currentModel: string;
  currentReasoning: string;
}): ActiveProviderRoute {
  const configuredRoute = options.workspaceConfigActiveRoute;
  if (configuredRoute && isProviderRoutableInUbume(configuredRoute.providerId)) {
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

    if (route.providerId === "google") {
      route.modelId = normalizeGeminiModelId(route.modelId);
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
        ? (prompt, options, handlers) => {
            const catalog = discoverProviderModels("openai");
            if (
              catalog.freshness === "verified" &&
              !resolveCatalogModel(catalog.models, route.modelId)
            ) {
              handlers.onError(
                `The selected model ${route.modelId} is unavailable. Select a model explicitly before sending.`,
              );
              return () => undefined;
            }
            return backend.run!(
              prompt,
              {
                ...options,
                runtime: override?.codexCommandPath
                  ? { ...options.runtime, codexCommandPath: override.codexCommandPath }
                  : options.runtime,
              },
              {
                ...handlers,
                onError: (message) => {
                  handlers.onError(message);
                  if (
                    /model.{0,80}(?:not found|unavailable|removed|does not exist|invalid)/i.test(
                      message,
                    )
                  )
                    void refreshProviderModels("openai", {
                      cwd: options.workspaceRoot,
                      providerConfig: override,
                      forceRefresh: true,
                    });
                },
              },
            );
          }
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
      ? (prompt, options, handlers) => {
          const catalog = discoverProviderModels(route.providerId);
          if (
            catalog.freshness === "verified" &&
            !resolveCatalogModel(catalog.models, route.modelId)
          ) {
            handlers.onError(
              `The selected model ${route.modelId} is unavailable. Select a model explicitly before sending.`,
            );
            return () => undefined;
          }
          const descriptor = resolveCatalogModel(catalog.models, route.modelId);
          // Old Vibe aliases can collide with newer API IDs. Require an explicit
          // native selection before changing their historical execution target.
          if (
            route.providerId === "mistral" &&
            override?.currentModel === route.modelId &&
            override?.models?.[route.modelId]?.reasoningPreference === undefined &&
            catalog.models.some((model) => {
              const raw = model.raw as { vibeAliases?: unknown } | null;
              return (
                model.modelId !== route.modelId &&
                Array.isArray(raw?.vibeAliases) &&
                raw.vibeAliases.includes(route.modelId)
              );
            }) &&
            catalog.models.some((model) => model.modelId === route.modelId)
          ) {
            handlers.onError(
              `The saved Vibe alias ${route.modelId} is ambiguous with an API model ID. Select a model explicitly before sending.`,
            );
            return () => undefined;
          }
          const requested =
            route.reasoning ?? override?.models?.[route.modelId]?.reasoningPreference ?? "";
          const effectiveReasoning = descriptor?.reasoningControl
            ? reconcileReasoning(descriptor.reasoningControl, requested)
            : descriptor?.supportedReasoningLevels?.some((level) => level.id === requested)
              ? requested
              : (descriptor?.defaultReasoningLevel ?? "");
          return provider.run!(
            {
              prompt,
              route: { ...route, reasoning: effectiveReasoning || undefined },
              providerConfig: override,
              modelDescriptor: descriptor,
              runtime: effectiveProviderRuntime(options.runtime, config, route),
              workspaceRoot: options.workspaceRoot,
              projectInstructions: options.projectInstructions,
              promptPolicy: options.promptPolicy,
              claudeCommandPath: override?.claudeCommandPath,
              nativeSessions: nativeSessions?.(),
              localConfig: route.providerId === "local" ? override : undefined,
              runIntent: options.runIntent,
              conversationHistory: options.conversationHistory,
              localContextCheckpoint: options.localContextCheckpoint,
              imageAttachments: options.imageAttachments,
              localHarnessSession:
                route.providerId === "local" ? localHarnessSession?.() : undefined,
            },
            {
              ...handlers,
              onError: (message) => {
                handlers.onError(message);
                if (
                  /model.{0,80}(?:not found|not available|unavailable|removed|does not exist|invalid)|(?:not found|unavailable).{0,80}model/i.test(
                    message,
                  )
                ) {
                  void refreshProviderModels(route.providerId, {
                    cwd: options.workspaceRoot,
                    providerConfig: override,
                    localConfig: route.providerId === "local" ? override : undefined,
                    forceRefresh: true,
                  });
                }
              },
            },
          );
        }
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
    default:
      return { installCommand: null, setupCommand: "" };
  }
}
