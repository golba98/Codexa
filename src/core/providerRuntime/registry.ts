import { codexSubprocessProvider } from "../providers/codexSubprocess.js";
import type { BackendRunHandlers } from "../providers/types.js";
import type { ProviderId, ProviderActiveRoute } from "../providerLauncher/types.js";
import { anthropicRuntime } from "./anthropic.js";
import { geminiRuntime } from "./gemini.js";
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
  discoverModels: () => ({
    status: "ready",
    providerId: "openai",
    backendKind: "codex-cli-auth",
    models: [],
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
  local: unavailableRuntime("local", "Local"),
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
  return getProviderRuntime(providerId).discoverModels();
}

export async function validateProviderRouteActivation(options: {
  route: ProviderRoute;
  workspaceRoot: string;
  geminiCommandPath?: string | null;
  claudeCommandPath?: string | null;
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
  if (configuredRoute && isProviderRoutableInCodexa(configuredRoute.providerId)) {
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
    return ANTHROPIC_FALLBACK_MODELS[0]?.modelId ?? "claude-sonnet-4-20250514";
  }
  if (providerId === "google") {
    return GEMINI_FALLBACK_MODELS[0]?.modelId ?? GEMINI_DEFAULT_MODEL_ID;
  }
  return currentOpenAiModel;
}
