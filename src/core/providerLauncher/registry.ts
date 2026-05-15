import type {
  ProviderConfig,
  ProviderId,
  ProviderLaunchCommand,
  ProviderWorkspaceConfig,
  ProviderWorkspaceOverride,
} from "./types.js";
import {
  getDefaultRouteModel,
  getProviderRuntime,
  isProviderRoutableInCodexa,
} from "../providerRuntime/registry.js";

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
    backendType: "Codex CLI",
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
    backendType: "Claude Code",
    routeMode: "launch-only",
    enabled: true,
    launchCommand: { executable: "claude", args: [] },
    isActiveRoute: false,
    routeUnavailableReason: "Anthropic in-Codexa routing is not configured yet.",
  },
  google: {
    id: "google",
    displayName: "Google",
    currentModel: () => "gemini-3.1-pro",
    backendType: "Gemini CLI",
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
    backendType: "LM Studio/Ollama",
    routeMode: "launch-only",
    enabled: false,
    launchCommand: null,
    isActiveRoute: false,
    routeUnavailableReason: "Local in-Codexa routing is not configured yet.",
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
    ? override.enabled
    : provider.id === "local" && hasConfiguredCommand && nextCommand !== null
      ? true
      : provider.enabled;

  return {
    ...provider,
    currentModel: typeof override.currentModel === "string" && override.currentModel.trim()
      ? override.currentModel.trim()
      : provider.currentModel,
    enabled: nextEnabled,
    launchCommand: nextCommand,
    statusLabel: nextEnabled ? "Enabled" : "Disabled",
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
}): ProviderConfig[] {
  const defaultProviderId = getDefaultProviderId(options.workspaceConfig);
  const activeRouteProviderId = getActiveRouteProviderId(options.workspaceConfig);

  return PROVIDER_ORDER.map((id) => {
    const defaults = DEFAULT_PROVIDERS[id];
    const provider: ProviderConfig = {
      id,
      displayName: defaults.displayName,
      currentModel: options.workspaceConfig?.activeRoute?.providerId === id
        ? options.workspaceConfig.activeRoute.modelId
        : getDefaultRouteModel(id, defaults.currentModel(options.activeModel)),
      backendType: defaults.backendType,
      routeMode: getProviderRuntime(id).routeAvailable ? "in-codexa" : "launch-only",
      enabled: defaults.enabled,
      statusLabel: defaults.enabled ? "Enabled" : "Disabled",
      launchCommand: defaults.launchCommand ? { ...defaults.launchCommand, args: [...defaults.launchCommand.args] } : null,
      isDefault: id === defaultProviderId,
      isActiveRoute: id === activeRouteProviderId,
      routeUnavailableReason: getProviderRuntime(id).routeAvailable ? null : getProviderRuntime(id).routeStatus,
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
