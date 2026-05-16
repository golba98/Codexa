import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { normalizeWorkspaceRoot } from "../workspaceRoot.js";
import { isKnownProviderId } from "./registry.js";
import { getProviderRuntime, isProviderRouteConfigured, isProviderRoutableInCodexa } from "../providerRuntime/registry.js";
import type {
  ProviderActiveRoute,
  ProviderId,
  ProviderLaunchCommand,
  ProviderWorkspaceConfig,
  ProviderWorkspaceOverride,
} from "./types.js";

export function getProviderWorkspaceConfigFile(workspaceRoot: string): string {
  return join(normalizeWorkspaceRoot(workspaceRoot), ".codexa", "providers.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLaunchCommand(value: unknown): ProviderWorkspaceOverride["command"] | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  if (typeof value.executable !== "string") return undefined;
  return {
    executable: value.executable,
    args: Array.isArray(value.args)
      ? value.args.filter((arg): arg is string => typeof arg === "string")
      : [],
  };
}

function parseProviderOverride(value: unknown): ProviderWorkspaceOverride | undefined {
  if (!isRecord(value)) return undefined;
  const override: ProviderWorkspaceOverride = {};

  if (typeof value.currentModel === "string") {
    override.currentModel = value.currentModel;
  } else if (typeof value.current_model === "string") {
    override.currentModel = value.current_model;
  }

  if (typeof value.currentReasoning === "string") {
    override.currentReasoning = value.currentReasoning;
  } else if (typeof value.current_reasoning === "string") {
    override.currentReasoning = value.current_reasoning;
  }

  if (typeof value.enabled === "boolean") {
    override.enabled = value.enabled;
  }

  const command = parseLaunchCommand(value.command);
  if (command !== undefined) {
    override.command = command;
  }

  const claudeCommandPath = value.claudeCommandPath ?? value.claude_command_path;
  if (typeof claudeCommandPath === "string" && claudeCommandPath.trim()) {
    override.claudeCommandPath = claudeCommandPath.trim();
  }

  return override;
}

function parseActiveRoute(value: unknown): ProviderActiveRoute | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = value.providerId ?? value.provider_id;
  const modelId = value.modelId ?? value.model_id;
  const backendKind = value.backendKind ?? value.backend_kind;
  const reasoning = value.reasoning;
  const modelSelection = value.modelSelection ?? value.model_selection;

  if (typeof providerId !== "string" || !isKnownProviderId(providerId) || !isProviderRoutableInCodexa(providerId)) return undefined;
  if (typeof modelId !== "string" || !modelId.trim()) return undefined;

  return {
    providerId,
    modelId: modelId.trim(),
    backendKind: typeof backendKind === "string" ? getProviderRuntime(providerId).backendKind : getProviderRuntime(providerId).backendKind,
    ...(typeof reasoning === "string" && reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
    ...(isRecord(modelSelection) ? { modelSelection: modelSelection as any } : {}),
  };
}

export function parseProviderWorkspaceConfig(data: unknown): ProviderWorkspaceConfig {
  if (!isRecord(data)) return {};

  const config: ProviderWorkspaceConfig = {};
  const defaultProvider = data.workspaceDefaultProviderId
    ?? data.workspace_default_provider_id
    ?? data.defaultProviderId
    ?? data.default_provider_id;
  if (typeof defaultProvider === "string" && isKnownProviderId(defaultProvider)) {
    config.workspaceDefaultProviderId = defaultProvider;
  }

  const activeRoute = parseActiveRoute(data.activeRoute ?? data.active_route);
  if (activeRoute) {
    config.activeRoute = activeRoute;
  }

  if (isRecord(data.providers)) {
    const providers: Partial<Record<ProviderId, ProviderWorkspaceOverride>> = {};
    for (const [id, value] of Object.entries(data.providers)) {
      if (!isKnownProviderId(id)) continue;
      const override = parseProviderOverride(value);
      if (override) providers[id] = override;
    }
    config.providers = providers;
  }

  return config;
}

function serializeLaunchCommand(command: string | ProviderLaunchCommand | null | undefined): unknown {
  if (command === undefined || command === null || typeof command === "string") {
    return command;
  }
  return {
    executable: command.executable,
    args: command.args,
  };
}

export function serializeProviderWorkspaceConfig(config: ProviderWorkspaceConfig): Record<string, unknown> {
  const providers = Object.fromEntries(
    Object.entries(config.providers ?? {}).map(([id, override]) => [
      id,
      {
        ...(override.currentModel !== undefined ? { current_model: override.currentModel } : {}),
        ...(override.currentReasoning !== undefined ? { current_reasoning: override.currentReasoning } : {}),
        ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
        ...(override.command !== undefined ? { command: serializeLaunchCommand(override.command) } : {}),
        ...(override.claudeCommandPath !== undefined ? { claude_command_path: override.claudeCommandPath } : {}),
      },
    ]),
  );

  return {
    ...(config.workspaceDefaultProviderId ? { workspaceDefaultProviderId: config.workspaceDefaultProviderId } : {}),
    ...(config.activeRoute ? {
      activeRoute: {
        providerId: config.activeRoute.providerId,
        modelId: config.activeRoute.modelId,
        backendKind: config.activeRoute.backendKind ?? getProviderRuntime(config.activeRoute.providerId).backendKind,
        ...(config.activeRoute.reasoning ? { reasoning: config.activeRoute.reasoning } : {}),
        ...(config.activeRoute.modelSelection ? { modelSelection: config.activeRoute.modelSelection } : {}),
      },
    } : {}),
    ...(Object.keys(providers).length > 0 ? { providers } : {}),
  };
}

export function loadProviderWorkspaceConfig(workspaceRoot: string): ProviderWorkspaceConfig {
  const filePath = getProviderWorkspaceConfigFile(workspaceRoot);
  if (!existsSync(filePath)) return {};
  try {
    return parseProviderWorkspaceConfig(JSON.parse(readFileSync(filePath, "utf-8")));
  } catch {
    return {};
  }
}

export function saveProviderWorkspaceConfig(workspaceRoot: string, config: ProviderWorkspaceConfig): void {
  const filePath = getProviderWorkspaceConfigFile(workspaceRoot);
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(serializeProviderWorkspaceConfig(config), null, 2), "utf-8");
  renameSync(tmpFile, filePath);
}

export function setProviderWorkspaceDefault(
  config: ProviderWorkspaceConfig,
  providerId: ProviderId,
): ProviderWorkspaceConfig {
  return {
    ...config,
    workspaceDefaultProviderId: providerId,
  };
}

export function setProviderDefaultModel(
  config: ProviderWorkspaceConfig,
  providerId: ProviderId,
  modelId: string,
): ProviderWorkspaceConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: {
        ...config.providers?.[providerId],
        currentModel: modelId,
      },
    },
  };
}

export function setProviderDefaultReasoning(
  config: ProviderWorkspaceConfig,
  providerId: ProviderId,
  reasoning: string,
): ProviderWorkspaceConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: {
        ...config.providers?.[providerId],
        currentReasoning: reasoning,
      },
    },
  };
}

export function setProviderActiveRoute(
  config: ProviderWorkspaceConfig,
  activeRoute: ProviderActiveRoute,
): ProviderWorkspaceConfig {
  if (!isProviderRoutableInCodexa(activeRoute.providerId) || !isProviderRouteConfigured(activeRoute.providerId)) {
    return config;
  }

  return {
    ...config,
    activeRoute,
  };
}
