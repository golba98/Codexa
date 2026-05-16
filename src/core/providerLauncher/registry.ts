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
    currentModel: () => "gemini-3.1-pro",
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
  diagnostics?: Record<string, Record<string, string | number | boolean | null>>;
  routeErrors?: Record<string, string>;
}): ProviderConfig[] {
  const defaultProviderId = getDefaultProviderId(options.workspaceConfig);
  const activeRouteProviderId = getActiveRouteProviderId(options.workspaceConfig);

  return PROVIDER_ORDER.map((id) => {
    const defaults = DEFAULT_PROVIDERS[id];
    const runtime = getProviderRuntime(id);
    const discovery = runtime.discoverModels();

    const activeRoute = options.workspaceConfig?.activeRoute;
    const isThisActive = activeRoute?.providerId === id;

    let currentModelLabel = isThisActive && activeRoute
      ? activeRoute.modelId
      : getDefaultRouteModel(id, id === "openai" ? DEFAULT_MODEL : defaults.currentModel(options.activeModel));

    if (id === "google") {
      const geminiRoute = isThisActive ? activeRoute : options.workspaceConfig?.providers?.google?.currentModel === undefined ? activeRoute : null;
      const selection = geminiRoute?.modelSelection;
      if (selection) {
        if (selection.kind === "auto") {
          currentModelLabel = `Auto (${selection.family === "gemini-3" ? "Gemini 3" : "Gemini 2.5"})`;
        } else {
          currentModelLabel = selection.modelId;
        }
      }
    }

    const provider: ProviderConfig = {
      id,
      displayName: defaults.displayName,
      currentModel: currentModelLabel,
      backendType: discovery.backendKind as ProviderBackendType,
      routeMode: runtime.routeAvailable ? "in-codexa" : "launch-only",
      enabled: defaults.enabled,
      statusLabel: defaults.enabled ? "Enabled" : "Disabled",
      launchCommand: defaults.launchCommand ? { ...defaults.launchCommand, args: [...defaults.launchCommand.args] } : null,
      isDefault: id === defaultProviderId,
      isActiveRoute: id === activeRouteProviderId,
      routeUnavailableReason: runtime.routeAvailable
        ? (isProviderRouteConfigured(id) ? null : (options.routeErrors?.[id] ?? getProviderRouteSetupMessage(id)))
        : runtime.routeStatus,
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
