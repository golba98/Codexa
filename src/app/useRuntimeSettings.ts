import { useCallback } from "react";

import type { LaunchArgs } from "../config/launchArgs.js";
import { type LayeredConfigResult, resolveLayeredConfig } from "../config/layeredConfig.js";

import {
  diffRuntimeConfig,
  mergeRuntimeConfig,
  type PartialRuntimeConfig,
  type RuntimeConfig,
} from "../config/runtimeConfig.js";

import type {
  LocalBackendId,
  ProviderId,
  ProviderWorkspaceConfig,
} from "../core/providerLauncher/types.js";
import {
  saveProviderWorkspaceConfig,
  setProviderActiveRoute,
  setProviderDefaultModel,
  setProviderDefaultReasoning,
} from "../core/providerLauncher/workspaceConfig.js";

import { getProviderRuntime } from "../core/providerRuntime/registry.js";

import type { GeminiModelSelection, ProviderRoute } from "../core/providerRuntime/types.js";

import { errorMessage } from "../core/shared/values.js";

import type { ConversationRecord } from "../core/workspace/conversationStore.js";

interface UseRuntimeSettingsContext {
  workspaceRoot: string;
  launchArgs: LaunchArgs;
  baseRuntimeConfigRef: React.RefObject<RuntimeConfig>;
  setBaseLayeredConfig: React.Dispatch<React.SetStateAction<LayeredConfigResult>>;
  setSessionRuntimeOverride: React.Dispatch<React.SetStateAction<PartialRuntimeConfig>>;
  providerWorkspaceConfig: ProviderWorkspaceConfig;
  setConversationRouteOverride: React.Dispatch<React.SetStateAction<ProviderRoute | null>>;
  routeChoiceRequiredRef: React.RefObject<string | null>;
  activeConversationRef: React.RefObject<ConversationRecord | null>;
  setProviderWorkspaceConfig: React.Dispatch<React.SetStateAction<ProviderWorkspaceConfig>>;
  appendEvent: (type: "system" | "error", title: string, content: string) => void;
}

export function useRuntimeSettings(context: UseRuntimeSettingsContext) {
  const {
    workspaceRoot,
    launchArgs,
    baseRuntimeConfigRef,
    setBaseLayeredConfig,
    setSessionRuntimeOverride,
    providerWorkspaceConfig,
    setConversationRouteOverride,
    routeChoiceRequiredRef,
    activeConversationRef,
    setProviderWorkspaceConfig,
    appendEvent,
  } = context;

  const reloadBaseLayeredConfig = useCallback(() => {
    const nextConfig = resolveLayeredConfig({ workspaceRoot, launchArgs });
    baseRuntimeConfigRef.current = nextConfig.runtime;
    setBaseLayeredConfig(nextConfig);
    return nextConfig;
  }, [launchArgs, workspaceRoot]);

  const updateRuntimeConfig = useCallback((updater: (current: RuntimeConfig) => RuntimeConfig) => {
    setSessionRuntimeOverride((currentPatch) => {
      const baseRuntime = baseRuntimeConfigRef.current;
      const currentRuntime = mergeRuntimeConfig(baseRuntime, currentPatch);
      const nextRuntime = updater(currentRuntime);
      return diffRuntimeConfig(baseRuntime, nextRuntime);
    });
  }, []);

  const updateRuntimePolicy = useCallback(
    (updater: (current: RuntimeConfig["policy"]) => RuntimeConfig["policy"]) => {
      updateRuntimeConfig((current) => ({
        ...current,
        policy: updater(current.policy),
      }));
    },
    [updateRuntimeConfig],
  );

  const persistActiveRoute = useCallback(
    (
      providerId: ProviderId,
      nextModel: string,
      nextReasoning: string,
      backendKindOverride?: ReturnType<typeof getProviderRuntime>["backendKind"],
      modelSelection?: GeminiModelSelection,
      localBackend?: LocalBackendId,
    ) => {
      try {
        const runtime = getProviderRuntime(providerId);
        let nextConfig = setProviderActiveRoute(providerWorkspaceConfig, {
          providerId,
          modelId: nextModel,
          backendKind: backendKindOverride ?? runtime.backendKind,
          reasoning: nextReasoning,
          modelSelection,
          ...(providerId === "local"
            ? {
                localBackend:
                  localBackend ??
                  providerWorkspaceConfig.providers?.local?.localBackend ??
                  "lm-studio",
              }
            : {}),
        });
        nextConfig = setProviderDefaultReasoning(
          setProviderDefaultModel(nextConfig, providerId, nextModel),
          providerId,
          nextReasoning,
        );
        saveProviderWorkspaceConfig(workspaceRoot, nextConfig);
        setConversationRouteOverride(null);
        routeChoiceRequiredRef.current = null;
        const current = activeConversationRef.current;
        if (current && nextConfig.activeRoute)
          activeConversationRef.current = {
            ...current,
            metadata: { ...current.metadata, ...nextConfig.activeRoute },
          };
        setProviderWorkspaceConfig(nextConfig);
      } catch (error) {
        const message = errorMessage(error, "Unable to save active route.");
        appendEvent("error", "Route save failed", message);
      }
    },
    [appendEvent, providerWorkspaceConfig, workspaceRoot],
  );

  const persistProviderDefaultModelAndReasoning = useCallback(
    (providerId: ProviderId, modelId: string, nextReasoning: string) => {
      try {
        const withModel = setProviderDefaultModel(providerWorkspaceConfig, providerId, modelId);
        const nextConfig = setProviderDefaultReasoning(withModel, providerId, nextReasoning);
        saveProviderWorkspaceConfig(workspaceRoot, nextConfig);
        setProviderWorkspaceConfig(nextConfig);
      } catch (error) {
        const message = errorMessage(error, "Unable to save provider defaults.");
        appendEvent("error", "Provider defaults save failed", message);
      }
    },
    [appendEvent, providerWorkspaceConfig, workspaceRoot],
  );
  return {
    reloadBaseLayeredConfig,
    updateRuntimeConfig,
    updateRuntimePolicy,
    persistActiveRoute,
    persistProviderDefaultModelAndReasoning,
  };
}
