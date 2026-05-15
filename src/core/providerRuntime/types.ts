import type { ReasoningEffortCapability } from "../codexModelCapabilities.js";
import type { ProjectInstructions } from "../projectInstructions.js";
import type { BackendRunHandlers } from "../providers/types.js";
import type { ResolvedRuntimeConfig } from "../../config/runtimeConfig.js";
import type { ProviderId } from "../providerLauncher/types.js";

export type ProviderBackendKind =
  | "codex-cli"
  | "gemini-cli-headless"
  | "google-api"
  | "anthropic-api"
  | "local-openai-compatible"
  | "not-configured";

export interface ProviderModel {
  id: string;
  modelId: string;
  label: string;
  description: string | null;
  defaultReasoningLevel: string | null;
  supportedReasoningLevels: readonly ReasoningEffortCapability[] | null;
}

export interface ProviderModelDiscoveryResult {
  status: "ready" | "not-configured";
  providerId: ProviderId;
  backendKind: ProviderBackendKind;
  models: readonly ProviderModel[];
  message?: string;
}

export interface ProviderRoute {
  providerId: ProviderId;
  modelId: string;
  backendKind: ProviderBackendKind;
  reasoning?: string;
}

export type ActiveProviderRoute = ProviderRoute;

export interface ProviderRouteValidationRequest {
  route: ProviderRoute;
  workspaceRoot: string;
}

export interface ProviderRouteValidationResult {
  status: "ready" | "not-configured";
  providerId: ProviderId;
  backendKind: ProviderBackendKind;
  message?: string;
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
  backendKind: ProviderBackendKind;
  routeAvailable: boolean;
  routeStatus: string;
  routeSetupMessage?: string;
  launchAvailable: boolean;
  isRouteConfigured?: () => boolean;
  validateRoute?: (request: ProviderRouteValidationRequest) => Promise<ProviderRouteValidationResult>;
  discoverModels: () => ProviderModelDiscoveryResult;
  run?: (request: ProviderChatRequest, handlers: BackendRunHandlers) => () => void;
}
