import type { LaunchArgs } from "../config/launchArgs.js";
import { resolveLayeredConfig } from "../config/layeredConfig.js";
import { mergeRuntimeConfig, resolveRuntimeConfig } from "../config/runtimeConfig.js";
import { isKnownProviderId } from "../core/providerLauncher/registry.js";
import { loadProviderWorkspaceConfig } from "../core/providerLauncher/workspaceConfig.js";
import {
  createRoutedProvider,
  effectiveProviderRuntime,
} from "../core/providerRuntime/execution.js";
import {
  getDefaultRouteModel,
  getProviderRuntime,
  isProviderRoutableInUbume,
} from "../core/providerRuntime/registry.js";
import type { ProviderRoute } from "../core/providerRuntime/types.js";
import { getBackendProvider } from "../core/providers/registry.js";
import type { ConversationRecord } from "../core/workspace/conversationStore.js";
import { buildResumedProviderRoute } from "../session/conversation.js";
import { findExecutable, providerExecutable } from "./diagnostics.js";

export class CommandError extends Error {
  constructor(
    message: string,
    readonly exitCode = 3,
    readonly code = "UNAVAILABLE",
  ) {
    super(message);
  }
}
export function resolveExecutionContext(
  workspaceRoot: string,
  launchArgs: LaunchArgs,
  options: { providerId?: string; saved?: ConversationRecord; inspect?: boolean } = {},
) {
  const layered = resolveLayeredConfig({ workspaceRoot, launchArgs });
  const config = loadProviderWorkspaceConfig(workspaceRoot, { readOnly: true });
  const base = resolveRuntimeConfig(mergeRuntimeConfig(layered.runtime, { planMode: false }));
  const selectedId =
    options.providerId ??
    options.saved?.metadata.providerId ??
    config.activeRoute?.providerId ??
    config.workspaceDefaultProviderId ??
    "openai";
  if (!isKnownProviderId(selectedId))
    throw new CommandError(
      `Unknown saved or selected provider: ${selectedId}. Select a supported provider explicitly.`,
    );
  const provider = getProviderRuntime(selectedId);
  if (
    !options.inspect &&
    (selectedId === "google" ||
      !isProviderRoutableInUbume(selectedId) ||
      !provider.run ||
      config.providers?.[selectedId]?.enabled === false)
  ) {
    throw new CommandError(
      `${provider.label} is unavailable for execution. ${provider.routeSetupMessage ?? provider.routeStatus}`,
    );
  }
  if (
    !options.inspect &&
    options.saved?.metadata.providerId === "local" &&
    !options.saved.metadata.localBackend &&
    !options.providerId
  ) {
    throw new CommandError(
      "This older Local chat has no recorded backend. Select a Local backend explicitly before continuing.",
    );
  }
  const savedRoute =
    options.saved && !options.providerId
      ? buildResumedProviderRoute(options.saved.metadata, selectedId, provider.backendKind)
      : undefined;
  const workspaceRoute =
    config.activeRoute?.providerId === selectedId ? config.activeRoute : undefined;
  const override = config.providers?.[selectedId];
  const modelExplicit =
    launchArgs.modelOverride !== null ||
    launchArgs.configOverrides.some((item) => /^model\s*=/.test(item));
  const reasoningExplicit = launchArgs.configOverrides.some((item) =>
    /^model_reasoning_effort\s*=/.test(item),
  );
  const route: ProviderRoute = {
    providerId: selectedId,
    modelId: modelExplicit
      ? base.model
      : (savedRoute?.modelId ??
        workspaceRoute?.modelId ??
        override?.currentModel ??
        getDefaultRouteModel(selectedId, base.model)),
    backendKind: savedRoute?.backendKind ?? provider.backendKind,
    reasoning: reasoningExplicit
      ? base.reasoningLevel
      : (savedRoute?.reasoning ??
        workspaceRoute?.reasoning ??
        override?.currentReasoning ??
        base.reasoningLevel),
    ...(selectedId === "local"
      ? {
          localBackend:
            savedRoute?.localBackend ??
            workspaceRoute?.localBackend ??
            override?.localBackend ??
            "lm-studio",
        }
      : {}),
  };
  const runtime = effectiveProviderRuntime(base, config, route);
  if (!options.inspect) {
    const command =
      selectedId === "openai"
        ? (runtime.codexCommandPath ?? providerExecutable(selectedId, config))
        : providerExecutable(selectedId, config);
    if (
      command &&
      !findExecutable(command, workspaceRoot) &&
      !(selectedId === "anthropic" && process.env.ANTHROPIC_API_KEY?.trim())
    )
      throw new CommandError(
        `${provider.label} executable is unavailable: ${command}. Install it or configure its explicit path.`,
      );
  }
  return {
    layered,
    config,
    route,
    runtime,
    provider: createRoutedProvider(
      route,
      getBackendProvider(runtime.provider),
      config,
      () => options.saved?.metadata.localHarnessSession,
      () => options.saved?.metadata.nativeSessions,
    ),
  };
}
