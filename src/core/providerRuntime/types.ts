import type { ReasoningEffortCapability } from "../codexModelCapabilities.js";
import type { ProjectInstructions } from "../projectInstructions.js";
import type { BackendRunHandlers } from "../providers/types.js";
import type { ResolvedRuntimeConfig } from "../../config/runtimeConfig.js";
export type { ResolvedRuntimeConfig };
import type { ProviderId } from "../providerLauncher/types.js";

export type ProviderBackendKind =
  | "codex-cli-auth"
  | "gemini-cli-auth"
  | "claude-code-auth"
  | "openai-api-key"
  | "gemini-api-key"
  | "anthropic-api-key"
  | "local-openai-compatible"
  | "unavailable";

export interface ProviderModel {
  id: string;
  modelId: string;
  label: string;
  description: string | null;
  defaultReasoningLevel: string | null;
  supportedReasoningLevels: readonly ReasoningEffortCapability[] | null;
  source?: "discovered" | "claude-code" | "settings" | "config" | "fallback";
  canonicalId?: string;
  family?: string;
  effortSource?: "claude-code" | "settings" | "config" | "fallback";
  effortVerified?: boolean;
}

export interface ProviderModelDiscoveryResult {
  status: "ready" | "not-configured";
  providerId: ProviderId;
  backendKind: ProviderBackendKind;
  models: readonly ProviderModel[];
  message?: string;
  diagnostics?: Record<string, string | number | boolean | null>;
}

export type GeminiModelFamily = "gemini-3" | "gemini-2.5";

export type GeminiModelSelection =
  | { kind: "auto"; family: GeminiModelFamily }
  | { kind: "manual"; modelId: string };

export interface ProviderRoute {
  providerId: ProviderId;
  modelId: string;
  backendKind: ProviderBackendKind;
  reasoning?: string;
  modelSelection?: GeminiModelSelection;
}

export type ActiveProviderRoute = ProviderRoute;

export interface ProviderRouteValidationRequest {
  route: ProviderRoute;
  workspaceRoot: string;
  geminiCommandPath?: string | null;
}

export interface ProviderRouteValidationResult {
  status: "ready" | "not-configured";
  providerId: ProviderId;
  backendKind: ProviderBackendKind;
  message?: string;
  diagnostics?: Record<string, string | number | boolean | null>;
}

export interface ProviderChatRequest {
  prompt: string;
  route: ProviderRoute;
  runtime: ResolvedRuntimeConfig;
  workspaceRoot: string;
  projectInstructions?: ProjectInstructions | null;
}

export interface ProviderChatResponse {
  text: string;
  rawOutput?: string;
}

export interface ProviderRuntime {
  providerId: ProviderId;
  label: string;
  modelPickerLabel?: string;
  backendKind: ProviderBackendKind;
  routeAvailable: boolean;
  routeStatus: string;
  routeSetupMessage?: string;
  launchAvailable: boolean;
  isRouteConfigured?: () => boolean;
  validateRoute?: (request: ProviderRouteValidationRequest) => Promise<ProviderRouteValidationResult>;
  discoverModels: () => ProviderModelDiscoveryResult;
  refreshModels?: (options: { cwd: string }) => Promise<ProviderModelDiscoveryResult>;
  run?: (request: ProviderChatRequest, handlers: BackendRunHandlers) => () => void;
}
