import type { ResolvedRuntimeConfig } from "../../config/runtimeConfig.js";
import type { BackendProvider } from "../providers/types.js";
import type { ProviderWorkspaceConfig } from "../providerLauncher/types.js";
import type { LocalHarnessSessionMetadata, NativeSessionReference } from "../workspace/conversationStore.js";
import type { ProviderRoute } from "./types.js";
import { getProviderRuntime } from "./registry.js";

/** Common adapter for interactive and non-interactive requests. */
export function createRoutedProvider(
  route: ProviderRoute,
  backend: BackendProvider,
  config: ProviderWorkspaceConfig,
  localHarnessSession?: () => LocalHarnessSessionMetadata | undefined,
  nativeSessions?: () => readonly NativeSessionReference[] | undefined,
): BackendProvider {
  const override = config.providers?.[route.providerId];
  if (route.providerId === "openai") return {
    ...backend,
    run: backend.run ? (prompt, options, handlers) => backend.run!(prompt, {
      ...options,
      runtime: override?.codexCommandPath ? { ...options.runtime, codexCommandPath: override.codexCommandPath } : options.runtime,
    }, handlers) : undefined,
  };
  const provider = getProviderRuntime(route.providerId);
  return {
    id: backend.id, label: provider.label, description: provider.routeStatus,
    authState: provider.routeAvailable ? "delegated" : "coming-soon",
    authLabel: provider.routeAvailable ? "Configured" : "Not configured",
    statusMessage: provider.routeStatus, supportsModels: (model) => model === route.modelId,
    run: provider.run ? (prompt, options, handlers) => provider.run!({
      prompt, route, runtime: effectiveProviderRuntime(options.runtime, config, route),
      workspaceRoot: options.workspaceRoot, projectInstructions: options.projectInstructions,
      promptPolicy: options.promptPolicy,
      claudeCommandPath: override?.claudeCommandPath,
      antigravityCommandPath: override?.antigravityCommandPath,
      nativeSessions: nativeSessions?.(),
      localConfig: route.providerId === "local" ? override : undefined,
      runIntent: options.runIntent, conversationHistory: options.conversationHistory,
      localContextCheckpoint: options.localContextCheckpoint, imageAttachments: options.imageAttachments,
      localHarnessSession: route.providerId === "local" ? localHarnessSession?.() : undefined,
    }, handlers) : undefined,
  };
}
export function effectiveProviderRuntime(runtime: ResolvedRuntimeConfig, config: ProviderWorkspaceConfig, route: ProviderRoute): ResolvedRuntimeConfig {
  const override = config.providers?.[route.providerId];
  return {
    ...runtime, model: route.modelId, reasoningLevel: (route.reasoning ?? runtime.reasoningLevel) as ResolvedRuntimeConfig["reasoningLevel"],
    ...(override?.geminiCommandPath ? { geminiCommandPath: override.geminiCommandPath } : {}),
    ...(override?.codexCommandPath ? { codexCommandPath: override.codexCommandPath } : {}),
  };
}
