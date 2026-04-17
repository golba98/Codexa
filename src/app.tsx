import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { Box, Text, useApp, useFocusManager, useStdout } from "ink";
import { handleCommand } from "./commands/handler.js";
import {
  applyLayeredRuntimeOverride,
  resolveLayeredConfig,
  type LayeredConfigResult,
} from "./config/layeredConfig.js";
import type { LaunchArgs } from "./config/launchArgs.js";
import { loadSettings, saveSettings } from "./config/persistence.js";
import {
  type AuthPreference,
  type AvailableBackend,
  type DirectoryDisplayMode,
  type AvailableMode,
  type AvailableModel,
  type ReasoningLevel,
  USER_SETTING_DEFINITIONS,
  type UserSettingValues,
  estimateTokens,
  formatAuthPreferenceLabel,
  formatBackendLabel,
  formatDirectoryDisplayModeLabel,
  formatModeLabel,
  formatReasoningLabel,
  formatThemeLabel,
  formatWorkspaceDisplayPath,
  getNextMode,
} from "./config/settings.js";
import {
  AVAILABLE_APPROVAL_POLICIES,
  AVAILABLE_NETWORK_ACCESS_VALUES,
  AVAILABLE_SANDBOX_MODES,
  addWritableRoot,
  buildRuntimeSummary,
  clearWritableRoots,
  diffRuntimeConfig,
  formatApprovalPolicyLabel,
  formatNetworkAccessLabel,
  formatPersonalityLabel,
  formatSandboxModeLabel,
  formatServiceTierLabel,
  mergeRuntimeConfig,
  removeWritableRoot,
  resolveRuntimeConfig,
  resolveWritableRootCommandPath,
  type PartialRuntimeConfig,
  type RuntimeApprovalPolicy,
  type RuntimeConfig,
  type RuntimeNetworkAccess,
  type RuntimePersonality,
  type RuntimeSandboxMode,
  type RuntimeServiceTier,
} from "./config/runtimeConfig.js";
import { setProjectTrust } from "./config/trustStore.js";
import {
  type CodexAuthProbeResult,
  getAuthStatusMessage,
  getLoginGuidance,
  getLogoutGuidance,
  getRunGateDecision,
  isLikelyAuthFailure,
  probeCodexAuthStatus,
} from "./core/auth/codexAuth.js";
import { copyToClipboard } from "./core/clipboard.js";
import { runCommand, summarizeCommandResult } from "./core/process/CommandRunner.js";
import {
  buildPlanExecutionPrompt,
  buildPlanningPrompt,
  detectHollowResponse,
  resolveExecutionMode,
} from "./core/codexPrompt.js";
import { formatHollowResponse } from "./core/hollowResponseFormat.js";
import {
  createFallbackModelCapabilities,
  findModelCapability,
  formatModelCapabilitiesList,
  getCodexModelCapabilities,
  getPreferredModelFromCapabilities,
  getSelectableModelCapabilities,
  normalizeReasoningForModelCapabilities,
  type CodexModelCapabilities,
} from "./core/codexModelCapabilities.js";
import { acquireTerminalTitleGuard } from "./core/terminalTitle.js";
import {
  buildDevLaunchNotice,
  buildWorkspaceCommandContext,
  createWorkspaceRelaunchPlan,
  guardWorkspaceRelaunch,
  resolveLaunchContext,
} from "./core/launchContext.js";
import {
  getPromptWorkspaceGuardMessage,
  getShellWorkspaceGuardMessage,
} from "./core/workspaceGuard.js";
import {
  areModelSpecsEqual,
  createLoadingModelSpec,
  createModelSpecService,
  type ModelSpec,
} from "./core/modelSpecs.js";
import { captureWorkspaceSnapshot, createWorkspaceActivityTracker, diffWorkspaceSnapshots, type RunFileActivity } from "./core/workspaceActivity.js";
import { resolveWorkspaceRoot } from "./core/workspaceRoot.js";
import { isNoiseLine } from "./core/providers/codexTranscript.js";
import { getBackendProvider } from "./core/providers/registry.js";
import type { BackendProgressUpdate, BackendProvider } from "./core/providers/types.js";
import { sanitizeTerminalInput, sanitizeTerminalLines, sanitizeTerminalOutput } from "./core/terminalSanitize.js";
import * as perf from "./core/perf/profiler.js";
import type { RunEvent, RunToolActivity, Screen, ShellEvent, TimelineEvent, UIState, UserPromptEvent } from "./session/types.js";
import {
  buildFollowUpPrompt,
  createRunEvent,
  extractAssistantActionRequired,
  guardConfigMutation,
  isCurrentRun,
} from "./session/chatLifecycle.js";
import { findUserPrompt, useAppSessionState } from "./session/appSession.js";
import {
  approvePlanExecution,
  beginPlanFeedback,
  cancelPlanFeedback,
  createInitialPlanFlowState,
  finishPlanGeneration,
  resetPlanFlow,
  startPlanGeneration,
  submitPlanFeedback,
  type PlanFlowState,
} from "./session/planFlow.js";
import { AuthPanel } from "./ui/AuthPanel.js";
import { BackendPicker } from "./ui/BackendPicker.js";
import { measureBottomComposerRows, MemoizedBottomComposer } from "./ui/BottomComposer.js";
import { useTerminalViewport } from "./ui/layout.js";
import { ModelReasoningPicker } from "./ui/ModelReasoningPicker.js";
import { ModePicker } from "./ui/ModePicker.js";
import { PlanActionPicker, type PlanActionValue, measurePlanActionPickerRows } from "./ui/PlanActionPicker.js";
import { PermissionsPanel, type PermissionsPanelAction } from "./ui/PermissionsPanel.js";
import { ReasoningPicker } from "./ui/ReasoningPicker.js";
import { SelectionPanel } from "./ui/SelectionPanel.js";
import { SettingsPanel } from "./ui/SettingsPanel.js";
import { measureTextEntryPanelRows, TextEntryPanel } from "./ui/TextEntryPanel.js";
import { ThemePicker } from "./ui/ThemePicker.js";
import { getFocusTargetForScreen, FOCUS_IDS } from "./ui/focus.js";
import { ThemeProvider, THEMES } from "./ui/theme.js";
import {
  cancelThemeSelection,
  commitThemeSelection,
  getDisplayedThemeName,
  previewThemeSelection,
  shouldBumpComposerInstance,
  type ThemeSelectionState,
} from "./ui/themeFlow.js";
import { isBusy as isUiBusy } from "./session/types.js";
import { AppShell } from "./ui/AppShell.js";

let nextEventId = 0;
let nextTurnId = 0;
const LIVE_UPDATE_FLUSH_MS = 25;
const PROGRESS_ONLY_FLUSH_MS = 80;
const PLAN_FILE_NAME = "last-plan.md";
const PLAN_FILE_DIR = ".codexa";

function formatWritableRootsMessage(roots: readonly string[]): string {
  return roots.length > 0
    ? roots.map((root) => `  - ${root}`).join("\n")
    : "  - none";
}

function createEventId(): number {
  return nextEventId++;
}

function createTurnId(): number {
  return nextTurnId++;
}

function createInitialAuthStatus(): CodexAuthProbeResult {
  return {
    state: "checking",
    checkedAt: 0,
    rawSummary: "Initial auth check pending",
    recommendedAction: "Run /auth status to refresh.",
  };
}

function getPlanFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, PLAN_FILE_DIR, PLAN_FILE_NAME);
}

interface AppProps {
  launchArgs: LaunchArgs;
}

interface PromptRunLifecycle {
  parseActionRequired?: boolean;
  disableModeAutoUpgrade?: boolean;
  runtimeOverride?: PartialRuntimeConfig;
  onCompleted?: (result: { response: string; turnId: number; runId: number }) => void;
  onFailed?: (result: { message: string; turnId: number; runId: number }) => void;
  onCanceled?: (result: { turnId: number; runId: number }) => void;
}

export function App({ launchArgs }: AppProps) {
  const { exit } = useApp();
  const focusManager = useFocusManager();
  const workspaceRoot = useMemo(() => resolveWorkspaceRoot(), []);
  const initialSettings = useRef(loadSettings());
  const initialLayeredConfig = useRef<LayeredConfigResult | null>(null);
  if (initialLayeredConfig.current === null) {
    initialLayeredConfig.current = resolveLayeredConfig({ workspaceRoot, launchArgs });
  }
  const launchContext = useMemo(
    () => resolveLaunchContext({ workspaceRoot, forwardArgs: launchArgs.passthroughArgs }),
    [launchArgs.passthroughArgs, workspaceRoot],
  );
  const workspaceCommandContext = useMemo(
    () => buildWorkspaceCommandContext(launchContext),
    [launchContext],
  );
  const modelSpecService = useMemo(() => createModelSpecService(), []);
  const terminalLayout = useTerminalViewport();

  const [baseLayeredConfig, setBaseLayeredConfig] = useState<LayeredConfigResult>(initialLayeredConfig.current);
  const [sessionRuntimeOverride, setSessionRuntimeOverride] = useState<PartialRuntimeConfig>({});
  const [authPreference, setAuthPreference] = useState<AuthPreference>(initialSettings.current.auth.preference);
  const [directoryDisplayMode, setDirectoryDisplayMode] = useState<DirectoryDisplayMode>(
    initialSettings.current.ui.directoryDisplayMode,
  );
  const [themeSelection, setThemeSelection] = useState<ThemeSelectionState>({
    committedTheme: initialSettings.current.ui.theme,
    previewTheme: null,
  });
  const [customTheme, setCustomTheme] = useState(initialSettings.current.ui.customTheme);
  const [screen, setScreen] = useState<Screen>("main");
  const [composerInstanceKey, setComposerInstanceKey] = useState(0);
  const { state: sessionState, dispatch: dispatchSession } = useAppSessionState();
  const [authStatus, setAuthStatus] = useState<CodexAuthProbeResult>(createInitialAuthStatus());
  const [authStatusBusy, setAuthStatusBusy] = useState(false);
  // Running character total across the conversation — used to estimate token usage
  const [conversationChars, setConversationChars] = useState(0);
  const [modelSpecs, setModelSpecs] = useState<Partial<Record<AvailableModel, ModelSpec>>>({});
  const [modelCapabilities, setModelCapabilities] = useState<CodexModelCapabilities | null>(null);
  const [modelCapabilitiesBusy, setModelCapabilitiesBusy] = useState(false);
  const { stdout } = useStdout();
  const [mouseOverride, setMouseOverride] = useState<boolean | null>(null);
  const [verboseMode, setVerboseMode] = useState(false);
  const [planFlow, setPlanFlow] = useState<PlanFlowState>(createInitialPlanFlowState);
  // Mouse reporting is ON by default so wheel-based history scrolling works in
  // the timeline. When mouse reporting is active, most modern terminals (Windows
  // Terminal, iTerm2, etc.) still allow text selection via Shift+drag — the
  // terminal intercepts Shift-modified clicks itself before forwarding to the app.
  // Use /mouse to toggle to native-only mode if you prefer plain drag-select
  // at the cost of losing wheel scroll (keyboard PageUp/PageDown still works).
  const mouseCapture = mouseOverride ?? true;

  useEffect(() => {
    const assertTitle = () => {
      try { process.title = "CODEXA"; } catch { /* ignore */ }
      stdout.write("\x1b]0;CODEXA\x07\x1b]2;CODEXA\x07");
    };
    assertTitle();
    const t1 = setTimeout(assertTitle, 300);
    const t2 = setTimeout(assertTitle, 1200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [stdout]);

  useEffect(() => {
    // \x1b[?1000h: Enable basic mouse reporting (click/scroll)
    // \x1b[?1006h: Enable SGR extended mouse reporting (high-res coords)
    if (mouseCapture) {
      stdout.write("\x1b[?1000h\x1b[?1006h");
    } else {
      stdout.write("\x1b[?1000l\x1b[?1006l");
    }
    return () => {
      stdout.write("\x1b[?1000l\x1b[?1006l");
    };
  }, [mouseCapture, stdout]);

  const cleanupRef = useRef<(() => void) | null>(null);
  const activeRunLifecycleRef = useRef<PromptRunLifecycle | null>(null);
  const isMountedRef = useRef(true);
  const activeRunIdRef = useRef<number | null>(null);
  const activeTurnIdRef = useRef<number | null>(null);
  const previousScreenRef = useRef<Screen>("main");
  const themePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeThemeName = getDisplayedThemeName(themeSelection);
  const activeTheme =
    activeThemeName === "custom"
      ? { ...THEMES.purple, ...customTheme }
      : (THEMES[activeThemeName] ?? THEMES.purple);
  const baseRuntimeConfigRef = useRef(baseLayeredConfig.runtime);
  const layeredRuntimeConfig = useMemo(
    () => applyLayeredRuntimeOverride(baseLayeredConfig, sessionRuntimeOverride, "In-session overrides"),
    [baseLayeredConfig, sessionRuntimeOverride],
  );
  const runtimeConfig = layeredRuntimeConfig.runtime;
  const { provider: backend, model, mode, reasoningLevel, planMode } = runtimeConfig;
  const resolvedRuntimeConfig = useMemo(() => resolveRuntimeConfig(runtimeConfig), [runtimeConfig]);
  const runtimeSummary = useMemo(() => buildRuntimeSummary(resolvedRuntimeConfig), [resolvedRuntimeConfig]);
  const selectableModelCapabilities = useMemo(
    () => modelCapabilities ? getSelectableModelCapabilities(modelCapabilities) : [],
    [modelCapabilities],
  );
  const currentModelCapability = useMemo(
    () => findModelCapability(modelCapabilities, model),
    [model, modelCapabilities],
  );
  const currentReasoningCapabilities = currentModelCapability?.supportedReasoningLevels ?? [];
  const workspaceLabel = useMemo(
    () => formatWorkspaceDisplayPath(workspaceRoot, directoryDisplayMode),
    [directoryDisplayMode, workspaceRoot],
  );
  const currentUserSettings = useMemo<UserSettingValues>(() => ({
    directory: directoryDisplayMode,
  }), [directoryDisplayMode]);
  const allowedWritableRoots = useMemo(
    () => resolvedRuntimeConfig.policy.writableRoots,
    [resolvedRuntimeConfig],
  );
  const hasPlanFileAvailable = useMemo(
    () => planFlow.kind !== "idle"
      && planFlow.planFilePath !== null
      && existsSync(planFlow.planFilePath),
    [planFlow],
  );
  const currentModelSpec = modelSpecs[model] ?? createLoadingModelSpec(model);
  const { staticEvents, activeEvents, uiState, inputValue, cursor } = sessionState;

  // Refs for mutable state values — used by stable callbacks below so they
  // always read the latest value without being listed as deps (which would
  // recreate the callbacks on every keystroke and defeat memoisation).
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const busy = isUiBusy(uiState);
  const composerRows = useMemo(() => {
    if (planFlow.kind === "awaiting_action") {
      return measurePlanActionPickerRows(hasPlanFileAvailable);
    }
    if (planFlow.kind === "collecting_feedback") {
      return measureTextEntryPanelRows();
    }
    return measureBottomComposerRows({
      layout: terminalLayout,
      uiState,
      mode,
      model,
      reasoningLevel,
      tokensUsed: estimateTokens(conversationChars),
      modelSpec: currentModelSpec,
      value: inputValue,
      cursor,
    });
  }, [
    conversationChars,
    currentModelSpec,
    cursor,
    hasPlanFileAvailable,
    inputValue,
    mode,
    model,
    planFlow.kind,
    reasoningLevel,
    terminalLayout,
    uiState,
  ]);

  const provider: BackendProvider = useMemo(() => getBackendProvider(backend), [backend]);

  useEffect(() => {
    baseRuntimeConfigRef.current = baseLayeredConfig.runtime;
  }, [baseLayeredConfig.runtime]);

  useEffect(() => {
    saveSettings({
      ui: {
        layoutStyle: initialSettings.current.ui.layoutStyle,
        theme: themeSelection.committedTheme,
        directoryDisplayMode,
        customTheme,
      },
      auth: {
        preference: authPreference,
      },
    });
  }, [authPreference, customTheme, directoryDisplayMode, themeSelection.committedTheme]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cleanupRef.current?.();
      if (themePreviewTimerRef.current) {
        clearTimeout(themePreviewTimerRef.current);
        themePreviewTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (screen === "theme-picker") {
      return;
    }

    if (themePreviewTimerRef.current) {
      clearTimeout(themePreviewTimerRef.current);
      themePreviewTimerRef.current = null;
    }
  }, [screen]);

  useEffect(() => {
    const previousScreen = previousScreenRef.current;
    if (shouldBumpComposerInstance(previousScreen, screen)) {
      setComposerInstanceKey((currentKey) => currentKey + 1);
    }
    previousScreenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    focusManager.focus(getFocusTargetForScreen(screen));
  }, [composerInstanceKey, focusManager, screen]);

  useEffect(() => {
    const currentSpec = modelSpecs[model];
    if (currentSpec?.status === "verified") {
      return;
    }

    setModelSpecs((prev) => {
      const activeSpec = prev[model];
      if (activeSpec?.status === "verified" || activeSpec?.status === "loading") {
        return prev;
      }
      return { ...prev, [model]: createLoadingModelSpec(model) };
    });

    void modelSpecService.refreshSpec(model).then((spec) => {
      if (!isMountedRef.current) return;
      setModelSpecs((prev) => {
        const activeSpec = prev[model];
        if (activeSpec?.status === "verified" && spec.status !== "verified") {
          return prev;
        }
        if (areModelSpecsEqual(activeSpec, spec)) {
          return prev;
        }
        return { ...prev, [model]: spec };
      });
    });
  }, [model, modelSpecService]);

  const appendStaticEvent = useCallback((event: TimelineEvent) => {
    dispatchSession({ type: "APPEND_STATIC_EVENT", event });
  }, [dispatchSession]);

  const appendSystemEvent = useCallback((title: string, content: string) => {
    const safeTitle = sanitizeTerminalOutput(title);
    const safeContent = sanitizeTerminalOutput(content, { preserveTabs: false, tabSize: 2 });
    appendStaticEvent({
      id: createEventId(),
      type: "system",
      createdAt: Date.now(),
      title: safeTitle,
      content: safeContent,
    });
  }, [appendStaticEvent]);

  const appendErrorEvent = useCallback((title: string, content: string) => {
    const safeTitle = sanitizeTerminalOutput(title);
    const safeContent = sanitizeTerminalOutput(content, { preserveTabs: false, tabSize: 2 });
    appendStaticEvent({
      id: createEventId(),
      type: "error",
      createdAt: Date.now(),
      title: safeTitle,
      content: safeContent,
    });
  }, [appendStaticEvent]);

  const refreshModelCapabilities = useCallback(async (forceRefresh = false, announce = false) => {
    setModelCapabilitiesBusy(true);
    try {
      const capabilities = await getCodexModelCapabilities({ forceRefresh });
      setModelCapabilities(capabilities);
      if (announce) {
        const modelCount = getSelectableModelCapabilities(capabilities).length;
        const source = capabilities.status === "ready" ? "Codex runtime" : "fallback compatibility list";
        appendSystemEvent("Model discovery", `Loaded ${modelCount} models from ${source}.`);
      }
    } catch (error) {
      const fallback = createFallbackModelCapabilities(error);
      setModelCapabilities(fallback);
      if (announce) {
        appendErrorEvent("Model discovery failed", fallback.error ?? "Unable to discover Codex models.");
      }
    } finally {
      setModelCapabilitiesBusy(false);
    }
  }, [appendErrorEvent, appendSystemEvent]);

  useEffect(() => {
    void refreshModelCapabilities(false, false);
  }, [refreshModelCapabilities]);

  const setRuntimeUnauthenticated = useCallback((summary: string) => {
    setAuthStatus({
      state: "unauthenticated",
      checkedAt: Date.now(),
      rawSummary: summary,
      recommendedAction: "Run `codex login` and retry.",
    });
  }, []);

  const refreshAuthStatus = useCallback(async (announce: boolean) => {
    setAuthStatusBusy(true);
    setAuthStatus((prev) => ({ ...prev, state: "checking" }));

    try {
      const result = await probeCodexAuthStatus();
      setAuthStatus(result);
      if (announce) {
        appendSystemEvent("Auth status", getAuthStatusMessage(result));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown auth probe failure";
      const fallback: CodexAuthProbeResult = {
        state: "unknown",
        checkedAt: Date.now(),
        rawSummary: message,
        recommendedAction: "Run `codex login` manually, then retry /auth status.",
      };
      setAuthStatus(fallback);
      if (announce) {
        appendErrorEvent("Auth status probe failed", message);
      }
    } finally {
      setAuthStatusBusy(false);
    }
  }, [appendErrorEvent, appendSystemEvent]);

  useEffect(() => {
    void refreshAuthStatus(false);
  }, [refreshAuthStatus]);

  useEffect(() => {
    const devLaunchNotice = buildDevLaunchNotice(launchContext);
    if (!devLaunchNotice) return;

    appendSystemEvent("Launch mode", devLaunchNotice);
  }, [appendSystemEvent, launchContext]);

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

  useEffect(() => {
    if (modelCapabilities?.status !== "ready") {
      return;
    }

    const nextModel = getPreferredModelFromCapabilities(modelCapabilities, model);
    const nextReasoning = normalizeReasoningForModelCapabilities(
      nextModel,
      reasoningLevel,
      modelCapabilities,
    );

    if (nextModel === model && nextReasoning === reasoningLevel) {
      return;
    }

    updateRuntimeConfig((current) => ({
      ...current,
      model: nextModel,
      reasoningLevel: nextReasoning,
    }));

    if (nextModel !== model) {
      appendSystemEvent(
        "Model updated",
        `Configured model ${model} is unavailable in the detected Codex runtime. Active model is now ${nextModel}.`,
      );
    } else if (nextReasoning !== reasoningLevel) {
      appendSystemEvent(
        "Reasoning updated",
        `Reasoning level is now ${formatReasoningLabel(nextReasoning)} for ${nextModel}.`,
      );
    }
  }, [appendSystemEvent, model, modelCapabilities, reasoningLevel, updateRuntimeConfig]);

  const updateRuntimePolicy = useCallback((updater: (current: RuntimeConfig["policy"]) => RuntimeConfig["policy"]) => {
    updateRuntimeConfig((current) => ({
      ...current,
      policy: updater(current.policy),
    }));
  }, [updateRuntimeConfig]);

  const setBackendWithNotice = useCallback((nextBackend: AvailableBackend) => {
    const gate = guardConfigMutation("backend", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the backend.");
      return;
    }

    updateRuntimeConfig((current) => ({
      ...current,
      provider: nextBackend,
    }));
    setScreen("main");
    appendSystemEvent("Backend updated", `Active backend is now ${formatBackendLabel(nextBackend)}.`);
    if (nextBackend === "codex-subprocess") {
      void refreshAuthStatus(false);
    }
  }, [appendSystemEvent, busy, refreshAuthStatus, updateRuntimeConfig]);

  const setModeWithNotice = useCallback((nextMode: AvailableMode) => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the mode.");
      return;
    }

    updateRuntimeConfig((current) => ({
      ...current,
      mode: nextMode,
    }));
    setScreen("main");
    appendSystemEvent("Mode updated", `Execution mode switched to ${formatModeLabel(nextMode)}.`);
  }, [appendSystemEvent, busy, updateRuntimeConfig]);

  const cycleModeWithNotice = useCallback(() => {
    setModeWithNotice(getNextMode(mode));
  }, [mode, setModeWithNotice]);

  const setReasoningWithNotice = useCallback((nextReasoningLevel: ReasoningLevel) => {
    const gate = guardConfigMutation("reasoning", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the reasoning level.");
      return;
    }

    const supported = currentModelCapability?.supportedReasoningLevels;
    if (supported && !supported.some((item) => item.id === nextReasoningLevel)) {
      appendErrorEvent(
        "Reasoning unavailable",
        `${model} does not advertise ${formatReasoningLabel(nextReasoningLevel)} reasoning in the detected Codex runtime.`,
      );
      return;
    }

    updateRuntimeConfig((current) => ({
      ...current,
      reasoningLevel: nextReasoningLevel,
    }));
    setScreen("main");
    appendSystemEvent("Reasoning updated", `Reasoning level is now ${formatReasoningLabel(nextReasoningLevel)}.`);
  }, [appendErrorEvent, appendSystemEvent, busy, currentModelCapability, model, updateRuntimeConfig]);

  const setPlanModeWithNotice = useCallback((nextEnabled: boolean) => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing plan mode.");
      return;
    }

    updateRuntimeConfig((current) => ({
      ...current,
      planMode: nextEnabled,
    }));
    if (!nextEnabled) {
      setPlanFlow(resetPlanFlow());
    }
    appendSystemEvent("Plan mode", `Plan mode ${nextEnabled ? "enabled" : "disabled"}.`);
  }, [appendSystemEvent, busy, updateRuntimeConfig]);

  const togglePlanModeWithNotice = useCallback(() => {
    setPlanModeWithNotice(!planMode);
  }, [planMode, setPlanModeWithNotice]);

  const setModelWithNotice = useCallback((nextModel: AvailableModel) => {
    const gate = guardConfigMutation("model", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the model.");
      return;
    }

    updateRuntimeConfig((current) => ({
      ...current,
      model: nextModel,
      reasoningLevel: normalizeReasoningForModelCapabilities(nextModel, current.reasoningLevel, modelCapabilities),
    }));
    setScreen("main");
    appendSystemEvent("Model updated", `Active model is now ${nextModel}.`);
  }, [appendSystemEvent, busy, modelCapabilities, updateRuntimeConfig]);

  const setModelAndReasoningWithNotice = useCallback((nextModel: AvailableModel, nextReasoning: ReasoningLevel) => {
    const gate = guardConfigMutation("model", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the model.");
      return;
    }

    const modelChanged = nextModel !== model;
    const normalizedReasoning = normalizeReasoningForModelCapabilities(nextModel, nextReasoning, modelCapabilities);
    const reasoningChanged = normalizedReasoning !== reasoningLevel;

    updateRuntimeConfig((current) => ({
      ...current,
      model: nextModel,
      reasoningLevel: normalizedReasoning,
    }));
    setScreen("main");

    if (modelChanged && reasoningChanged) {
      appendSystemEvent("Model updated", `Active model is now ${nextModel}. Reasoning set to ${formatReasoningLabel(normalizedReasoning)}.`);
    } else if (modelChanged) {
      appendSystemEvent("Model updated", `Active model is now ${nextModel}.`);
    } else if (reasoningChanged) {
      appendSystemEvent("Reasoning updated", `Reasoning level is now ${formatReasoningLabel(normalizedReasoning)}.`);
    } else {
      // Nothing changed — still close the picker silently.
    }
  }, [appendSystemEvent, busy, model, modelCapabilities, reasoningLevel, updateRuntimeConfig]);

  const setAuthPreferenceWithNotice = useCallback((nextPreference: AuthPreference) => {
    setAuthPreference(nextPreference);
    appendSystemEvent("Auth preference updated", `Preference set to ${formatAuthPreferenceLabel(nextPreference)}.`);
  }, [appendSystemEvent]);

  const setDirectoryDisplayModeWithNotice = useCallback((nextMode: DirectoryDisplayMode) => {
    setDirectoryDisplayMode(nextMode);
    appendSystemEvent(
      "Settings",
      `Directory display set to ${formatDirectoryDisplayModeLabel(nextMode)} (${nextMode}).`,
    );
  }, [appendSystemEvent]);

  const saveSettingsFromPanel = useCallback((nextSettings: UserSettingValues) => {
    if (nextSettings.directory !== directoryDisplayMode) {
      setDirectoryDisplayModeWithNotice(nextSettings.directory);
    }
    setScreen("main");
  }, [directoryDisplayMode, setDirectoryDisplayModeWithNotice]);

  const setApprovalPolicyWithNotice = useCallback((nextValue: RuntimeApprovalPolicy) => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing runtime policy.");
      return;
    }

    updateRuntimePolicy((current) => ({ ...current, approvalPolicy: nextValue }));
    appendSystemEvent("Runtime policy", `Approval policy set to ${formatApprovalPolicyLabel(nextValue)}.`);
  }, [appendSystemEvent, busy, updateRuntimePolicy]);

  const setSandboxModeWithNotice = useCallback((nextValue: RuntimeSandboxMode) => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing runtime policy.");
      return;
    }

    updateRuntimePolicy((current) => ({ ...current, sandboxMode: nextValue }));
    appendSystemEvent("Runtime policy", `Sandbox mode set to ${formatSandboxModeLabel(nextValue)}.`);
  }, [appendSystemEvent, busy, updateRuntimePolicy]);

  const setNetworkAccessWithNotice = useCallback((nextValue: RuntimeNetworkAccess) => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing runtime policy.");
      return;
    }

    updateRuntimePolicy((current) => ({ ...current, networkAccess: nextValue }));
    appendSystemEvent("Runtime policy", `Network access set to ${formatNetworkAccessLabel(nextValue)}.`);
  }, [appendSystemEvent, busy, updateRuntimePolicy]);

  const addWritableRootWithNotice = useCallback((pathValue: string) => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing runtime policy.");
      return;
    }

    const resolvedPath = resolveWritableRootCommandPath(pathValue, workspaceRoot);
    updateRuntimeConfig((current) => addWritableRoot(current, resolvedPath));
    appendSystemEvent("Runtime policy", `Writable root added: ${resolvedPath}.`);
  }, [appendSystemEvent, busy, updateRuntimeConfig, workspaceRoot]);

  const removeWritableRootWithNotice = useCallback((pathValue: string) => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing runtime policy.");
      return;
    }

    const resolvedPath = resolveWritableRootCommandPath(pathValue, workspaceRoot);
    updateRuntimeConfig((current) => removeWritableRoot(current, resolvedPath));
    appendSystemEvent("Runtime policy", `Writable root removed: ${resolvedPath}.`);
  }, [appendSystemEvent, busy, updateRuntimeConfig, workspaceRoot]);

  const clearWritableRootsWithNotice = useCallback(() => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing runtime policy.");
      return;
    }

    updateRuntimeConfig((current) => clearWritableRoots(current));
    appendSystemEvent("Runtime policy", "Writable roots cleared.");
  }, [appendSystemEvent, busy, updateRuntimeConfig]);

  const setServiceTierWithNotice = useCallback((nextValue: RuntimeServiceTier) => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing runtime policy.");
      return;
    }

    updateRuntimePolicy((current) => ({ ...current, serviceTier: nextValue }));
    appendSystemEvent("Runtime policy", `Service tier set to ${formatServiceTierLabel(nextValue)}.`);
  }, [appendSystemEvent, busy, updateRuntimePolicy]);

  const setPersonalityWithNotice = useCallback((nextValue: RuntimePersonality) => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing runtime policy.");
      return;
    }

    updateRuntimePolicy((current) => ({ ...current, personality: nextValue }));
    appendSystemEvent("Runtime policy", `Personality set to ${formatPersonalityLabel(nextValue)}.`);
  }, [appendSystemEvent, busy, updateRuntimePolicy]);

  const setProjectTrustWithNotice = useCallback((trusted: boolean) => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing project trust.");
      return;
    }

    const projectRoot = baseLayeredConfig.diagnostics.projectRoot;
    setProjectTrust(projectRoot, trusted);
    reloadBaseLayeredConfig();
    appendSystemEvent(
      "Config trust",
      `${trusted ? "Trusted" : "Untrusted"} project root: ${projectRoot}.`,
    );
  }, [appendSystemEvent, baseLayeredConfig.diagnostics.projectRoot, busy, reloadBaseLayeredConfig]);

  const openBackendPicker = useCallback(() => {
    const gate = guardConfigMutation("backend", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the backend.");
      return;
    }

    setScreen("backend-picker");
  }, [appendSystemEvent, busy]);

  const openModelPicker = useCallback(() => {
    const gate = guardConfigMutation("model", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the model.");
      return;
    }

    if (!modelCapabilities) {
      if (!modelCapabilitiesBusy) {
        void refreshModelCapabilities(true, true);
      }
      appendSystemEvent("Model discovery", "Codex model discovery is still running. Try the model picker again in a moment.");
      return;
    }

    setScreen("model-picker");
  }, [appendSystemEvent, busy, modelCapabilities, modelCapabilitiesBusy, refreshModelCapabilities]);

  const openModePicker = useCallback(() => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the mode.");
      return;
    }

    setScreen("mode-picker");
  }, [appendSystemEvent, busy]);

  const openReasoningPicker = useCallback(() => {
    const gate = guardConfigMutation("reasoning", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the reasoning level.");
      return;
    }

    if (!currentModelCapability?.supportedReasoningLevels?.length) {
      if (!modelCapabilitiesBusy) {
        void refreshModelCapabilities(true, true);
      }
      appendSystemEvent(
        "Reasoning unavailable",
        `Codex has not provided reasoning metadata for ${model}. No guessed reasoning levels will be shown.`,
      );
      return;
    }

    setScreen("reasoning-picker");
  }, [appendSystemEvent, busy, currentModelCapability, model, modelCapabilitiesBusy, refreshModelCapabilities]);

  const openThemePicker = useCallback(() => {
    const gate = guardConfigMutation("theme", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the theme.");
      return;
    }

    setScreen("theme-picker");
  }, [appendSystemEvent, busy]);

  const openSettingsPanel = useCallback(() => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing settings.");
      return;
    }

    setScreen("settings-panel");
  }, [appendSystemEvent, busy]);

  const openAuthPanel = useCallback(() => {
    if (busy) {
      appendSystemEvent("Busy", "Finish the current run before opening auth guidance.");
      return;
    }

    setScreen("auth-panel");
  }, [appendSystemEvent, busy]);

  const openPermissionsPanel = useCallback(() => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing runtime policy.");
      return;
    }

    setScreen("permissions-panel");
  }, [appendSystemEvent, busy]);

  const openPermissionsApprovalPicker = useCallback(() => {
    setScreen("permissions-approval-picker");
  }, []);

  const openPermissionsSandboxPicker = useCallback(() => {
    setScreen("permissions-sandbox-picker");
  }, []);

  const openPermissionsNetworkPicker = useCallback(() => {
    setScreen("permissions-network-picker");
  }, []);

  const openPermissionsAddWritableRoot = useCallback(() => {
    setScreen("permissions-add-writable-root");
  }, []);

  const openPermissionsRemoveWritableRoot = useCallback(() => {
    if (runtimeConfig.policy.writableRoots.length === 0) {
      appendSystemEvent("Runtime policy", "No writable roots are configured.");
      return;
    }

    setScreen("permissions-remove-writable-root");
  }, [appendSystemEvent, runtimeConfig.policy.writableRoots.length]);

  const handlePermissionsPanelAction = useCallback((action: PermissionsPanelAction) => {
    switch (action) {
      case "approval-policy":
        openPermissionsApprovalPicker();
        return;
      case "sandbox":
        openPermissionsSandboxPicker();
        return;
      case "network":
        openPermissionsNetworkPicker();
        return;
      case "writable-roots-summary":
        appendSystemEvent(
          "Runtime policy",
          `Writable roots:\n${formatWritableRootsMessage(runtimeConfig.policy.writableRoots)}`,
        );
        return;
      case "writable-roots-add":
        openPermissionsAddWritableRoot();
        return;
      case "writable-roots-remove":
        openPermissionsRemoveWritableRoot();
        return;
      case "writable-roots-clear":
        clearWritableRootsWithNotice();
        return;
      default:
        return;
    }
  }, [
    appendSystemEvent,
    clearWritableRootsWithNotice,
    openPermissionsAddWritableRoot,
    openPermissionsApprovalPicker,
    openPermissionsNetworkPicker,
    openPermissionsRemoveWritableRoot,
    openPermissionsSandboxPicker,
    runtimeConfig.policy.writableRoots,
  ]);

  const resetComposer = useCallback(() => {
    dispatchSession({ type: "RESET_INPUT" });
  }, [dispatchSession]);

  const finalizePromptRun = useCallback((
    runId: number,
    turnId: number,
    status: "completed" | "failed" | "canceled",
    message?: string,
    response?: string,
  ) => {
    if (!isCurrentRun(activeRunIdRef.current, runId)) {
      return false;
    }
    perf.mark("finalize_start");

    const lifecycle = activeRunLifecycleRef.current;
    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    activeRunLifecycleRef.current = null;
    activeRunIdRef.current = null;
    activeTurnIdRef.current = null;
    focusManager.focus(FOCUS_IDS.composer);
    cleanup?.();
    const safeMessage = message ? sanitizeTerminalOutput(message) : undefined;
    // When response is undefined, signal the reducer to preserve streamed content as-is.
    const safeResponse = response != null
      ? sanitizeTerminalOutput(response, { preserveTabs: false, tabSize: 2 })
      : undefined;
    const shouldParseActionRequired = lifecycle?.parseActionRequired ?? true;
    const parsed = status === "completed" && safeResponse?.trim()
      ? shouldParseActionRequired
        ? extractAssistantActionRequired(safeResponse)
        : { content: safeResponse, question: null as string | null }
      : { content: safeResponse, question: null as string | null };
    dispatchSession({
      type: "FINALIZE_RUN",
      runId,
      turnId,
      status,
      message: safeMessage,
      response: parsed.content,
      question: status === "completed" ? parsed.question : null,
      assistantFactory: () => ({
        id: createEventId(),
        type: "assistant",
        createdAt: Date.now(),
        content: parsed.content?.trim() ? parsed.content : "",
        contentChunks: [],
        turnId,
      }),
    });
    perf.mark("finalize_done");
    perf.setMeta("content_length", parsed.content?.length ?? 0);
    perf.setMeta("status", status);
    const perfSession = perf.getSession();
    if (perfSession) perf.persistSession(perfSession);

    if (status === "completed") {
      lifecycle?.onCompleted?.({
        response: parsed.content ?? "",
        turnId,
        runId,
      });
    } else if (status === "failed") {
      lifecycle?.onFailed?.({
        message: safeMessage ?? "Run failed",
        turnId,
        runId,
      });
    } else {
      lifecycle?.onCanceled?.({
        turnId,
        runId,
      });
    }

    return true;
  }, [dispatchSession, focusManager]);

  const cancelActiveRun = useCallback((retainHistory = true) => {
    const runId = activeRunIdRef.current;
    if (runId === null) return false;
    const promptTurnId = activeTurnIdRef.current;

    if (!isCurrentRun(activeRunIdRef.current, runId)) {
      return false;
    }

    const shellEvent = activeEvents.find((event) => event.type === "shell" && event.id === runId) as ShellEvent | undefined;
    const runEvent = activeEvents.find((event) => event.type === "run" && event.id === runId) as RunEvent | undefined;

    if (retainHistory && runEvent) {
      return finalizePromptRun(runId, runEvent.turnId, "canceled");
    }

    const cleanup = cleanupRef.current;
    const lifecycle = activeRunLifecycleRef.current;
    cleanupRef.current = null;
    activeRunLifecycleRef.current = null;
    activeRunIdRef.current = null;
    activeTurnIdRef.current = null;
    focusManager.focus(FOCUS_IDS.composer);
    cleanup?.();

    if (retainHistory) {
      if (shellEvent) {
        activeRunLifecycleRef.current = null;
        dispatchSession({
          type: "FINALIZE_SHELL",
          shellId: runId,
          finalEvent: { ...shellEvent, status: "failed", exitCode: -1, durationMs: null },
        });
      } else {
        dispatchSession({ type: "REMOVE_ACTIVE_RUNTIME", runId, turnId: promptTurnId });
        const runEvent = activeEvents.find((event) => event.type === "run" && event.id === runId) as RunEvent | undefined;
        if (runEvent) {
          void finalizePromptRun(runId, runEvent.turnId, "canceled");
        } else {
          if (promptTurnId !== null) {
            lifecycle?.onCanceled?.({ turnId: promptTurnId, runId });
          }
          dispatchSession({ type: "REMOVE_ACTIVE_RUNTIME", runId, turnId: promptTurnId });
        }
      }
    } else {
      if (promptTurnId !== null) {
        lifecycle?.onCanceled?.({ turnId: promptTurnId, runId });
      }
      if (uiState.kind === "SHELL_RUNNING") {
        dispatchSession({ type: "UI_ACTION", action: { type: "SHELL_FINISHED", shellId: runId } });
      } else if (promptTurnId !== null) {
        dispatchSession({ type: "UI_ACTION", action: { type: "RUN_CANCELED", turnId: promptTurnId } });
      }
      dispatchSession({ type: "REMOVE_ACTIVE_RUNTIME", runId, turnId: promptTurnId });
      return true;
    }

    if (uiState.kind === "SHELL_RUNNING") {
      dispatchSession({ type: "UI_ACTION", action: { type: "SHELL_FINISHED", shellId: runId } });
    } else if (promptTurnId !== null) {
      dispatchSession({ type: "UI_ACTION", action: { type: "RUN_CANCELED", turnId: promptTurnId } });
    }

    return true;
  }, [activeEvents, dispatchSession, finalizePromptRun, focusManager, uiState.kind]);

  const handleCancel = useCallback(() => {
    if (busy) {
      cancelActiveRun(true);
      return;
    }
    if (planFlow.kind === "collecting_feedback") {
      setPlanFlow((current) => cancelPlanFeedback(current));
      return;
    }
    if (planFlow.kind === "awaiting_action") {
      setPlanFlow(resetPlanFlow());
      appendSystemEvent("Plan review", "Plan review canceled. No changes were made.");
      return;
    }
    if (uiState.kind === "AWAITING_USER_ACTION" || uiState.kind === "ERROR") {
      dispatchSession({ type: "UI_ACTION", action: { type: "DISMISS_TRANSIENT" } });
      resetComposer();
    }
  }, [appendSystemEvent, busy, cancelActiveRun, dispatchSession, planFlow.kind, resetComposer, uiState.kind]);

  const handleQuit = useCallback(() => {
    cancelActiveRun(false);
    exit();
  }, [cancelActiveRun, exit]);

  const handleCopy = useCallback(async () => {
    // Build a full conversation transcript from all user prompts and assistant
    // responses in staticEvents, paired by turnId and sorted chronologically.
    type TurnPair = { createdAt: number; prompt: string; response: string | null };
    const turns = new Map<number, TurnPair>();

    for (const event of staticEvents) {
      if (event.type === "user") {
        const existing = turns.get(event.turnId);
        if (!existing) {
          turns.set(event.turnId, { createdAt: event.createdAt, prompt: event.prompt, response: null });
        }
      } else if (event.type === "assistant") {
        const existing = turns.get(event.turnId);
        if (existing) {
          existing.response = event.content;
        }
      }
    }

    if (turns.size === 0) {
      appendSystemEvent("Copy unavailable", "There is no conversation to copy yet.");
      return;
    }

    // Sort turns by creation time and format as a readable dialogue.
    const lines: string[] = [];
    const sorted = [...turns.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const turn of sorted) {
      lines.push(`You: ${turn.prompt.trim()}`);
      if (turn.response?.trim()) {
        lines.push("");
        lines.push(`Codexa: ${turn.response.trim()}`);
      }
      lines.push("");
    }
    const transcript = lines.join("\n").trimEnd();

    const ok = await copyToClipboard(transcript);
    const turnWord = turns.size === 1 ? "1 turn" : `${turns.size} turns`;
    appendSystemEvent(
      "Clipboard",
      ok
        ? `Copied full conversation (${turnWord}) to clipboard.`
        : "Clipboard unavailable.",
    );
  }, [appendSystemEvent, staticEvents]);

  const savePlanFile = useCallback((planContent: string): string | null => {
    try {
      const planFilePath = getPlanFilePath(workspaceRoot);
      mkdirSync(join(workspaceRoot, PLAN_FILE_DIR), { recursive: true });
      writeFileSync(planFilePath, planContent, "utf-8");
      return planFilePath;
    } catch {
      appendErrorEvent(
        "Plan file unavailable",
        `The generated plan could not be saved to ${getPlanFilePath(workspaceRoot)}.`,
      );
      return null;
    }
  }, [appendErrorEvent, workspaceRoot]);

  const handleViewPlanFile = useCallback((planFilePath: string | null) => {
    if (!planFilePath) {
      appendErrorEvent("Plan file unavailable", "There is no saved plan file to view for this review.");
      return;
    }

    if (!existsSync(planFilePath)) {
      appendErrorEvent("Plan file unavailable", `The saved plan file is no longer available: ${planFilePath}`);
      return;
    }

    try {
      const contents = sanitizeTerminalOutput(readFileSync(planFilePath, "utf-8"), {
        preserveTabs: false,
        tabSize: 2,
      });
      appendSystemEvent("Plan file", [`Path: ${planFilePath}`, "", contents].join("\n"));
    } catch {
      appendErrorEvent("Plan file unavailable", `The saved plan file could not be read: ${planFilePath}`);
    }
  }, [appendErrorEvent, appendSystemEvent]);


  // ── Stable composer-input callbacks ────────────────────────────────────────
  // These use refs so the function identity never changes, avoiding
  // unnecessary downstream work even though the memo comparator on
  // MemoizedBottomComposer already skips callback checks.
  const handleChangeInput = useCallback((value: string, nextCursor: number) => {
    const safeValue = sanitizeTerminalInput(value);
    dispatchSession({ type: "SET_INPUT", value: safeValue, cursor: Math.min(nextCursor, safeValue.length) });
  }, [dispatchSession]);

  const handleChangeValue = useCallback((value: string) => {
    const safeValue = sanitizeTerminalInput(value);
    dispatchSession({ type: "SET_INPUT", value: safeValue, cursor: Math.min(cursorRef.current, safeValue.length) });
  }, [dispatchSession]);

  const handleChangeCursor = useCallback((nextCursor: number) => {
    const safeValue = sanitizeTerminalInput(inputValueRef.current);
    dispatchSession({ type: "SET_INPUT", value: safeValue, cursor: Math.min(nextCursor, safeValue.length) });
  }, [dispatchSession]);

  const handleClear = useCallback(() => {
    cancelActiveRun(false);
    activeTurnIdRef.current = null;
    activeRunLifecycleRef.current = null;
    setPlanFlow(resetPlanFlow());
    dispatchSession({ type: "CLEAR_TRANSCRIPT" });
    setConversationChars(0);
    setScreen("main");
    resetComposer();
  }, [cancelActiveRun, dispatchSession, resetComposer]);

  const handleShellExecute = useCallback((command: string) => {
    const safeCommand = sanitizeTerminalInput(command).trim();
    const guardMessage = getShellWorkspaceGuardMessage(safeCommand, workspaceRoot, allowedWritableRoots);
    if (guardMessage) {
      appendErrorEvent("Shell command blocked", guardMessage);
      return;
    }

    const shellId = createEventId();
    const startTime = Date.now();
    const stopTitleGuard = acquireTerminalTitleGuard();
    let titleGuardReleased = false;
    const releaseTitleGuard = () => {
      if (titleGuardReleased) return;
      titleGuardReleased = true;
      stopTitleGuard();
    };

    const initialEvent: ShellEvent = {
      id: shellId,
      createdAt: startTime,
      type: "shell",
      command: safeCommand,
      lines: [],
      stderrLines: [],
      summary: `Executing shell: ${safeCommand}`,
      status: "running",
      exitCode: null,
      durationMs: null,
    };

    dispatchSession({ type: "SET_ACTIVE_EVENTS", events: [initialEvent] });
    activeRunLifecycleRef.current = null;
    activeRunIdRef.current = shellId;
    activeTurnIdRef.current = null;
    dispatchSession({ type: "UI_ACTION", action: { type: "SHELL_STARTED", shellId } });

    let pendingStdout: string[] = [];
    let pendingStderr: string[] = [];
    let shellFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushShellLines = () => {
      if (shellFlushTimer) {
        clearTimeout(shellFlushTimer);
        shellFlushTimer = null;
      }

      const stdoutLines = pendingStdout;
      const stderrLines = pendingStderr;
      pendingStdout = [];
      pendingStderr = [];

      if (stdoutLines.length === 0 && stderrLines.length === 0) {
        return;
      }

      startTransition(() => {
        if (stdoutLines.length > 0) {
          dispatchSession({ type: "UPDATE_SHELL_LINES", shellId, stream: "stdout", lines: stdoutLines });
        }
        if (stderrLines.length > 0) {
          dispatchSession({ type: "UPDATE_SHELL_LINES", shellId, stream: "stderr", lines: stderrLines });
        }
      });
    };

    const scheduleShellFlush = () => {
      if (shellFlushTimer) return;
      shellFlushTimer = setTimeout(() => {
        shellFlushTimer = null;
        flushShellLines();
      }, LIVE_UPDATE_FLUSH_MS);
    };

    const runner = runCommand(
      { executable: safeCommand, args: [], shell: true, cwd: workspaceRoot },
      {
        onStdout: (text) => {
          const lines = sanitizeTerminalLines(text.split(/\r?\n/));
          if (lines.length > 0) {
            pendingStdout.push(...lines);
            scheduleShellFlush();
          }
        },
        onStderr: (text) => {
          const lines = sanitizeTerminalLines(text.split(/\r?\n/));
          if (lines.length > 0) {
            pendingStderr.push(...lines);
            scheduleShellFlush();
          }
        },
      },
    );

    cleanupRef.current = () => {
      if (shellFlushTimer) {
        clearTimeout(shellFlushTimer);
        shellFlushTimer = null;
      }
      runner.cancel();
      releaseTitleGuard();
    };

    void runner.result.then((result) => {
      releaseTitleGuard();
      if (activeRunIdRef.current !== shellId) return;
      flushShellLines();
      activeRunIdRef.current = null;
      cleanupRef.current = null;
      focusManager.focus(FOCUS_IDS.composer);

      const finalEvent: ShellEvent = {
        ...initialEvent,
        lines: sanitizeTerminalLines(result.stdout.split(/\r?\n/)),
        stderrLines: sanitizeTerminalLines(result.stderr.split(/\r?\n/)),
        summary: sanitizeTerminalOutput(summarizeCommandResult(safeCommand, result)),
        status: result.status === "completed" ? "completed" : "failed",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      };

      dispatchSession({ type: "FINALIZE_SHELL", shellId, finalEvent });
    });
  }, [allowedWritableRoots, appendErrorEvent, dispatchSession, focusManager, workspaceRoot]);

  const handleWorkspaceRelaunch = useCallback((targetPath: string) => {
    const gate = guardWorkspaceRelaunch(busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before relaunching into another workspace.");
      return;
    }

    const relaunchResult = createWorkspaceRelaunchPlan(targetPath, launchContext);
    if (!relaunchResult.ok) {
      appendErrorEvent("Workspace relaunch failed", relaunchResult.message);
      return;
    }

    try {
      const child = spawn(relaunchResult.plan.executable, relaunchResult.plan.args, {
        cwd: relaunchResult.plan.cwd,
        env: relaunchResult.plan.env,
        stdio: "inherit",
      });

      let launched = false;
      child.once("error", (error) => {
        if (launched) return;
        appendErrorEvent("Workspace relaunch failed", error.message);
      });
      child.once("spawn", () => {
        launched = true;
        exit();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown relaunch failure";
      appendErrorEvent("Workspace relaunch failed", message);
    }
  }, [appendErrorEvent, appendSystemEvent, busy, exit, launchContext]);

  const handleHistoryUp = useCallback(() => {
    dispatchSession({ type: "HISTORY_UP" });
  }, [dispatchSession]);

  const handleHistoryDown = useCallback(() => {
    dispatchSession({ type: "HISTORY_DOWN" });
  }, [dispatchSession]);

  const findUserPromptForTurn = useCallback((turnId: number): UserPromptEvent | null => {
    return findUserPrompt([...staticEvents, ...activeEvents], turnId);
  }, [activeEvents, staticEvents]);

  const startPromptRun = useCallback((
    displayPrompt: string,
    providerPrompt: string,
    lifecycle: PromptRunLifecycle = {},
  ) => {
    const safeDisplayPrompt = sanitizeTerminalInput(displayPrompt).trim();
    const safeProviderPrompt = sanitizeTerminalInput(providerPrompt).trim();
    if (!safeDisplayPrompt || !safeProviderPrompt) {
      appendErrorEvent("Prompt blocked", "The prompt only contained non-printable/control characters after sanitization.");
      return false;
    }

    const requestedRuntime = mergeRuntimeConfig(runtimeConfig, lifecycle.runtimeOverride ?? {});
    const requestedMode = requestedRuntime.mode;
    const executionModeDecision = lifecycle.disableModeAutoUpgrade
      ? { mode: requestedMode, autoUpgraded: false }
      : resolveExecutionMode(requestedMode, safeProviderPrompt);
    const effectiveMode = executionModeDecision.mode;
    const runtimeForTurn = resolveRuntimeConfig({
      ...requestedRuntime,
      mode: effectiveMode,
    });
    if (executionModeDecision.autoUpgraded) {
      appendSystemEvent(
        "Mode auto-upgraded",
        "This prompt looks like a file-editing request, so the run is using Auto instead of Read-only.",
      );
    }

    if (!provider.run) {
      appendErrorEvent(
        "Backend unavailable",
        `${provider.label} is a planned provider placeholder. Use Codexa Core for runnable execution in v1.`,
      );
      return false;
    }

    if (backend === "codex-subprocess") {
      const decision = getRunGateDecision(authStatus.state);
      if (!decision.allowRun) {
        appendErrorEvent("Authentication required", decision.blockMessage ?? "Please sign in with `codex login`.");
        return false;
      }
      if (decision.warningMessage) {
        appendSystemEvent("Auth warning", decision.warningMessage);
      }
    }

    const turnId = createTurnId();
    const stopTitleGuard = acquireTerminalTitleGuard();
    let titleGuardReleased = false;
    const releaseTitleGuard = () => {
      if (titleGuardReleased) return;
      titleGuardReleased = true;
      stopTitleGuard();
    };
    const userEvent: UserPromptEvent = {
      id: createEventId(),
      type: "user",
      createdAt: Date.now(),
      prompt: safeDisplayPrompt,
      turnId,
    };
    setConversationChars((count) => count + safeProviderPrompt.length);

    const runId = createEventId();
    perf.startSession(String(runId));
    perf.mark("dispatch_start");
    activeRunIdRef.current = runId;
    activeTurnIdRef.current = turnId;
    activeRunLifecycleRef.current = lifecycle;
    dispatchSession({ type: "UI_ACTION", action: { type: "PROMPT_RUN_STARTED", turnId } });
    dispatchSession({ type: "SET_ACTIVE_EVENTS", events: [
      userEvent,
      {
        ...createRunEvent({
          id: runId,
          backendId: backend,
          backendLabel: provider.label,
          runtime: runtimeForTurn,
          prompt: safeProviderPrompt,
          turnId,
        }),
        summary: "Codexa is thinking...",
      },
    ] });

    // Capture the workspace state before the run starts so we can diff on completion.
    let preRunSnapshot: ReturnType<typeof captureWorkspaceSnapshot> | null = null;
    const activityTracker = backend === "codex-subprocess"
      ? (() => {
        preRunSnapshot = captureWorkspaceSnapshot(workspaceRoot);
        return createWorkspaceActivityTracker({
          rootDir: workspaceRoot,
          onActivity: (activity) => {
            if (!isCurrentRun(activeRunIdRef.current, runId)) return;
            pendingActivity.push(...activity);
            scheduleLiveFlush();
          },
        });
      })()
      : null;

    let pendingAssistantDelta = "";
    let streamedAssistantContent = "";
    let pendingProgressUpdates: BackendProgressUpdate[] = [];
    let pendingActivity: RunFileActivity[] = [];
    const pendingToolActivities = new Map<string, RunToolActivity>();
    let liveFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let legacyProgressSequence = 0;
    let firstRenderFired = false;

    const flushLiveUpdates = () => {
      perf.inc("flushes");
      if (liveFlushTimer) {
        clearTimeout(liveFlushTimer);
        liveFlushTimer = null;
      }

      if (!isCurrentRun(activeRunIdRef.current, runId)) {
        pendingAssistantDelta = "";
        pendingProgressUpdates = [];
        pendingActivity = [];
        pendingToolActivities.clear();
        return;
      }

      const activity = pendingActivity;
      const progressUpdates = pendingProgressUpdates;
      const toolActivities = [...pendingToolActivities.values()];
      const chunk = pendingAssistantDelta;
      pendingActivity = [];
      pendingProgressUpdates = [];
      pendingAssistantDelta = "";
      pendingToolActivities.clear();

      if (activity.length === 0 && progressUpdates.length === 0 && toolActivities.length === 0 && !chunk) {
        return;
      }

      // Assistant deltas are dispatched at normal priority for immediate rendering.
      // Lower-priority updates (activity, progress, tools) use startTransition
      // so they don't delay streaming text from appearing.
      if (chunk) {
        if (!firstRenderFired) {
          firstRenderFired = true;
          perf.mark("first_render");
        }
        dispatchSession({
          type: "RUN_APPEND_ASSISTANT_DELTA",
          turnId,
          chunk,
          eventFactory: () => ({
            id: createEventId(),
            type: "assistant",
            createdAt: Date.now(),
            content: "",
            contentChunks: [chunk],
            turnId,
          }),
        });
      }

      startTransition(() => {
        if (activity.length > 0) {
          dispatchSession({ type: "RUN_APPEND_ACTIVITY", runId, activity });
        }
        if (progressUpdates.length > 0) {
          dispatchSession({ type: "RUN_APPLY_PROGRESS_UPDATES", runId, updates: progressUpdates });
        }
        for (const toolActivity of toolActivities) {
          dispatchSession({ type: "RUN_UPSERT_TOOL_ACTIVITY", runId, activity: toolActivity });
        }
      });
    };

    let firstChunkPending = true;
    const scheduleLiveFlush = () => {
      if (liveFlushTimer) return;
      // First token: use microtask for near-instant rendering
      if (firstChunkPending && pendingAssistantDelta) {
        firstChunkPending = false;
        liveFlushTimer = setTimeout(() => {}, 0); // prevent re-entry
        queueMicrotask(() => {
          liveFlushTimer = null;
          flushLiveUpdates();
        });
        return;
      }
      const interval = pendingAssistantDelta ? LIVE_UPDATE_FLUSH_MS : PROGRESS_ONLY_FLUSH_MS;
      liveFlushTimer = setTimeout(() => {
        liveFlushTimer = null;
        flushLiveUpdates();
      }, interval);
    };

    perf.mark("provider_run_start");
    const stopProviderRun = provider.run(
          safeProviderPrompt,
          { runtime: runtimeForTurn, workspaceRoot },
          {
        onAssistantDelta: (chunk) => {
          if (!chunk || !isCurrentRun(activeRunIdRef.current, runId)) return;
          const t0 = performance.now();
          const safeChunk = sanitizeTerminalOutput(chunk, { preserveTabs: false, tabSize: 2 });
          perf.accumulate("sanitize_ms", performance.now() - t0);
          perf.inc("chunks");
          if (!safeChunk) return;
          pendingAssistantDelta += safeChunk;
          streamedAssistantContent += safeChunk;
          scheduleLiveFlush();
        },
        onToolActivity: (activity) => {
          if (!isCurrentRun(activeRunIdRef.current, runId)) return;
          const existing = pendingToolActivities.get(activity.id);
          pendingToolActivities.set(activity.id, existing ? { ...existing, ...activity } : activity);
          scheduleLiveFlush();
        },
        onResponse: (response) => {
          if (!isCurrentRun(activeRunIdRef.current, runId)) return;
          perf.mark("response_cb_start");

          // Force one final synchronous workspace poll before finalizing the run.
          // This closes the race condition where the activity tracker's interval
          // hasn't fired yet and late file changes would be missed.
          if (activityTracker && preRunSnapshot) {
            try {
              perf.mark("snapshot_start");
              const finalSnapshot = captureWorkspaceSnapshot(workspaceRoot);
              perf.mark("snapshot_end");
              const lateActivity = diffWorkspaceSnapshots(preRunSnapshot, finalSnapshot);
              if (lateActivity.length > 0) {
                pendingActivity.push(...lateActivity);
              }
            } catch {
              // Non-fatal: best-effort final poll
            }
          }

          flushLiveUpdates();
          const safeResponse = sanitizeTerminalOutput(response, { preserveTabs: false, tabSize: 2 });
          setConversationChars((count) => count + safeResponse.length);

          // Validate response quality for write-intent/destructive prompts:
          // If the backend returned filler like "Hello." instead of execution
          // feedback, inject a warning so the user isn't silently misled.
          if (effectiveMode !== "suggest") {
            const hollow = detectHollowResponse(safeProviderPrompt, safeResponse);
            if (hollow.isHollow) {
              const formatted = formatHollowResponse(hollow, safeResponse);
              void finalizePromptRun(runId, turnId, "completed", undefined, formatted);
              return;
            }
          }

          // If the streamed content matches the sanitized response (after
          // normalizing whitespace), pass undefined so FINALIZE_RUN preserves
          // the already-rendered streamed content — avoiding a visual flash.
          const normalizeWs = (s: string) => s.replace(/\s+/g, " ").trim();
          const streamedNorm = normalizeWs(streamedAssistantContent);
          const responseNorm = normalizeWs(safeResponse);
          const finalResponse =
            streamedNorm && (
              streamedNorm === responseNorm ||
              (responseNorm.startsWith(streamedNorm) && streamedNorm.length / responseNorm.length > 0.8)
            )
              ? undefined
              : safeResponse;
          void finalizePromptRun(runId, turnId, "completed", undefined, finalResponse);
        },
        onError: (message, rawOutput) => {
          if (!isCurrentRun(activeRunIdRef.current, runId)) return;
          flushLiveUpdates();
          const safeMessage = sanitizeTerminalOutput(message);
          const safeRawOutput = sanitizeTerminalOutput(rawOutput ?? "");
          const combinedOutput = [safeMessage, safeRawOutput].filter(Boolean).join("\n");
          const errorMessage = isLikelyAuthFailure(combinedOutput)
            ? [
              "Codexa reported an authentication/session error.",
              "Recovery:",
              "  codex login",
              "",
              `Raw error: ${safeMessage}`,
            ].join("\n")
            : safeMessage;

          if (isLikelyAuthFailure(combinedOutput)) {
            setRuntimeUnauthenticated("Auth/session failure detected in neural link.");
          }

          void finalizePromptRun(runId, turnId, "failed", errorMessage);
        },
        onProgress: (update) => {
          perf.inc("progress_updates");
          const safeText = sanitizeTerminalOutput(update.text);
          if (!safeText) return;
          if (isNoiseLine(safeText)) return;
          if (!isCurrentRun(activeRunIdRef.current, runId)) return;
          const safeUpdate: BackendProgressUpdate = {
            id: update.id?.trim() ? update.id : `legacy-progress-${++legacyProgressSequence}`,
            source: update.source,
            text: safeText,
          };
          const existingIndex = pendingProgressUpdates.findIndex((entry) => entry.id === safeUpdate.id);
          if (existingIndex >= 0) {
            pendingProgressUpdates[existingIndex] = safeUpdate;
          } else {
            pendingProgressUpdates.push(safeUpdate);
          }
          scheduleLiveFlush();
        },
      },
    );

    cleanupRef.current = () => {
      flushLiveUpdates();
      // Do one final sync poll before stopping the tracker to capture
      // any last-moment file changes that were in-flight.
      if (activityTracker && preRunSnapshot) {
        try {
          const cleanupSnapshot = captureWorkspaceSnapshot(workspaceRoot);
          const lastActivity = diffWorkspaceSnapshots(preRunSnapshot, cleanupSnapshot);
          if (lastActivity.length > 0 && isCurrentRun(activeRunIdRef.current, runId)) {
            dispatchSession({ type: "RUN_APPEND_ACTIVITY", runId, activity: lastActivity });
          }
        } catch {
          // Non-fatal
        }
      }
      activityTracker?.stop();
      stopProviderRun?.();
      releaseTitleGuard();
    };

    return true;
  }, [
    appendErrorEvent,
    appendSystemEvent,
    authStatus.state,
    finalizePromptRun,
    mode,
    provider,
    dispatchSession,
    setRuntimeUnauthenticated,
    runtimeConfig,
    workspaceRoot,
  ]);

  const runPlanGeneration = useCallback((
    state: Extract<PlanFlowState, { kind: "generating" }>,
    displayPrompt: string,
  ) => {
    const started = startPromptRun(
      displayPrompt,
      buildPlanningPrompt({
        task: state.originalPrompt,
        constraints: state.constraints,
        currentPlan: state.currentPlan,
        pendingFeedback: state.pendingFeedback,
      }),
      {
        runtimeOverride: {
          mode: "suggest",
          planMode: false,
        },
        disableModeAutoUpgrade: true,
        parseActionRequired: false,
        onCompleted: ({ response }) => {
          const nextPlan = response.trim();
          if (!nextPlan) {
            setPlanFlow(resetPlanFlow());
            appendErrorEvent("Plan generation failed", "Plan mode expected a concrete plan, but the response was empty.");
            return;
          }
          const planFilePath = savePlanFile(nextPlan);
          setPlanFlow((current) => finishPlanGeneration(current, nextPlan, planFilePath));
        },
        onFailed: () => {
          setPlanFlow(resetPlanFlow());
        },
        onCanceled: () => {
          setPlanFlow(resetPlanFlow());
        },
      },
    );

    if (!started) {
      setPlanFlow(resetPlanFlow());
    }

    return started;
  }, [appendErrorEvent, savePlanFile, startPromptRun]);

  const startApprovedPlanExecution = useCallback((state: Extract<PlanFlowState, { kind: "awaiting_action" }>) => {
    setPlanFlow(approvePlanExecution(state));
    const started = startPromptRun(
      state.originalPrompt,
      buildPlanExecutionPrompt({
        task: state.originalPrompt,
        approvedPlan: state.currentPlan,
        constraints: state.constraints,
      }),
      {
        runtimeOverride: {
          mode: state.executionMode,
          planMode: false,
        },
        onCompleted: () => {
          setPlanFlow(resetPlanFlow());
        },
        onFailed: () => {
          setPlanFlow(resetPlanFlow());
        },
        onCanceled: () => {
          setPlanFlow(resetPlanFlow());
        },
      },
    );

    if (!started) {
      setPlanFlow(state);
    }
  }, [startPromptRun]);

  const handlePlanAction = useCallback((action: PlanActionValue) => {
    if (planFlow.kind !== "awaiting_action") {
      return;
    }

    switch (action) {
      case "implement":
        startApprovedPlanExecution(planFlow);
        return;
      case "revise":
        setPlanFlow(beginPlanFeedback(planFlow, "revise"));
        return;
      case "constraints":
        setPlanFlow(beginPlanFeedback(planFlow, "constraints"));
        return;
      case "view_plan_file":
        handleViewPlanFile(planFlow.planFilePath);
        return;
      case "cancel":
        setPlanFlow(resetPlanFlow());
        appendSystemEvent("Plan review", "Plan review canceled. No changes were made.");
        return;
      default:
        return;
    }
  }, [appendSystemEvent, handleViewPlanFile, planFlow, startApprovedPlanExecution]);

  const handlePlanFeedbackSubmit = useCallback((value: string) => {
    if (planFlow.kind !== "collecting_feedback") {
      return;
    }

    const feedback = sanitizeTerminalInput(value).trim();
    if (!feedback) {
      appendSystemEvent("Plan review", "Add a short revision note or constraint before submitting.");
      return;
    }

    const nextState = submitPlanFeedback(planFlow, feedback);
    if (nextState.kind !== "generating") {
      return;
    }

    setPlanFlow(nextState);
    runPlanGeneration(nextState, feedback);
  }, [appendSystemEvent, planFlow, runPlanGeneration]);

  const handleSubmit = useCallback(() => {
    perf.mark("submit");
    const value = sanitizeTerminalInput(inputValue).trim();
    if (!value) return;

    if (value === "/perf") {
      const session = perf.getSession();
      const summary = session
        ? perf.buildSummary(session)
        : "No perf data recorded yet. Set CODEXA_PERF=1 and send a prompt first.";
      appendSystemEvent("Perf report", summary);
      dispatchSession({ type: "PUSH_HISTORY", value });
      resetComposer();
      return;
    }

    if (uiState.kind === "AWAITING_USER_ACTION") {
      const originalUserEvent = findUserPromptForTurn(uiState.turnId);
      if (!originalUserEvent) {
        appendErrorEvent("Follow-up unavailable", "The original turn could not be found, so the answer could not be resumed.");
        dispatchSession({ type: "UI_ACTION", action: { type: "DISMISS_TRANSIENT" } });
        return;
      }

      resetComposer();
      startPromptRun(value, buildFollowUpPrompt({
        originalPrompt: originalUserEvent.prompt,
        assistantQuestion: uiState.question,
        userAnswer: value,
      }));
      return;
    }

    // Shell execution: ! prefix routes directly to the terminal
    if (value.startsWith("!")) {
      if (busy) return;
      const shellCmd = value.slice(1).trim();
      if (!shellCmd) return;
      dispatchSession({ type: "PUSH_HISTORY", value });
      resetComposer();
      handleShellExecute(shellCmd);
      return;
    }

    const commandResult = handleCommand(value, {
      config: layeredRuntimeConfig,
      runtime: runtimeConfig,
      resolvedRuntime: resolvedRuntimeConfig,
      settings: {
        directoryDisplayMode,
      },
      workspace: workspaceCommandContext,
      tokensUsed: estimateTokens(conversationChars),
      modelCapabilities,
    });
    const isCommand = commandResult !== null;

    if (!isCommand && busy) {
      return;
    }

    dispatchSession({ type: "PUSH_HISTORY", value });
    resetComposer();

    if (commandResult) {
      switch (commandResult.action) {
        case "exit":
          handleQuit();
          return;
        case "clear":
          handleClear();
          return;
        case "backend":
          if (commandResult.value) {
            setBackendWithNotice(commandResult.value as AvailableBackend);
          }
          return;
        case "model":
          if (commandResult.value) {
            setModelWithNotice(commandResult.value as AvailableModel);
          }
          return;
        case "mode":
          if (commandResult.value) {
            setModeWithNotice(commandResult.value as AvailableMode);
          }
          return;
        case "reasoning":
          if (commandResult.value) {
            setReasoningWithNotice(commandResult.value as ReasoningLevel);
          }
          return;
        case "plan_mode":
          if (commandResult.value) {
            setPlanModeWithNotice(commandResult.value === "on");
          } else if (commandResult.message) {
            appendSystemEvent("Plan mode", commandResult.message);
          }
          return;
        case "status":
        case "runtime_writable_roots_list":
          if (commandResult.message) {
            appendSystemEvent("Runtime status", commandResult.message);
          }
          return;
        case "config_status":
          if (commandResult.message) {
            appendSystemEvent("Config", commandResult.message);
          }
          return;
        case "config_trust_status":
          if (commandResult.message) {
            appendSystemEvent("Config trust", commandResult.message);
          }
          return;
        case "config_trust_set":
          if (commandResult.value) {
            setProjectTrustWithNotice(commandResult.value === "on");
          }
          return;
        case "permissions_status":
          if (commandResult.message) {
            appendSystemEvent("Permissions", commandResult.message);
          }
          return;
        case "runtime_approval_policy":
          if (commandResult.value) {
            setApprovalPolicyWithNotice(commandResult.value as RuntimeApprovalPolicy);
          } else if (commandResult.message) {
            appendSystemEvent("Runtime policy", commandResult.message);
          }
          return;
        case "runtime_sandbox_mode":
          if (commandResult.value) {
            setSandboxModeWithNotice(commandResult.value as RuntimeSandboxMode);
          } else if (commandResult.message) {
            appendSystemEvent("Runtime policy", commandResult.message);
          }
          return;
        case "runtime_network_access":
          if (commandResult.value) {
            setNetworkAccessWithNotice(commandResult.value as RuntimeNetworkAccess);
          } else if (commandResult.message) {
            appendSystemEvent("Runtime policy", commandResult.message);
          }
          return;
        case "runtime_writable_roots_add":
          if (commandResult.value) {
            addWritableRootWithNotice(commandResult.value);
          }
          return;
        case "runtime_writable_roots_remove":
          if (commandResult.value) {
            removeWritableRootWithNotice(commandResult.value);
          }
          return;
        case "runtime_writable_roots_clear":
          clearWritableRootsWithNotice();
          return;
        case "runtime_service_tier":
          if (commandResult.value) {
            setServiceTierWithNotice(commandResult.value as RuntimeServiceTier);
          } else if (commandResult.message) {
            appendSystemEvent("Runtime policy", commandResult.message);
          }
          return;
        case "runtime_personality":
          if (commandResult.value) {
            setPersonalityWithNotice(commandResult.value as RuntimePersonality);
          } else if (commandResult.message) {
            appendSystemEvent("Runtime policy", commandResult.message);
          }
          return;
        case "auth":
          if (commandResult.value) {
            setAuthPreferenceWithNotice(commandResult.value as AuthPreference);
          }
          return;
        case "setting_status":
          if (commandResult.message) {
            appendSystemEvent("Settings", commandResult.message);
          }
          return;
        case "setting_directory":
          if (commandResult.value) {
            setDirectoryDisplayModeWithNotice(commandResult.value as DirectoryDisplayMode);
          } else if (commandResult.message) {
            appendSystemEvent("Settings", commandResult.message);
          }
          return;
        case "theme":
          if (commandResult.value) {
            setThemeSelection((currentTheme) => commitThemeSelection(currentTheme, commandResult.value!));
            if (commandResult.message) {
              appendSystemEvent("Theme", commandResult.message);
            }
          }
          return;
        case "themes":
          if (commandResult.message) {
            appendSystemEvent("Themes", commandResult.message);
          }
          return;
        case "login":
          appendSystemEvent("Login guidance", getLoginGuidance());
          return;
        case "logout":
          appendSystemEvent("Logout guidance", getLogoutGuidance());
          return;
        case "auth_status":
          void refreshAuthStatus(true);
          return;
        case "open_backend_picker":
          openBackendPicker();
          return;
        case "open_model_picker":
          openModelPicker();
          return;
        case "open_mode_picker":
          openModePicker();
          return;
        case "open_reasoning_picker":
          openReasoningPicker();
          return;
        case "open_settings_panel":
          openSettingsPanel();
          return;
        case "open_theme_picker":
          openThemePicker();
          return;
        case "open_permissions_panel":
          openPermissionsPanel();
          return;
        case "open_auth_panel":
          openAuthPanel();
          return;
        case "mouse_toggle": {
          const nextMouse = !(mouseOverride ?? (screen === "main"));
          setMouseOverride(nextMouse);
          appendSystemEvent(
            "Mouse mode updated",
            nextMouse
              ? "Mouse capture enabled — wheel scrolling active. Use Shift+drag for text selection (supported by most terminals)."
              : "Mouse capture disabled — native drag-select active. Use PageUp/PageDown/Home/End to scroll.",
          );
          return;
        }
        case "verbose_toggle": {
          setVerboseMode((current) => !current);
          appendSystemEvent(
            "Verbose mode",
            verboseMode
              ? "Verbose mode disabled — showing concise output."
              : "Verbose mode enabled — showing detailed processing info.",
          );
          return;
        }
        case "copy":
          void handleCopy();
          return;
        case "workspace_relaunch":
          if (commandResult.value) {
            handleWorkspaceRelaunch(commandResult.value);
          }
          return;
        case "workspace":
        case "backends":
        case "models":
        case "help":
        case "unknown":
          if (commandResult.message) {
            appendSystemEvent("Command", commandResult.message);
          }
          return;
        default:
          if (commandResult.message) {
            appendSystemEvent("Command", commandResult.message);
          }
          return;
      }
    }

    const workspaceGuardMessage = getPromptWorkspaceGuardMessage(value, workspaceRoot, allowedWritableRoots);
    if (workspaceGuardMessage) {
      appendErrorEvent("Workspace boundary", workspaceGuardMessage);
      return;
    }
    if (planMode) {
      const nextPlanState = startPlanGeneration(value, mode);
      setPlanFlow(nextPlanState);
      runPlanGeneration(nextPlanState, value);
      return;
    }
    startPromptRun(value, value);
  }, [
    allowedWritableRoots,
    appendErrorEvent,
    appendSystemEvent,
    busy,
    buildFollowUpPrompt,
    conversationChars,
    directoryDisplayMode,
    dispatchSession,
    findUserPromptForTurn,
    focusManager,
    handleCopy,
    handleClear,
    handleQuit,
    handleShellExecute,
    handlePlanFeedbackSubmit,
    handleWorkspaceRelaunch,
    inputValue,
    layeredRuntimeConfig,
    modelCapabilities,
    mode,
    openAuthPanel,
    openBackendPicker,
    openModePicker,
    openModelPicker,
    openPermissionsPanel,
    openReasoningPicker,
    openSettingsPanel,
    planMode,
    refreshAuthStatus,
    resetComposer,
    resolvedRuntimeConfig,
    runPlanGeneration,
    runtimeConfig,
    addWritableRootWithNotice,
    clearWritableRootsWithNotice,
    removeWritableRootWithNotice,
    mode,
    planMode,
    runPlanGeneration,
    setApprovalPolicyWithNotice,
    setAuthPreferenceWithNotice,
    setBackendWithNotice,
    setDirectoryDisplayModeWithNotice,
    setNetworkAccessWithNotice,
    setModeWithNotice,
    setModelWithNotice,
    setPlanModeWithNotice,
    togglePlanModeWithNotice,
    setPersonalityWithNotice,
    setProjectTrustWithNotice,
    setReasoningWithNotice,
    setSandboxModeWithNotice,
    setServiceTierWithNotice,
    startPromptRun,
    themeSelection.committedTheme,
    uiState,
    workspaceCommandContext,
    workspaceRoot,
  ]);

  return (
    <ThemeProvider theme={activeThemeName} customTheme={customTheme}>
      <AppShell
        layout={terminalLayout}
        screen={screen}
        authState={authStatus.state}
        workspaceLabel={workspaceLabel}
        runtimeSummary={runtimeSummary}
        staticEvents={staticEvents}
        activeEvents={activeEvents}
        uiState={uiState}
        verboseMode={verboseMode}
        panel={
          <>
            {screen === "backend-picker" && (
              <BackendPicker
                currentBackend={backend}
                onSelect={(value) => setBackendWithNotice(value as AvailableBackend)}
                onCancel={() => setScreen("main")}
              />
            )}

              {screen === "model-picker" && (
                <ModelReasoningPicker
                  models={selectableModelCapabilities}
                  currentModel={model}
                  currentReasoning={reasoningLevel}
                  onSelect={(m, r) => setModelAndReasoningWithNotice(m as AvailableModel, r as ReasoningLevel)}
                  onCancel={() => setScreen("main")}
                />
              )}

              {screen === "mode-picker" && (
                <ModePicker
                  currentMode={mode}
                  onSelect={(value) => setModeWithNotice(value as AvailableMode)}
                  onCancel={() => setScreen("main")}
                />
              )}

              {screen === "reasoning-picker" && (
                <ReasoningPicker
                  currentModel={model}
                  currentReasoning={reasoningLevel}
                  reasoningLevels={currentReasoningCapabilities}
                  defaultReasoning={currentModelCapability?.defaultReasoningLevel ?? null}
                  onSelect={(value) => setReasoningWithNotice(value as ReasoningLevel)}
                  onCancel={() => setScreen("main")}
                />
              )}

              {screen === "auth-panel" && (
                <AuthPanel
                  focusId={FOCUS_IDS.authPanel}
                  provider={provider}
                  authPreference={authPreference}
                  authStatus={authStatus}
                  authStatusBusy={authStatusBusy}
                  onSetPreference={(value) => setAuthPreferenceWithNotice(value as AuthPreference)}
                  onRefreshAuthStatus={() => {
                    void refreshAuthStatus(false);
                  }}
                  onClose={() => setScreen("main")}
                />
              )}

              {screen === "permissions-panel" && (
                <PermissionsPanel
                  runtime={runtimeConfig}
                  resolvedRuntime={resolvedRuntimeConfig}
                  onSelect={handlePermissionsPanelAction}
                  onCancel={() => setScreen("main")}
                />
              )}

              {screen === "permissions-approval-picker" && (
                <SelectionPanel
                  focusId={FOCUS_IDS.permissionsApprovalPicker}
                  title="Approval Policy"
                  subtitle="Choose how Codexa should handle approval prompts."
                  items={AVAILABLE_APPROVAL_POLICIES.map((item) => ({
                    label: item.id === runtimeConfig.policy.approvalPolicy
                      ? `${item.label}  ✓`
                      : item.label,
                    value: item.id,
                  }))}
                  onSelect={(value) => {
                    setApprovalPolicyWithNotice(value as RuntimeApprovalPolicy);
                    setScreen("permissions-panel");
                  }}
                  onCancel={() => setScreen("permissions-panel")}
                />
              )}

              {screen === "permissions-sandbox-picker" && (
                <SelectionPanel
                  focusId={FOCUS_IDS.permissionsSandboxPicker}
                  title="Sandbox Mode"
                  subtitle="Choose the effective filesystem sandbox for future runs."
                  items={AVAILABLE_SANDBOX_MODES.map((item) => ({
                    label: item.id === runtimeConfig.policy.sandboxMode
                      ? `${item.label}  ✓`
                      : item.label,
                    value: item.id,
                  }))}
                  onSelect={(value) => {
                    setSandboxModeWithNotice(value as RuntimeSandboxMode);
                    setScreen("permissions-panel");
                  }}
                  onCancel={() => setScreen("permissions-panel")}
                />
              )}

              {screen === "permissions-network-picker" && (
                <SelectionPanel
                  focusId={FOCUS_IDS.permissionsNetworkPicker}
                  title="Network Access"
                  subtitle="Choose whether network access is enabled for future runs."
                  items={AVAILABLE_NETWORK_ACCESS_VALUES.map((item) => ({
                    label: item.id === runtimeConfig.policy.networkAccess
                      ? `${item.label}  ✓`
                      : item.label,
                    value: item.id,
                  }))}
                  onSelect={(value) => {
                    setNetworkAccessWithNotice(value as RuntimeNetworkAccess);
                    setScreen("permissions-panel");
                  }}
                  onCancel={() => setScreen("permissions-panel")}
                />
              )}

              {screen === "permissions-add-writable-root" && (
                <TextEntryPanel
                  focusId={FOCUS_IDS.permissionsAddWritableRoot}
                  title="Add Writable Root"
                  subtitle="Enter an absolute path or a path relative to the locked workspace."
                  placeholder="relative\\or\\absolute\\path"
                  inputLabel="Path"
                  footerHint="Enter save  Esc cancel  Backspace delete"
                  onSubmit={(value) => {
                    if (!value.trim()) {
                      appendSystemEvent("Runtime policy", "Writable root path cannot be empty.");
                      return;
                    }
                    addWritableRootWithNotice(value);
                    setScreen("permissions-panel");
                  }}
                  onCancel={() => setScreen("permissions-panel")}
                />
              )}

              {screen === "permissions-remove-writable-root" && (
                <SelectionPanel
                  focusId={FOCUS_IDS.permissionsRemoveWritableRoot}
                  title="Remove Writable Root"
                  subtitle="Select a configured writable root to remove."
                  items={runtimeConfig.policy.writableRoots.map((root) => ({
                    label: root,
                    value: root,
                  }))}
                  onSelect={(value) => {
                    removeWritableRootWithNotice(value);
                    setScreen("permissions-panel");
                  }}
                  onCancel={() => setScreen("permissions-panel")}
                />
              )}

              {screen === "theme-picker" && (
                <ThemePicker
                  currentTheme={themeSelection.committedTheme}
                  onSelect={(value) => {
                    if (themePreviewTimerRef.current) {
                      clearTimeout(themePreviewTimerRef.current);
                      themePreviewTimerRef.current = null;
                    }
                    setThemeSelection((currentTheme) => commitThemeSelection(currentTheme, value));
                    setScreen("main");
                    appendSystemEvent("Theme updated", `Visual theme switched to ${formatThemeLabel(value)}.`);
                    if (value === "custom") {
                      if (!customTheme) {
                        setCustomTheme({ ...THEMES.purple });
                      }
                      appendSystemEvent(
                        "Custom Theme",
                        "Add a \"custom_theme\" object to ~/.codexa-settings.json with any of these keys: BG, PANEL, PANEL_ALT, PANEL_SOFT, BORDER, BORDER_ACTIVE, BORDER_SUBTLE, TEXT, MUTED, DIM, ACCENT, PROMPT, SUCCESS, WARNING, ERROR, INFO, STAR. Unset keys fall back to Midnight Purple defaults.",
                      );
                    }
                  }}
                  onHighlight={(value) => {
                    if (themePreviewTimerRef.current) clearTimeout(themePreviewTimerRef.current);
                    themePreviewTimerRef.current = setTimeout(() => {
                      setThemeSelection((currentTheme) => previewThemeSelection(currentTheme, value));
                    }, 120);
                  }}
                  onCancel={() => {
                    if (themePreviewTimerRef.current) clearTimeout(themePreviewTimerRef.current);
                    themePreviewTimerRef.current = null;
                    setThemeSelection((currentTheme) => cancelThemeSelection(currentTheme));
                    setScreen("main");
                  }}
                />
              )}

              {screen === "settings-panel" && (
                <SettingsPanel
                  focusId={FOCUS_IDS.settingsPanel}
                  settings={USER_SETTING_DEFINITIONS}
                  values={currentUserSettings}
                  onSave={(values) => saveSettingsFromPanel(values as UserSettingValues)}
                  onCancel={() => setScreen("main")}
                />
              )}
          </>
        }
        composer={planFlow.kind === "awaiting_action" ? (
          <PlanActionPicker
            hasPlanFile={hasPlanFileAvailable}
            onSelect={handlePlanAction}
            onCancel={handleCancel}
          />
        ) : planFlow.kind === "collecting_feedback" ? (
          <TextEntryPanel
            focusId={FOCUS_IDS.composer}
            title={planFlow.mode === "revise" ? "Revise plan" : "Add constraints"}
            subtitle={planFlow.mode === "revise"
              ? "Describe what should change in the plan. Enter regenerates it."
              : "Add extra instructions for the plan. Enter regenerates it."}
            inputLabel={planFlow.mode === "revise" ? "Revision" : "Constraint"}
            placeholder={planFlow.mode === "revise"
              ? "e.g. keep it to one file and add tests"
              : "e.g. keep it minimal and avoid touching other files"}
            footerHint="Enter regenerate  Esc back  Backspace delete"
            onSubmit={handlePlanFeedbackSubmit}
            onCancel={() => setPlanFlow((current) => cancelPlanFeedback(current))}
          />
        ) : (
          <MemoizedBottomComposer
            key={composerInstanceKey}
            layout={terminalLayout}
            uiState={uiState}
            mode={mode}
            model={model}
            themeName={activeThemeName}
            reasoningLevel={reasoningLevel}
            planMode={planMode}
            tokensUsed={estimateTokens(conversationChars)}
            modelSpec={currentModelSpec}
            value={inputValue}
            cursor={cursor}
            onChangeInput={handleChangeInput}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            onChangeValue={handleChangeValue}
            onChangeCursor={handleChangeCursor}
            onHistoryUp={handleHistoryUp}
            onHistoryDown={handleHistoryDown}
            onOpenBackendPicker={openBackendPicker}
            onOpenModelPicker={openModelPicker}
            onOpenModePicker={openModePicker}
            onOpenThemePicker={openThemePicker}
            onOpenAuthPanel={openAuthPanel}
            onTogglePlanMode={togglePlanModeWithNotice}
            onClear={handleClear}
            onCycleMode={cycleModeWithNotice}
            onQuit={handleQuit}
          />
        )}
        composerRows={composerRows}
        panelHint={screen !== "main" ? (
          <Box marginTop={1} paddingX={1}>
            <Text color={activeTheme.DIM}>Close the active panel with Esc to return to the composer.</Text>
          </Box>
        ) : null}
      />
    </ThemeProvider>
  );
}
