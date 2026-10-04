import { useCallback } from "react";
import type { LaunchArgs } from "../config/launchArgs.js";
import { saveRuntimeModePreference } from "../config/persistence.js";
import type { RuntimeConfig } from "../config/runtimeConfig.js";
import {
  type AvailableMode,
  type AvailableModel,
  formatModeLabel,
  formatReasoningLabel,
  getNextRotatingMode,
  type ReasoningLevel,
} from "../config/settings.js";
import type { CodexModelCapability } from "../core/models/codexModelCapabilities.js";
import {
  type CodexModelCapabilities,
  findModelCapability,
  normalizeReasoningForModelCapabilities,
} from "../core/models/codexModelCapabilities.js";
import { traceInputDebug } from "../core/perf/debugLog.js";
import type {
  LocalBackendId,
  ProviderConfig,
  ProviderId,
  ProviderWorkspaceConfig,
} from "../core/providerLauncher/types.js";

import { providerModelsToCodexCapabilities } from "../core/providerRuntime/models.js";
import {
  discoverProviderModels,
  getProviderRouteSetupMessage,
  getProviderRuntime,
  validateProviderRouteActivation,
} from "../core/providerRuntime/registry.js";

import type {
  GeminiModelSelection,
  ProviderRoute,
  RuntimeAvailability,
} from "../core/providerRuntime/types.js";

import { errorMessage } from "../core/shared/values.js";

import { type PlanFlowState, resetPlanFlow } from "../session/planFlow.js";

import type { Screen } from "../session/types.js";

interface UseModelSelectionContext {
  updateRuntimeConfig: (updater: (current: RuntimeConfig) => RuntimeConfig) => void;
  setScreen: React.Dispatch<React.SetStateAction<Screen>>;
  appendEvent: (type: "system" | "error", title: string, content: string) => void;
  busy: boolean;
  mode: "suggest" | "auto-edit" | "full-auto";
  planMode: boolean;
  setPlanFlow: React.Dispatch<React.SetStateAction<PlanFlowState>>;
  routeChoiceRequiredRef: React.RefObject<string | null>;
  currentModelCapability: CodexModelCapability | null;
  model: string;
  launchArgs: LaunchArgs;
  providerWorkspaceConfig: ProviderWorkspaceConfig;
  activeProviderRoute: ProviderRoute;
  persistProviderDefaultModelAndReasoning: (
    providerId: ProviderId,
    modelId: string,
    nextReasoning: string,
  ) => void;
  persistActiveRoute: (
    providerId: ProviderId,
    nextModel: string,
    nextReasoning: string,
    backendKindOverride?: ReturnType<typeof getProviderRuntime>["backendKind"],
    modelSelection?: GeminiModelSelection,
    localBackend?: LocalBackendId,
  ) => void;
  modelSelectionInFlightRef: React.RefObject<boolean>;
  getInputDebugSnapshot: (extra?: Record<string, unknown>) => {
    screen: Screen;
    mode: "model-picker" | "chat/input";
    modelPickerOpen: boolean;
    composerEnabled: boolean;
    inputLocked: boolean;
    busy: boolean;
    modelLoading: boolean;
    modelSelection: boolean;
    focusTarget: string;
    stdin: Record<string, unknown>;
  };
  reasoningLevel: string;
  activeRouteModelCapabilities: CodexModelCapabilities | null;
  workspaceRoot: string;
  runtimeConfig: RuntimeConfig;
  activeRouteProvider: ProviderConfig;
  returnToChatMode: (reason?: string) => void;
  modelCapabilities: CodexModelCapabilities | null;
  setPendingRouteProviderId: React.Dispatch<React.SetStateAction<ProviderId | null>>;
  setRouteSwitchBusy: React.Dispatch<React.SetStateAction<boolean>>;
  markProviderAvailability: (
    providerId: ProviderId,
    availability: RuntimeAvailability,
    reason: string,
  ) => void;
  providerDiagnosticsRef: React.RefObject<
    Record<string, Record<string, string | number | boolean | null>>
  >;
  setRegistryNonce: React.Dispatch<React.SetStateAction<number>>;
  providerRouteErrorsRef: React.RefObject<Record<string, string>>;
  modelPickerOpenRef: React.RefObject<boolean>;
}

export function useModelSelection(context: UseModelSelectionContext) {
  const {
    updateRuntimeConfig,
    setScreen,
    appendEvent,
    busy,
    mode,
    planMode,
    setPlanFlow,
    routeChoiceRequiredRef,
    currentModelCapability,
    model,
    launchArgs,
    providerWorkspaceConfig,
    activeProviderRoute,
    persistProviderDefaultModelAndReasoning,
    persistActiveRoute,
    modelSelectionInFlightRef,
    getInputDebugSnapshot,
    reasoningLevel,
    activeRouteModelCapabilities,
    workspaceRoot,
    runtimeConfig,
    activeRouteProvider,
    returnToChatMode,
    modelCapabilities,
    setPendingRouteProviderId,
    setRouteSwitchBusy,
    markProviderAvailability,
    providerDiagnosticsRef,
    setRegistryNonce,
    providerRouteErrorsRef,
    modelPickerOpenRef,
  } = context;

  const setModeWithNotice = useCallback(
    (nextMode: AvailableMode) => {
      updateRuntimeConfig((current) => ({
        ...current,
        mode: nextMode,
        planMode: false,
      }));
      saveRuntimeModePreference(nextMode, false);
      setScreen("main");
      appendEvent(
        "system",
        "Mode updated",
        `Execution mode switched to ${formatModeLabel(nextMode)}.`,
      );
    },
    [appendEvent, busy, updateRuntimeConfig],
  );

  const cycleModeWithNotice = useCallback(() => {
    const next = getNextRotatingMode(mode, planMode);
    updateRuntimeConfig((current) => ({
      ...current,
      mode: next.mode,
      planMode: next.planMode,
    }));
    saveRuntimeModePreference(next.mode, next.planMode);
    if (!next.planMode) {
      setPlanFlow(resetPlanFlow());
    }
  }, [appendEvent, busy, mode, planMode, updateRuntimeConfig]);

  const setReasoningWithNotice = useCallback(
    (nextReasoningLevel: ReasoningLevel) => {
      if (routeChoiceRequiredRef.current) {
        appendEvent("error", "Select a route first", routeChoiceRequiredRef.current);
        return;
      }
      const supported = currentModelCapability?.supportedReasoningLevels;
      if (supported && !supported.some((item) => item.id === nextReasoningLevel)) {
        appendEvent(
          "error",
          "Reasoning unavailable",
          `${model} does not advertise ${formatReasoningLabel(nextReasoningLevel)} reasoning in the detected Codex runtime.`,
        );
        return;
      }

      updateRuntimeConfig((current) => ({
        ...current,
        reasoningLevel: nextReasoningLevel,
      }));
      // When --model was given on the CLI the active route's modelId reflects that CLI arg,
      // not what is stored in providers.json. Persist the stored model so the CLI-only
      // override is never written permanently; fall back to activeProviderRoute.modelId when
      // no CLI model is active (normal interactive case).
      const modelToPersist = launchArgs.modelOverride
        ? (providerWorkspaceConfig.activeRoute?.modelId ?? activeProviderRoute.modelId)
        : activeProviderRoute.modelId;
      if (activeProviderRoute.providerId === "openai") {
        persistProviderDefaultModelAndReasoning("openai", modelToPersist, nextReasoningLevel);
      } else {
        persistActiveRoute(
          activeProviderRoute.providerId,
          modelToPersist,
          nextReasoningLevel,
          activeProviderRoute.backendKind,
          activeProviderRoute.modelSelection,
        );
      }
      setScreen("main");
      appendEvent(
        "system",
        "Reasoning updated",
        `Reasoning level is now ${formatReasoningLabel(nextReasoningLevel)}.`,
      );
    },
    [
      activeProviderRoute.backendKind,
      activeProviderRoute.modelId,
      activeProviderRoute.modelSelection,
      activeProviderRoute.providerId,
      appendEvent,
      appendEvent,
      busy,
      currentModelCapability,
      launchArgs.modelOverride,
      model,
      persistActiveRoute,
      persistProviderDefaultModelAndReasoning,
      providerWorkspaceConfig.activeRoute,
      updateRuntimeConfig,
    ],
  );

  const setPlanModeWithNotice = useCallback(
    (nextEnabled: boolean) => {
      updateRuntimeConfig((current) => ({
        ...current,
        planMode: nextEnabled,
      }));
      saveRuntimeModePreference(mode, nextEnabled);
      if (!nextEnabled) {
        setPlanFlow(resetPlanFlow());
      }
      appendEvent("system", "Plan mode", `Plan mode ${nextEnabled ? "enabled" : "disabled"}.`);
    },
    [appendEvent, busy, mode, updateRuntimeConfig],
  );

  const togglePlanModeWithNotice = useCallback(() => {
    setPlanModeWithNotice(!planMode);
  }, [planMode, setPlanModeWithNotice]);

  const setModelWithNotice = useCallback(
    async (nextModel: AvailableModel) => {
      modelSelectionInFlightRef.current = true;
      traceInputDebug(
        "model_selection_app_start",
        getInputDebugSnapshot({
          handler: "setModelWithNotice",
          model: nextModel,
        }),
      );

      try {
        const routeProviderId = activeProviderRoute.providerId;
        const normalizedReasoning = normalizeReasoningForModelCapabilities(
          nextModel,
          reasoningLevel,
          activeRouteModelCapabilities,
        );
        const validation = await validateProviderRouteActivation({
          route: {
            providerId: routeProviderId,
            modelId: nextModel,
            backendKind: getProviderRuntime(routeProviderId).backendKind,
            reasoning: normalizedReasoning,
          },
          workspaceRoot,
          geminiCommandPath:
            providerWorkspaceConfig.providers?.google?.geminiCommandPath ??
            runtimeConfig.geminiCommandPath,
          claudeCommandPath: providerWorkspaceConfig.providers?.anthropic?.claudeCommandPath,
          localConfig: providerWorkspaceConfig.providers?.local,
        });
        if (validation.status !== "ready") {
          appendEvent(
            "system",
            "Provider route unavailable",
            `${validation.message ?? getProviderRouteSetupMessage(routeProviderId)} Previous active route remains ${activeRouteProvider?.displayName ?? "OpenAI"} / ${activeProviderRoute.modelId}.`,
          );
          return;
        }
        updateRuntimeConfig((current) => ({
          ...current,
          model: nextModel,
          reasoningLevel: normalizeReasoningForModelCapabilities(
            nextModel,
            current.reasoningLevel,
            activeRouteModelCapabilities,
          ),
        }));
        persistActiveRoute(routeProviderId, nextModel, normalizedReasoning, validation.backendKind);
        traceInputDebug(
          "model_selection_app_success",
          getInputDebugSnapshot({
            handler: "setModelWithNotice",
            model: nextModel,
          }),
        );
        appendEvent(
          "system",
          "Model updated",
          `Active model is now ${nextModel}. Reasoning set to ${formatReasoningLabel(normalizedReasoning)}.`,
        );
      } catch (error) {
        const message = errorMessage(error);
        traceInputDebug(
          "model_selection_app_failure",
          getInputDebugSnapshot({
            handler: "setModelWithNotice",
            model: nextModel,
            error: message,
          }),
        );
        appendEvent("error", "Model selection failed", message);
      } finally {
        modelSelectionInFlightRef.current = false;
        returnToChatMode("selection");
      }
    },
    [
      activeProviderRoute.modelId,
      activeProviderRoute.providerId,
      activeRouteModelCapabilities,
      activeRouteProvider,
      appendEvent,
      appendEvent,
      busy,
      getInputDebugSnapshot,
      persistActiveRoute,
      providerWorkspaceConfig.providers,
      reasoningLevel,
      returnToChatMode,
      runtimeConfig.geminiCommandPath,
      updateRuntimeConfig,
      workspaceRoot,
    ],
  );

  const setModelAndReasoningWithNotice = useCallback(
    async (
      nextModel: AvailableModel,
      nextReasoning: ReasoningLevel,
      providerId: ProviderId = activeProviderRoute.providerId,
      geminiSelection?: GeminiModelSelection,
      localBackend?: LocalBackendId,
    ) => {
      const routeCapabilities =
        providerId === "openai"
          ? modelCapabilities
          : providerModelsToCodexCapabilities(discoverProviderModels(providerId).models, nextModel);
      const selectedCapability = findModelCapability(routeCapabilities, nextModel);
      const supported = selectedCapability?.supportedReasoningLevels;
      if (
        supported &&
        supported.length > 0 &&
        !supported.some((item) => item.id === nextReasoning)
      ) {
        appendEvent(
          "error",
          "Reasoning unavailable",
          `${nextModel} does not advertise ${formatReasoningLabel(nextReasoning)} reasoning in the detected Codex runtime.`,
        );
        returnToChatMode("selection-invalid");
        return;
      }

      modelSelectionInFlightRef.current = true;
      // Reflect the target provider in the model picker immediately: route
      // validation below can take seconds (subprocess probes), and until it
      // persists the new active route, modelPickerProviderId would otherwise
      // keep resolving to the stale route.
      setPendingRouteProviderId(providerId);
      setRouteSwitchBusy(true);
      traceInputDebug(
        "model_selection_app_start",
        getInputDebugSnapshot({
          handler: "setModelAndReasoningWithNotice",
          model: nextModel,
          reasoning: nextReasoning,
        }),
      );

      try {
        const normalizedReasoning = normalizeReasoningForModelCapabilities(
          nextModel,
          nextReasoning,
          routeCapabilities,
        );
        let validation;
        try {
          if (providerId === "local") {
            markProviderAvailability("local", "checking", "provider-validation");
          }
          validation = await validateProviderRouteActivation({
            route: {
              providerId,
              modelId: nextModel,
              backendKind: getProviderRuntime(providerId).backendKind,
              reasoning: normalizedReasoning,
              modelSelection: geminiSelection,
              ...(providerId === "local"
                ? {
                    localBackend:
                      localBackend ??
                      providerWorkspaceConfig.providers?.local?.localBackend ??
                      "lm-studio",
                  }
                : {}),
            },
            workspaceRoot,
            geminiCommandPath:
              providerWorkspaceConfig.providers?.google?.geminiCommandPath ??
              runtimeConfig.geminiCommandPath,
            claudeCommandPath: providerWorkspaceConfig.providers?.anthropic?.claudeCommandPath,
            localConfig:
              providerId === "local"
                ? {
                    ...providerWorkspaceConfig.providers?.local,
                    localBackend:
                      localBackend ??
                      providerWorkspaceConfig.providers?.local?.localBackend ??
                      "lm-studio",
                  }
                : providerWorkspaceConfig.providers?.local,
          });
          if (validation.diagnostics) {
            providerDiagnosticsRef.current[providerId] = validation.diagnostics as Record<
              string,
              string | number | boolean | null
            >;
          }
          setRegistryNonce((n) => n + 1);
        } finally {
          // Runtime status is rendered from provider diagnostics; no title guard is active here.
        }
        if (validation.status !== "ready") {
          traceInputDebug(
            "model_selection_app_failure",
            getInputDebugSnapshot({
              handler: "setModelAndReasoningWithNotice",
              model: nextModel,
              reasoning: nextReasoning,
              error: validation.message ?? getProviderRouteSetupMessage(providerId),
            }),
          );
          const routeError = validation.message ?? getProviderRouteSetupMessage(providerId);
          if (providerRouteErrorsRef.current[providerId] !== routeError) {
            appendEvent(
              "system",
              "Provider route unavailable",
              `${routeError} Previous active route remains ${activeRouteProvider?.displayName ?? "OpenAI"} / ${activeProviderRoute.modelId}.`,
            );
            providerRouteErrorsRef.current[providerId] = routeError;
          }
          if (!modelPickerOpenRef.current) setPendingRouteProviderId(null);
          return;
        }

        if (providerRouteErrorsRef.current[providerId]) {
          appendEvent(
            "system",
            "Provider route available",
            validation.message ??
              (providerId === "google"
                ? "Google/Gemini is available via Gemini CLI."
                : providerId === "anthropic"
                  ? "Anthropic/Claude is available via Claude Code."
                  : `${getProviderRuntime(providerId).label} is available via ${validation.backendKind}.`),
          );
          delete providerRouteErrorsRef.current[providerId];
        }

        updateRuntimeConfig((current) => ({
          ...current,
          model: nextModel,
          reasoningLevel: normalizedReasoning,
        }));
        persistActiveRoute(
          providerId,
          nextModel,
          normalizedReasoning,
          validation.backendKind,
          geminiSelection,
          localBackend,
        );
        if (!modelPickerOpenRef.current) setPendingRouteProviderId(null);
        traceInputDebug(
          "model_selection_app_success",
          getInputDebugSnapshot({
            handler: "setModelAndReasoningWithNotice",
            model: nextModel,
            reasoning: normalizedReasoning,
          }),
        );

        // Route changes are reflected reactively in the BottomComposer metadata row.
      } catch (error) {
        const message = errorMessage(error);
        traceInputDebug(
          "model_selection_app_failure",
          getInputDebugSnapshot({
            handler: "setModelAndReasoningWithNotice",
            model: nextModel,
            reasoning: nextReasoning,
            error: message,
          }),
        );
        if (!modelPickerOpenRef.current) setPendingRouteProviderId(null);
        appendEvent("error", "Model selection failed", message);
      } finally {
        setRouteSwitchBusy(false);
        modelSelectionInFlightRef.current = false;
        returnToChatMode("selection");
      }
    },
    [
      activeProviderRoute.modelId,
      activeProviderRoute.providerId,
      activeRouteProvider,
      appendEvent,
      appendEvent,
      busy,
      getInputDebugSnapshot,
      markProviderAvailability,
      modelCapabilities,
      persistActiveRoute,
      providerWorkspaceConfig.providers,
      returnToChatMode,
      runtimeConfig.geminiCommandPath,
      updateRuntimeConfig,
      workspaceRoot,
    ],
  );
  return {
    setModeWithNotice,
    cycleModeWithNotice,
    setReasoningWithNotice,
    setPlanModeWithNotice,
    togglePlanModeWithNotice,
    setModelWithNotice,
    setModelAndReasoningWithNotice,
  };
}
