import { useCallback, useEffect } from "react";
import type { RuntimeConfig } from "../config/runtimeConfig.js";

import {
  type CodexAuthProbeResult,
  getAuthStatusMessage,
  probeCodexAuthStatus,
} from "../core/codex/codexAuth.js";

import {
  type CodexModelCapabilities,
  createFallbackModelCapabilities,
  getCodexModelCapabilities,
  getSelectableModelCapabilities,
} from "../core/models/codexModelCapabilities.js";

import { traceInputDebug } from "../core/perf/debugLog.js";

import type { ProviderId, ProviderWorkspaceConfig } from "../core/providerLauncher/types.js";
import {
  saveProviderWorkspaceConfig,
  setProviderActiveRoute,
  setProviderDefaultModel,
} from "../core/providerLauncher/workspaceConfig.js";
import {
  ANTHROPIC_ROUTE_SETUP_MESSAGE,
  validateAnthropicRoute,
} from "../core/providerRuntime/anthropic.js";

import { validateLocalProvider } from "../core/providerRuntime/local.js";

import {
  discoverProviderModels,
  getProviderRuntime,
  persistProviderDiscovery,
} from "../core/providerRuntime/registry.js";
import type { ProviderRoute, RuntimeAvailability } from "../core/providerRuntime/types.js";

import type { BackendProvider } from "../core/providers/types.js";

import { errorMessage } from "../core/shared/values.js";

import type { Screen } from "../session/types.js";

interface UseModelCatalogContext {
  providerOverride: BackendProvider | undefined;
  setModelCapabilities: React.Dispatch<React.SetStateAction<CodexModelCapabilities | null>>;
  modelDiscoveryInFlightRef: React.RefObject<Promise<CodexModelCapabilities> | null>;
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
  modelDiscoveryAnnounceRef: React.RefObject<boolean>;
  setModelCapabilitiesBusy: React.Dispatch<React.SetStateAction<boolean>>;
  appendEvent: (type: "system" | "error", title: string, content: string) => void;
  providerModelsLoadedRef: React.RefObject<Set<ProviderId>>;
  providerModelRefreshesRef: React.RefObject<Map<ProviderId, Promise<unknown>>>;
  setProviderModelLoading: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setProviderModelErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  workspaceRoot: string;
  providerWorkspaceConfig: ProviderWorkspaceConfig;
  setRegistryNonce: React.Dispatch<React.SetStateAction<number>>;
  setAuthStatus: React.Dispatch<React.SetStateAction<CodexAuthProbeResult>>;
  setAuthStatusBusy: React.Dispatch<React.SetStateAction<boolean>>;
  providerDiagnosticsRef: React.RefObject<
    Record<string, Record<string, string | number | boolean | null>>
  >;
  providerRouteErrorsRef: React.RefObject<Record<string, string>>;
  activeProviderRoute: ProviderRoute;
  markProviderAvailability: (
    providerId: ProviderId,
    availability: RuntimeAvailability,
    reason: string,
  ) => void;
  reasoningLevel: string;
  setProviderWorkspaceConfig: React.Dispatch<React.SetStateAction<ProviderWorkspaceConfig>>;
  updateRuntimeConfig: (updater: (current: RuntimeConfig) => RuntimeConfig) => void;
}

export function useModelCatalog(context: UseModelCatalogContext) {
  const {
    providerOverride,
    setModelCapabilities,
    modelDiscoveryInFlightRef,
    getInputDebugSnapshot,
    modelDiscoveryAnnounceRef,
    setModelCapabilitiesBusy,
    appendEvent,
    providerModelsLoadedRef,
    providerModelRefreshesRef,
    setProviderModelLoading,
    setProviderModelErrors,
    workspaceRoot,
    providerWorkspaceConfig,
    setRegistryNonce,
    setAuthStatus,
    setAuthStatusBusy,
    providerDiagnosticsRef,
    providerRouteErrorsRef,
    activeProviderRoute,
    markProviderAvailability,
    reasoningLevel,
    setProviderWorkspaceConfig,
    updateRuntimeConfig,
  } = context;

  const refreshModelCapabilities = useCallback(
    (forceRefresh = false, announce = false): Promise<CodexModelCapabilities> => {
      if (providerOverride) {
        const capabilities = createFallbackModelCapabilities(null);
        setModelCapabilities(capabilities);
        return Promise.resolve(capabilities);
      }
      // Single-flight: concurrent requests share the same in-flight discovery
      // promise so we never spawn a duplicate discovery job or emit duplicate
      // transcript messages.
      if (modelDiscoveryInFlightRef.current && !forceRefresh) {
        traceInputDebug(
          "model_loading_inflight",
          getInputDebugSnapshot({ forceRefresh, announce }),
        );
        if (announce) {
          modelDiscoveryAnnounceRef.current = true;
        }
        return modelDiscoveryInFlightRef.current;
      }

      if (announce) {
        modelDiscoveryAnnounceRef.current = true;
      }

      setModelCapabilitiesBusy(true);
      traceInputDebug("model_loading_start", getInputDebugSnapshot({ forceRefresh, announce }));
      const promise = (async () => {
        try {
          const capabilities = await getCodexModelCapabilities({ forceRefresh });
          setModelCapabilities(capabilities);
          traceInputDebug(
            "model_loading_success",
            getInputDebugSnapshot({
              status: capabilities.status,
              source: capabilities.source,
              modelCount: getSelectableModelCapabilities(capabilities).length,
            }),
          );
          if (capabilities.status === "fallback") {
            traceInputDebug(
              "model_loading_failure",
              getInputDebugSnapshot({
                status: capabilities.status,
                error: capabilities.error,
              }),
            );
          }
          if (modelDiscoveryAnnounceRef.current) {
            const modelCount = getSelectableModelCapabilities(capabilities).length;
            const source =
              capabilities.status === "ready" ? "Codex runtime" : "fallback compatibility list";
            appendEvent("system", "Model discovery", `Loaded ${modelCount} models from ${source}.`);
          }
          return capabilities;
        } catch (error) {
          const fallback = createFallbackModelCapabilities(error);
          setModelCapabilities(fallback);
          traceInputDebug(
            "model_loading_failure",
            getInputDebugSnapshot({
              error: errorMessage(error),
            }),
          );
          if (modelDiscoveryAnnounceRef.current) {
            appendEvent(
              "error",
              "Model discovery failed",
              fallback.error ?? "Unable to discover Codex models.",
            );
          }
          return fallback;
        } finally {
          setModelCapabilitiesBusy(false);
          modelDiscoveryInFlightRef.current = null;
          modelDiscoveryAnnounceRef.current = false;
          traceInputDebug(
            "model_loading_finished",
            getInputDebugSnapshot({ forceRefresh, announce }),
          );
        }
      })();

      modelDiscoveryInFlightRef.current = promise;
      return promise;
    },
    [appendEvent, appendEvent, getInputDebugSnapshot],
  );

  const ensureProviderModels = useCallback(
    (providerId: ProviderId, forceRefresh = false) => {
      if (providerId === "openai") {
        return refreshModelCapabilities(forceRefresh, false);
      }

      const runtime = getProviderRuntime(providerId);
      if (!runtime.refreshModels) {
        return Promise.resolve(null);
      }

      const cached = discoverProviderModels(providerId);
      const hasDiscoveredModels = cached.models.some(
        (item) => item.source && item.source !== "fallback",
      );
      if (
        !forceRefresh &&
        cached.models.length > 0 &&
        (hasDiscoveredModels || providerModelsLoadedRef.current.has(providerId))
      ) {
        return Promise.resolve(cached);
      }

      const existing = providerModelRefreshesRef.current.get(providerId);
      if (existing && !forceRefresh) return existing;

      setProviderModelLoading((current) => ({ ...current, [providerId]: true }));
      setProviderModelErrors((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });

      const promise = runtime
        .refreshModels({
          cwd: workspaceRoot,
          localConfig:
            providerId === "local" ? providerWorkspaceConfig.providers?.local : undefined,
        })
        .then((discovery) => {
          providerModelsLoadedRef.current.add(providerId);
          persistProviderDiscovery(discovery);
          if (discovery.status !== "ready" || discovery.models.length === 0) {
            setProviderModelErrors((current) => ({
              ...current,
              [providerId]: discovery.message ?? `Unable to load ${runtime.label} models.`,
            }));
          }
          setRegistryNonce((current) => current + 1);
          return discovery;
        })
        .catch((error) => {
          const message = errorMessage(error);
          setProviderModelErrors((current) => ({ ...current, [providerId]: message }));
          setRegistryNonce((current) => current + 1);
          return null;
        })
        .finally(() => {
          providerModelRefreshesRef.current.delete(providerId);
          setProviderModelLoading((current) => ({ ...current, [providerId]: false }));
        });

      providerModelRefreshesRef.current.set(providerId, promise);
      return promise;
    },
    [
      persistProviderDiscovery,
      providerWorkspaceConfig.providers,
      refreshModelCapabilities,
      workspaceRoot,
    ],
  );

  const refreshAuthStatus = useCallback(
    async (announce: boolean) => {
      if (providerOverride) {
        setAuthStatus({
          state: "authenticated",
          checkedAt: Date.now(),
          rawSummary: "Embedded runtime",
          recommendedAction: "",
        });
        return;
      }
      setAuthStatusBusy(true);
      setAuthStatus((prev) => ({ ...prev, state: "checking" }));

      try {
        const result = await probeCodexAuthStatus();
        setAuthStatus(result);
        if (announce) {
          appendEvent("system", "Auth status", getAuthStatusMessage(result));
        }
      } catch (error) {
        const message = errorMessage(error, "Unknown auth probe failure");
        const fallback: CodexAuthProbeResult = {
          state: "unknown",
          checkedAt: Date.now(),
          rawSummary: message,
          recommendedAction: "Run `codex login` manually, then retry /auth status.",
        };
        setAuthStatus(fallback);
        if (announce) {
          appendEvent("error", "Auth status probe failed", message);
        }
      } finally {
        setAuthStatusBusy(false);
      }
    },
    [appendEvent, appendEvent],
  );

  useEffect(() => {
    void refreshAuthStatus(false);
  }, []);

  // Probe Anthropic/Claude Code CLI auth at startup so the provider picker
  // shows the correct route availability without requiring manual activation.
  useEffect(() => {
    void (async () => {
      try {
        const result = await validateAnthropicRoute({
          cwd: workspaceRoot,
          configuredPath: providerWorkspaceConfig.providers?.anthropic?.claudeCommandPath,
        });
        if (result.diagnostics) {
          providerDiagnosticsRef.current["anthropic"] = result.diagnostics as Record<
            string,
            string | number | boolean | null
          >;
        }
        if (result.status !== "ready") {
          providerRouteErrorsRef.current["anthropic"] =
            result.message ?? ANTHROPIC_ROUTE_SETUP_MESSAGE;
        } else {
          delete providerRouteErrorsRef.current["anthropic"];
          // Persist the freshly discovered catalog so newly released Claude
          // models replace the stale on-disk cache without a manual refresh.
          persistProviderDiscovery(discoverProviderModels("anthropic"));
        }
      } catch {
        // Best-effort probe — failures are surfaced only when the user activates the route.
      }
      setRegistryNonce((n) => n + 1);
    })();
    // workspaceRoot is stable for the session lifetime; this runs exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot]);

  // Probe local OpenAI-compatible servers such as LM Studio at startup so the
  // provider picker can show actual availability and loaded model IDs.
  useEffect(() => {
    if (activeProviderRoute.providerId !== "local") return;
    void (async () => {
      try {
        markProviderAvailability("local", "checking", "startup-probe");
        const result = await validateLocalProvider({
          override: providerWorkspaceConfig.providers?.local,
        });
        if (result.diagnostics) {
          providerDiagnosticsRef.current["local"] = result.diagnostics as Record<
            string,
            string | number | boolean | null
          >;
        }
        if (result.status !== "ready") {
          providerRouteErrorsRef.current["local"] = result.message ?? "Local provider unavailable.";
        } else {
          delete providerRouteErrorsRef.current["local"];
          const detectedModel =
            typeof result.diagnostics?.selectedModel === "string"
              ? result.diagnostics.selectedModel.trim()
              : "";
          if (detectedModel && detectedModel !== activeProviderRoute.modelId) {
            const localBackend =
              activeProviderRoute.localBackend ??
              providerWorkspaceConfig.providers?.local?.localBackend ??
              "lm-studio";
            const nextReasoning = activeProviderRoute.reasoning ?? reasoningLevel;
            let nextConfig = setProviderActiveRoute(providerWorkspaceConfig, {
              providerId: "local",
              modelId: detectedModel,
              backendKind: result.backendKind,
              reasoning: nextReasoning,
              localBackend,
            });
            nextConfig = setProviderDefaultModel(nextConfig, "local", detectedModel);
            saveProviderWorkspaceConfig(workspaceRoot, nextConfig);
            setProviderWorkspaceConfig(nextConfig);
            updateRuntimeConfig((current) => ({ ...current, model: detectedModel }));
          }
        }
      } catch {
        // Best-effort probe — failures are surfaced only when the user activates the route.
      }
      setRegistryNonce((n) => n + 1);
    })();
    // workspaceRoot is stable for the session lifetime; local provider config is
    // loaded before this first startup probe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProviderRoute.providerId, workspaceRoot]);
  return { refreshModelCapabilities, ensureProviderModels, refreshAuthStatus };
}
