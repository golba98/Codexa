export type ProviderId = "openai" | "anthropic" | "google" | "local";

export type ProviderBackendType =
  | "codex-cli-auth"
  | "gemini-cli-auth"
  | "claude-code-auth"
  | "openai-api-key"
  | "gemini-api-key"
  | "anthropic-api-key"
  | "local-openai-compatible"
  | "unavailable";

export type ProviderLaunchAction = "launch" | "set-default" | "cancel";
export type ProviderRouteAction = "use-in-codexa" | "select-model" | "refresh-models";
export type ProviderPickerAction = ProviderLaunchAction | ProviderRouteAction;
export type ProviderRouteMode = "in-codexa" | "launch-only";

export interface ProviderLaunchCommand {
  executable: string;
  args: string[];
}

export interface ProviderConfig {
  id: ProviderId;
  displayName: string;
  currentModel: string;
  backendType: ProviderBackendType;
  routeMode: ProviderRouteMode;
  enabled: boolean;
  statusLabel: string;
  launchCommand: ProviderLaunchCommand | null;
  isDefault: boolean;
  isActiveRoute: boolean;
  routeUnavailableReason: string | null;
}

export interface ProviderWorkspaceConfig {
  workspaceDefaultProviderId?: ProviderId;
  activeRoute?: ProviderActiveRoute;
  providers?: Partial<Record<ProviderId, ProviderWorkspaceOverride>>;
}

export interface ProviderActiveRoute {
  providerId: ProviderId;
  modelId: string;
  backendKind?: import("../providerRuntime/types.js").ProviderBackendKind;
  reasoning?: string;
  modelSelection?: import("../providerRuntime/types.js").GeminiModelSelection;
}

export interface ProviderWorkspaceOverride {
  currentModel?: string;
  enabled?: boolean;
  command?: string | ProviderLaunchCommand | null;
}
