import { codexSubprocessProvider } from "../providers/codexSubprocess.js";
import { loadSeededOpenAiModels } from "../models/codexModelsCacheSeed.js";
import { loadCachedProviderModels, saveCachedProviderModels } from "../models/providerModelCache.js";
import type { BackendRunHandlers } from "../providers/types.js";
import type { ProviderId, ProviderActiveRoute, ProviderWorkspaceOverride } from "../providerLauncher/types.js";
import { anthropicRuntime } from "./anthropic.js";
import { geminiRuntime } from "./gemini.js";
import { localRuntime } from "./local.js";
import { antigravityRuntime, ANTIGRAVITY_DEFAULT_MODEL_ID, migrateAntigravityLegacyModelId } from "./antigravity.js";
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
  routeStatus: "Uses the configured Codex/OpenAI backend inside Codexa.",
  launchAvailable: true,
  // Seeded from local caches (codex's own models_cache.json or Codexa's
  // last-good discovery); live app-server discovery refreshes them via
  // getCodexModelCapabilities in the app run loop.
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
      },
      handlers,
    );
  },
};

function unavailableRuntime(providerId: ProviderId, label: string): ProviderRuntime {
  return {
    providerId,
    label,
    backendKind: "unavailable",
    routeAvailable: false,
    routeStatus: `${label} is available as a launcher, but in-Codexa routing is not configured yet.`,
    launchAvailable: providerId !== "local",
    discoverModels: (): ProviderModelDiscoveryResult => ({
      status: "not-configured",
      providerId,
      backendKind: "unavailable",
      models: [],
      message: `${label} is available as a launcher, but in-Codexa routing is not configured yet.`,
    }),
  };
}

const PROVIDER_RUNTIMES: Record<ProviderId, ProviderRuntime> = {
  openai: openAiRuntime,
  anthropic: anthropicRuntime,
  google: geminiRuntime,
  mistral: mistralVibeRuntime,
  local: localRuntime,
  antigravity: antigravityRuntime,
};

export function getProviderRuntime(providerId: ProviderId): ProviderRuntime {
  return PROVIDER_RUNTIMES[providerId];
}

export function isProviderRoutableInCodexa(providerId: ProviderId): boolean {
  return getProviderRuntime(providerId).routeAvailable;
}

export function isProviderRouteConfigured(providerId: ProviderId): boolean {
  const runtime = getProviderRuntime(providerId);
  return runtime.routeAvailable && (runtime.isRouteConfigured?.() ?? true);
}

export function getProviderRouteSetupMessage(providerId: ProviderId): string {
  const runtime = getProviderRuntime(providerId);
  return runtime.routeSetupMessage ?? runtime.routeStatus;
}

export function discoverProviderModels(providerId: ProviderId): ProviderModelDiscoveryResult {
  const result = getProviderRuntime(providerId).discoverModels();
  // When the live/synchronous probe only produced fallback entries (or none),
  // prefer the last-good discovery persisted from a previous session.
  const hasRuntimeModels = result.models.some((model) => model.source && model.source !== "fallback");
  if (result.status === "ready" && !hasRuntimeModels) {
    const cached = loadCachedProviderModels(providerId);
    if (cached) {
      return { ...result, models: cached.models };
    }
  }
  return result;
}

// Persist a ready discovery so the next session starts from last-good models.
export function persistProviderDiscovery(discovery: ProviderModelDiscoveryResult): void {
  const runtimeModels = discovery.models.filter((model) => model.source && model.source !== "fallback");
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

export function resolveGeminiModelId(selection: GeminiModelSelection): string {
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
  if (configuredRoute && configuredRoute.providerId !== "google" && isProviderRoutableInCodexa(configuredRoute.providerId)) {
    const route: ActiveProviderRoute = {
      providerId: configuredRoute.providerId,
      modelId: configuredRoute.modelId,
      backendKind: configuredRoute.backendKind ?? getProviderRuntime(configuredRoute.providerId).backendKind,
      ...(configuredRoute.reasoning ? { reasoning: configuredRoute.reasoning } : {}),
      ...(configuredRoute.modelSelection ? { modelSelection: configuredRoute.modelSelection } : {}),
    };

    if (route.providerId === "google" && route.modelSelection) {
      route.modelId = resolveGeminiModelId(route.modelSelection);
    } else if (route.providerId === "google") {
      route.modelId = normalizeGeminiModelId(route.modelId);
    } else if (route.providerId === "anthropic") {
      const discovery = discoverProviderModels("anthropic");
      const stillAvailable = discovery.models.some((model) =>
        model.modelId === route.modelId ||
        model.id === route.modelId ||
        model.canonicalId === route.modelId
      );
      const hasNonFallbackModels = discovery.models.some((model) => model.source !== "fallback");
      if (discovery.status === "ready" && hasNonFallbackModels && discovery.models.length > 0 && !stillAvailable) {
        route.modelId = discovery.models[0]!.modelId;
      }
    } else if (route.providerId === "local") {
      const discovery = discoverProviderModels("local");
      const selectedModel = typeof discovery.diagnostics?.selectedModel === "string"
        ? discovery.diagnostics.selectedModel.trim()
        : "";
      if (discovery.status === "ready" && selectedModel) {
        route.modelId = selectedModel;
      }
    } else if (route.providerId === "antigravity") {
      const migrated = migrateAntigravityLegacyModelId(route.modelId);
      route.modelId = migrated.modelId;
      if (!route.reasoning && migrated.reasoning) {
        route.reasoning = migrated.reasoning;
      }
      const discovery = discoverProviderModels("antigravity");
      if (discovery.status === "ready" && discovery.models.length > 0) {
        let model = discovery.models.find((item) => item.modelId === route.modelId || item.id === route.modelId);
        if (!model) {
          model = discovery.models[0];
          route.modelId = model.modelId;
        }
        const levels = model.supportedReasoningLevels;
        if (levels?.length && (!route.reasoning || !levels.some((level) => level.id === route.reasoning))) {
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
  if (providerId === "mistral") {
    const discovery = discoverProviderModels("mistral");
    return discovery.models[0]?.modelId ?? "Vibe default";
  }
  if (providerId === "antigravity") {
    return discoverProviderModels("antigravity").models[0]?.modelId ?? ANTIGRAVITY_DEFAULT_MODEL_ID;
  }
  return currentOpenAiModel;
}
