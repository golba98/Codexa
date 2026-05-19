import type {
  ProviderConfig,
  ProviderId,
  ProviderBackendType,
  ProviderLaunchCommand,
  ProviderWorkspaceConfig,
  ProviderWorkspaceOverride,
} from "./types.js";
import { DEFAULT_MODEL } from "../../config/settings.js";
import {
  getDefaultRouteModel,
  getProviderRouteSetupMessage,
  getProviderRuntime,
  isProviderRoutableInCodexa,
  isProviderRouteConfigured,
} from "../providerRuntime/registry.js";
import { normalizeGeminiModelId } from "../providerRuntime/models.js";
import { setLocalProviderConfig } from "../providerRuntime/local.js";
import { formatContextLength, resolveModelContextLengthCached } from "../providerRuntime/contextMetadata.js";
import { resolveModelCapabilityProfileCached } from "../providerRuntime/capabilityProfile.js";

const PROVIDER_ORDER: readonly ProviderId[] = ["openai", "anthropic", "google", "local"];

const DEFAULT_PROVIDER_ID: ProviderId = "openai";

type ProviderDefault = Omit<ProviderConfig, "currentModel" | "enabled" | "statusLabel" | "launchCommand" | "isDefault"> & {
  currentModel: (activeModel: string) => string;
  enabled: boolean;
  launchCommand: ProviderLaunchCommand | null;
};

const DEFAULT_PROVIDERS: Record<ProviderId, ProviderDefault> = {
  openai: {
    id: "openai",
    displayName: "OpenAI",
    currentModel: (activeModel) => activeModel,
    backendType: "codex-cli-auth",
    routeMode: "in-codexa",
    enabled: true,
    launchCommand: { executable: "codex", args: [] },
    isActiveRoute: false,
    routeUnavailableReason: null,
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    currentModel: () => "Claude Code default",
    backendType: "claude-code-auth",
    routeMode: "in-codexa",
    enabled: true,
    launchCommand: { executable: "claude", args: [] },
    isActiveRoute: false,
    routeUnavailableReason: null,
  },
  google: {
    id: "google",
    displayName: "Google",
    currentModel: () => "gemini-3-flash-preview",
    backendType: "gemini-cli-auth",
    routeMode: "in-codexa",
    enabled: true,
    launchCommand: { executable: "gemini", args: [] },
    isActiveRoute: false,
    routeUnavailableReason: null,
  },
  local: {
    id: "local",
    displayName: "Local",
    currentModel: () => "Local default",
    backendType: "local-openai-compatible",
    routeMode: "in-codexa",
    enabled: false,
    launchCommand: null,
    isActiveRoute: false,
    routeUnavailableReason: "Local provider unavailable. Start LM Studio, load a model, and enable the local server.",
  },
};

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_ORDER.includes(value as ProviderId);
}

function normalizeLaunchCommand(value: ProviderWorkspaceOverride["command"] | undefined): ProviderLaunchCommand | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const executable = value.trim();
    return executable ? { executable, args: [] } : null;
  }
  if (typeof value.executable !== "string") return undefined;
  const executable = value.executable.trim();
  if (!executable) return null;
  return {
    executable,
    args: Array.isArray(value.args)
      ? value.args.filter((arg): arg is string => typeof arg === "string")
      : [],
  };
}

function applyOverride(
  provider: ProviderConfig,
  override: ProviderWorkspaceOverride | undefined,
): ProviderConfig {
  if (!override) return provider;

  const launchCommand = normalizeLaunchCommand(override.command);
  const hasConfiguredCommand = launchCommand !== undefined;
  const nextCommand = hasConfiguredCommand ? launchCommand : provider.launchCommand;
  const nextEnabled = typeof override.enabled === "boolean"
    ? provider.id === "local" ? provider.enabled && override.enabled : override.enabled
    : provider.enabled;

  const overrideModel = typeof override.currentModel === "string" && override.currentModel.trim()
    ? override.currentModel.trim()
    : null;

  return {
    ...provider,
    currentModel: overrideModel && provider.id !== "local"
      ? provider.id === "google" ? normalizeGeminiModelId(overrideModel) : overrideModel
      : provider.currentModel,
    enabled: nextEnabled,
    launchCommand: nextCommand,
    statusLabel: nextEnabled
      ? (provider.routeUnavailableReason ? "Needs config" : "Enabled")
      : "Disabled",
  };
}

export function getDefaultProviderId(config: ProviderWorkspaceConfig | null | undefined): ProviderId {
  return isProviderId(config?.workspaceDefaultProviderId) ? config.workspaceDefaultProviderId : DEFAULT_PROVIDER_ID;
}

export function getActiveRouteProviderId(config: ProviderWorkspaceConfig | null | undefined): ProviderId {
  const providerId = config?.activeRoute?.providerId;
  return isProviderId(providerId) && isProviderRoutableInCodexa(providerId)
    ? providerId
    : DEFAULT_PROVIDER_ID;
}

export function buildProviderRegistry(options: {
  activeModel: string;
  workspaceConfig?: ProviderWorkspaceConfig | null;
  diagnostics?: Record<string, Record<string, string | number | boolean | null>>;
  routeErrors?: Record<string, string>;
}): ProviderConfig[] {
  const defaultProviderId = getDefaultProviderId(options.workspaceConfig);
  const activeRouteProviderId = getActiveRouteProviderId(options.workspaceConfig);

  return PROVIDER_ORDER.map((id) => {
    if (id === "local") {
      setLocalProviderConfig(options.workspaceConfig?.providers?.local);
    }
    const defaults = DEFAULT_PROVIDERS[id];
    const runtime = getProviderRuntime(id);
    const discovery = runtime.discoverModels();

    const activeRoute = options.workspaceConfig?.activeRoute;
    const isThisActive = activeRoute?.providerId === id;

    let currentModelLabel = isThisActive && activeRoute
      ? activeRoute.modelId
      : getDefaultRouteModel(id, id === "openai" ? DEFAULT_MODEL : defaults.currentModel(options.activeModel));

    if (id === "google") {
      // Use the active route's model selection when this provider is active, or when
      // the workspace config has no explicit Google model override.
      const hasGoogleOverride = options.workspaceConfig?.providers?.google?.currentModel !== undefined;
      const geminiRoute = isThisActive || !hasGoogleOverride ? activeRoute : null;
      const selection = geminiRoute?.modelSelection;
      if (selection) {
        if (selection.kind === "auto") {
          currentModelLabel = `Auto (${selection.family === "gemini-3" ? "Gemini 3" : "Gemini 2.5"})`;
        } else {
          currentModelLabel = normalizeGeminiModelId(selection.modelId);
        }
      } else {
        currentModelLabel = normalizeGeminiModelId(currentModelLabel);
      }
    }

    if (id === "local") {
      const selectedModel = typeof discovery.diagnostics?.selectedModel === "string" && discovery.diagnostics.selectedModel.trim()
        ? discovery.diagnostics.selectedModel.trim()
        : discovery.models[0]?.modelId;
      if (selectedModel) {
        currentModelLabel = selectedModel;
      }
    }

    const rawMetadataForModel = discovery.models.find((model) => model.modelId === currentModelLabel)?.raw;
    const contextMetadata = resolveModelContextLengthCached({
      providerId: id,
      modelId: currentModelLabel,
      providerConfig: options.workspaceConfig?.providers?.[id],
      rawMetadata: rawMetadataForModel,
    });
    const contextSource = contextMetadata.source === "known-registry" ? "registry" : contextMetadata.source;
    const capabilityProfile = resolveModelCapabilityProfileCached({
      providerId: id,
      modelId: currentModelLabel,
      providerConfig: options.workspaceConfig?.providers?.[id],
      rawMetadata: rawMetadataForModel,
    });

    const routeUnavailableReason: string | null = runtime.routeAvailable
      ? (isProviderRouteConfigured(id) ? null : (options.routeErrors?.[id] ?? discovery.message ?? getProviderRouteSetupMessage(id)))
      : runtime.routeStatus;

    const enabled = id === "local" ? discovery.status === "ready" : defaults.enabled;

    const statusLabel = id === "local"
      ? (discovery.status === "ready" ? "Enabled" : "Disabled")
      : !defaults.enabled
        ? "Disabled"
        : routeUnavailableReason
          ? "Needs config"
          : "Enabled";

    const provider: ProviderConfig = {
      id,
      displayName: defaults.displayName,
      currentModel: currentModelLabel,
      contextLengthLabel: formatContextLength(contextMetadata.contextLength),
      contextLengthSource: contextSource,
      capabilityProfile,
      backendType: discovery.backendKind as ProviderBackendType,
      routeMode: runtime.routeAvailable ? "in-codexa" : "launch-only",
      enabled,
      statusLabel,
      launchCommand: defaults.launchCommand ? { ...defaults.launchCommand, args: [...defaults.launchCommand.args] } : null,
      isDefault: id === defaultProviderId,
      isActiveRoute: id === activeRouteProviderId,
      routeUnavailableReason,
      routeDiagnostics: options.diagnostics?.[id],
    };

    return applyOverride(provider, options.workspaceConfig?.providers?.[id]);
  });
}

export function findProvider(providers: readonly ProviderConfig[], providerId: ProviderId): ProviderConfig | null {
  return providers.find((provider) => provider.id === providerId) ?? null;
}

export function isKnownProviderId(value: string): value is ProviderId {
  return isProviderId(value);
}
