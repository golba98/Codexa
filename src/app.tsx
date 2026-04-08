import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { spawn } from "child_process";
import { Box, Text, useApp, useFocusManager } from "ink";
import { handleCommand } from "./commands/handler.js";
import { loadSettings, saveSettings } from "./config/persistence.js";
import {
  type AuthPreference,
  type AvailableBackend,
  type AvailableMode,
  type AvailableModel,
  type ReasoningLevel,
  estimateTokens,
  formatAuthPreferenceLabel,
  formatBackendLabel,
  formatModeLabel,
  formatReasoningLabel,
  formatThemeLabel,
  getNextMode,
  normalizeReasoningForModel,
} from "./config/settings.js";
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
import { resolveExecutionMode } from "./core/codexPrompt.js";
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
import { createWorkspaceActivityTracker } from "./core/workspaceActivity.js";
import { resolveWorkspaceRoot } from "./core/workspaceRoot.js";
import { isNoiseLine } from "./core/providers/codexTranscript.js";
import { getBackendProvider } from "./core/providers/registry.js";
import type { BackendProvider } from "./core/providers/types.js";
import type { AssistantEvent, RunEvent, Screen, ShellEvent, TimelineEvent, UIState, UserPromptEvent } from "./session/types.js";
import {
  buildFollowUpPrompt,
  createRunEvent,
  extractAssistantActionRequired,
  guardConfigMutation,
  isCurrentRun,
} from "./session/chatLifecycle.js";
import { findUserPrompt, useAppSessionState } from "./session/appSession.js";
import { AuthPanel } from "./ui/AuthPanel.js";
import { BackendPicker } from "./ui/BackendPicker.js";
import { MemoizedBottomComposer } from "./ui/BottomComposer.js";
import { getShellWidth, useLayout as useTerminalLayout } from "./ui/layout.js";
import { ModelPicker } from "./ui/ModelPicker.js";
import { ModePicker } from "./ui/ModePicker.js";
import { ReasoningPicker } from "./ui/ReasoningPicker.js";
import { RunFooter } from "./ui/RunFooter.js";
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
import { Timeline } from "./ui/Timeline.js";
import { MemoizedTopHeader } from "./ui/TopHeader.js";
import { isBusy as isUiBusy } from "./session/types.js";

let nextEventId = 0;
let nextTurnId = 0;
const ASSISTANT_DELTA_FLUSH_MS = 45;

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

export function App() {
  const { exit } = useApp();
  const focusManager = useFocusManager();
  const initialSettings = useRef(loadSettings());
  const workspaceRoot = useMemo(() => resolveWorkspaceRoot(), []);
  const launchContext = useMemo(() => resolveLaunchContext({ workspaceRoot }), [workspaceRoot]);
  const workspaceCommandContext = useMemo(
    () => buildWorkspaceCommandContext(launchContext),
    [launchContext],
  );
  const modelSpecService = useMemo(() => createModelSpecService(), []);
  const terminalLayout = useTerminalLayout();

  const [backend, setBackend] = useState<AvailableBackend>(initialSettings.current.backend);
  const [model, setModel] = useState<AvailableModel>(initialSettings.current.model);
  const [mode, setMode] = useState<AvailableMode>(initialSettings.current.mode);
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(initialSettings.current.reasoningLevel);
  const [authPreference, setAuthPreference] = useState<AuthPreference>(initialSettings.current.authPreference);
  const [themeSelection, setThemeSelection] = useState<ThemeSelectionState>({
    committedTheme: initialSettings.current.theme,
    previewTheme: null,
  });
  const [customTheme, setCustomTheme] = useState(initialSettings.current.customTheme);
  const [screen, setScreen] = useState<Screen>("main");
  const [composerInstanceKey, setComposerInstanceKey] = useState(0);
  const { state: sessionState, dispatch: dispatchSession } = useAppSessionState();
  const [authStatus, setAuthStatus] = useState<CodexAuthProbeResult>(createInitialAuthStatus());
  const [authStatusBusy, setAuthStatusBusy] = useState(false);
  // Running character total across the conversation — used to estimate token usage
  const [conversationChars, setConversationChars] = useState(0);
  const [modelSpecs, setModelSpecs] = useState<Partial<Record<AvailableModel, ModelSpec>>>({});

  const cleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(true);
  const activeRunIdRef = useRef<number | null>(null);
  const activeTurnIdRef = useRef<number | null>(null);
  const uiStateRef = useRef<UIState>({ kind: "IDLE" });
  const previousScreenRef = useRef<Screen>("main");
  const themePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeThemeName = getDisplayedThemeName(themeSelection);
  const activeTheme =
    activeThemeName === "custom"
      ? { ...THEMES.purple, ...customTheme }
      : (THEMES[activeThemeName] ?? THEMES.purple);
  const currentModelSpec = modelSpecs[model] ?? createLoadingModelSpec(model);
  const { staticEvents, activeEvents, uiState, inputValue, cursor } = sessionState;
  const busy = isUiBusy(uiState);

  const provider: BackendProvider = useMemo(() => getBackendProvider(backend), [backend]);

  useEffect(() => {
    saveSettings({
      backend,
      model,
      mode,
      reasoningLevel,
      layoutStyle: initialSettings.current.layoutStyle,
      theme: themeSelection.committedTheme,
      customTheme,
      authPreference,
    });
  }, [authPreference, backend, customTheme, mode, model, reasoningLevel, themeSelection.committedTheme]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    uiStateRef.current = uiState;
  }, [uiState]);

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
    appendStaticEvent({
      id: createEventId(),
      type: "system",
      createdAt: Date.now(),
      title,
      content,
    });
  }, [appendStaticEvent]);

  const appendErrorEvent = useCallback((title: string, content: string) => {
    appendStaticEvent({
      id: createEventId(),
      type: "error",
      createdAt: Date.now(),
      title,
      content,
    });
  }, [appendStaticEvent]);

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

  const setBackendWithNotice = useCallback((nextBackend: AvailableBackend) => {
    const gate = guardConfigMutation("backend", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the backend.");
      return;
    }

    setBackend(nextBackend);
    setScreen("main");
    appendSystemEvent("Backend updated", `Active backend is now ${formatBackendLabel(nextBackend)}.`);
    if (nextBackend === "codex-subprocess") {
      void refreshAuthStatus(false);
    }
  }, [appendSystemEvent, busy, refreshAuthStatus]);

  const setModeWithNotice = useCallback((nextMode: AvailableMode) => {
    const gate = guardConfigMutation("mode", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the mode.");
      return;
    }

    setMode(nextMode);
    setScreen("main");
    appendSystemEvent("Mode updated", `Execution mode switched to ${formatModeLabel(nextMode)}.`);
  }, [appendSystemEvent, busy]);

  const cycleModeWithNotice = useCallback(() => {
    setModeWithNotice(getNextMode(mode));
  }, [mode, setModeWithNotice]);

  const setReasoningWithNotice = useCallback((nextReasoningLevel: ReasoningLevel) => {
    const gate = guardConfigMutation("reasoning", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the reasoning level.");
      return;
    }

    setReasoningLevel(nextReasoningLevel);
    setScreen("main");
    appendSystemEvent("Reasoning updated", `Reasoning level is now ${formatReasoningLabel(nextReasoningLevel)}.`);
  }, [appendSystemEvent, busy]);

  const setModelWithNotice = useCallback((nextModel: AvailableModel) => {
    const gate = guardConfigMutation("model", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the model.");
      return;
    }

    setModel(nextModel);
    setReasoningLevel((currentReasoning) => normalizeReasoningForModel(nextModel, currentReasoning));
    setScreen("main");
    appendSystemEvent("Model updated", `Active model is now ${nextModel}.`);
  }, [appendSystemEvent, busy]);

  const setAuthPreferenceWithNotice = useCallback((nextPreference: AuthPreference) => {
    setAuthPreference(nextPreference);
    appendSystemEvent("Auth preference updated", `Preference set to ${formatAuthPreferenceLabel(nextPreference)}.`);
  }, [appendSystemEvent]);

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

    setScreen("model-picker");
  }, [appendSystemEvent, busy]);

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

    setScreen("reasoning-picker");
  }, [appendSystemEvent, busy]);

  const openThemePicker = useCallback(() => {
    const gate = guardConfigMutation("theme", busy);
    if (!gate.allowed) {
      appendSystemEvent("Busy", gate.message ?? "Finish the current run before changing the theme.");
      return;
    }

    setScreen("theme-picker");
  }, [appendSystemEvent, busy]);

  const openAuthPanel = useCallback(() => {
    if (busy) {
      appendSystemEvent("Busy", "Finish the current run before opening auth guidance.");
      return;
    }

    setScreen("auth-panel");
  }, [appendSystemEvent, busy]);

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

    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    activeRunIdRef.current = null;
    activeTurnIdRef.current = null;
    focusManager.focus(FOCUS_IDS.composer);
    cleanup?.();
    const parsed = status === "completed" && response?.trim()
      ? extractAssistantActionRequired(response)
      : { content: response ?? "", question: null as string | null };
    dispatchSession({
      type: "FINALIZE_RUN",
      runId,
      turnId,
      status,
      message,
      response: parsed.content,
      question: status === "completed" ? parsed.question : null,
      assistantFactory: () => ({
        id: createEventId(),
        type: "assistant",
        createdAt: Date.now(),
        content: parsed.content?.trim() ? parsed.content : "",
        turnId,
      }),
    });

    return true;
  }, [dispatchSession, focusManager]);

  const cancelActiveRun = useCallback((retainHistory = true) => {
    const runId = activeRunIdRef.current;
    if (runId === null) return false;
    const promptTurnId = activeTurnIdRef.current;

    if (!isCurrentRun(activeRunIdRef.current, runId)) {
      return false;
    }

    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    activeRunIdRef.current = null;
    activeTurnIdRef.current = null;
    focusManager.focus(FOCUS_IDS.composer);
    cleanup?.();

    if (retainHistory) {
      const shellEvent = activeEvents.find((event) => event.type === "shell" && event.id === runId) as ShellEvent | undefined;
      if (shellEvent) {
        dispatchSession({
          type: "FINALIZE_SHELL",
          shellId: runId,
          finalEvent: { ...shellEvent, status: "failed", exitCode: -1, durationMs: null },
        });
      } else {
        const runEvent = activeEvents.find((event) => event.type === "run" && event.id === runId) as RunEvent | undefined;
        if (runEvent) {
          void finalizePromptRun(runId, runEvent.turnId, "canceled");
        } else {
          dispatchSession({ type: "REMOVE_ACTIVE_RUNTIME", runId, turnId: promptTurnId });
        }
      }
    } else {
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
    if (uiState.kind === "AWAITING_USER_ACTION" || uiState.kind === "ERROR") {
      dispatchSession({ type: "UI_ACTION", action: { type: "DISMISS_TRANSIENT" } });
      resetComposer();
    }
  }, [busy, cancelActiveRun, dispatchSession, resetComposer, uiState.kind]);

  const handleQuit = useCallback(() => {
    cancelActiveRun(false);
    exit();
  }, [cancelActiveRun, exit]);

  const handleCopy = useCallback(async () => {
    const assistantEvent = [...staticEvents].reverse().find((event) => event.type === "assistant");
    if (!assistantEvent || assistantEvent.type !== "assistant") {
      appendSystemEvent("Copy unavailable", "There is no assistant response to copy yet.");
      return;
    }

    const ok = await copyToClipboard(assistantEvent.content);
    appendSystemEvent("Clipboard", ok ? "Copied the last assistant response." : "Clipboard unavailable.");
  }, [appendSystemEvent, staticEvents]);

  const handleClear = useCallback(() => {
    cancelActiveRun(false);
    activeTurnIdRef.current = null;
    dispatchSession({ type: "CLEAR_TRANSCRIPT" });
    setConversationChars(0);
    setScreen("main");
    resetComposer();
  }, [cancelActiveRun, dispatchSession, resetComposer]);

  const handleShellExecute = useCallback((command: string) => {
    const guardMessage = getShellWorkspaceGuardMessage(command, workspaceRoot);
    if (guardMessage) {
      appendErrorEvent("Shell command blocked", guardMessage);
      return;
    }

    const shellId = createEventId();
    const startTime = Date.now();

    const initialEvent: ShellEvent = {
      id: shellId,
      createdAt: startTime,
      type: "shell",
      command,
      lines: [],
      stderrLines: [],
      summary: `Executing shell: ${command}`,
      status: "running",
      exitCode: null,
      durationMs: null,
    };

    dispatchSession({ type: "SET_ACTIVE_EVENTS", events: [initialEvent] });
    activeRunIdRef.current = shellId;
    activeTurnIdRef.current = null;
    dispatchSession({ type: "UI_ACTION", action: { type: "SHELL_STARTED", shellId } });

    const runner = runCommand(
      { executable: command, args: [], shell: true, cwd: workspaceRoot },
      {
        onStdout: (text) => {
          const lines = text.split(/\r?\n/).filter(Boolean);
          if (lines.length > 0) {
            dispatchSession({ type: "UPDATE_SHELL_LINES", shellId, stream: "stdout", lines });
          }
        },
        onStderr: (text) => {
          const lines = text.split(/\r?\n/).filter(Boolean);
          if (lines.length > 0) {
            dispatchSession({ type: "UPDATE_SHELL_LINES", shellId, stream: "stderr", lines });
          }
        },
      },
    );

    cleanupRef.current = () => {
      runner.cancel();
    };

    void runner.result.then((result) => {
      if (activeRunIdRef.current !== shellId) return;
      activeRunIdRef.current = null;
      cleanupRef.current = null;
      focusManager.focus(FOCUS_IDS.composer);

      const finalEvent: ShellEvent = {
        ...initialEvent,
        lines: result.stdout.split(/\r?\n/).filter(Boolean),
        stderrLines: result.stderr.split(/\r?\n/).filter(Boolean),
        summary: summarizeCommandResult(command, result),
        status: result.status === "completed" ? "completed" : "failed",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      };

      dispatchSession({ type: "FINALIZE_SHELL", shellId, finalEvent });
    });
  }, [dispatchSession, workspaceRoot]);

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

  const startPromptRun = useCallback((displayPrompt: string, providerPrompt: string) => {
    const executionModeDecision = resolveExecutionMode(mode, providerPrompt);
    const effectiveMode = executionModeDecision.mode;
    if (executionModeDecision.autoUpgraded) {
      appendSystemEvent(
        "Mode auto-upgraded",
        "This prompt looks like a file-editing request, so the run is using AUTO-EDIT instead of SUGGEST.",
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
    const userEvent: UserPromptEvent = {
      id: createEventId(),
      type: "user",
      createdAt: Date.now(),
      prompt: displayPrompt,
      turnId,
    };
    appendStaticEvent(userEvent);

    setConversationChars((count) => count + providerPrompt.length);

    const runId = createEventId();
    activeRunIdRef.current = runId;
    activeTurnIdRef.current = turnId;
    dispatchSession({ type: "UI_ACTION", action: { type: "PROMPT_RUN_STARTED", turnId } });
    dispatchSession({ type: "SET_ACTIVE_EVENTS", events: [
      {
        ...createRunEvent({
          id: runId,
          backendId: backend,
          backendLabel: provider.label,
          mode: effectiveMode,
          model,
          prompt: providerPrompt,
          turnId,
        }),
        summary: "Codexa is thinking...",
      },
    ] });

    const activityTracker = backend === "codex-subprocess"
      ? createWorkspaceActivityTracker({
        rootDir: workspaceRoot,
        onActivity: (activity) => {
          if (!isCurrentRun(activeRunIdRef.current, runId)) return;
          dispatchSession({ type: "RUN_APPEND_ACTIVITY", runId, activity });
        },
      })
      : null;

    let pendingAssistantDelta = "";
    let hasAssistantDelta = false;
    let assistantFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushAssistantDelta = () => {
      if (!pendingAssistantDelta || !isCurrentRun(activeRunIdRef.current, runId)) {
        pendingAssistantDelta = "";
        return;
      }

      const chunk = pendingAssistantDelta;
      pendingAssistantDelta = "";
      dispatchSession({
        type: "RUN_APPEND_ASSISTANT_DELTA",
        turnId,
        chunk,
        eventFactory: () => ({
          id: createEventId(),
          type: "assistant",
          createdAt: Date.now(),
          content: chunk,
          turnId,
        }),
      });
    };

    const flushAssistantDeltaNow = () => {
      if (assistantFlushTimer) {
        clearTimeout(assistantFlushTimer);
        assistantFlushTimer = null;
      }
      flushAssistantDelta();
    };

    const scheduleAssistantFlush = () => {
      if (assistantFlushTimer) return;
      assistantFlushTimer = setTimeout(() => {
        assistantFlushTimer = null;
        flushAssistantDelta();
      }, ASSISTANT_DELTA_FLUSH_MS);
    };

    const stopProviderRun = provider.run(
      providerPrompt,
      { model, mode: effectiveMode, reasoningLevel, workspaceRoot },
      {
        onAssistantDelta: (chunk) => {
          if (!chunk || !isCurrentRun(activeRunIdRef.current, runId)) return;
          hasAssistantDelta = true;
          pendingAssistantDelta += chunk;
          scheduleAssistantFlush();
        },
        onToolActivity: (activity) => {
          if (!isCurrentRun(activeRunIdRef.current, runId)) return;
          dispatchSession({ type: "RUN_UPSERT_TOOL_ACTIVITY", runId, activity });
        },
        onResponse: (response) => {
          if (!isCurrentRun(activeRunIdRef.current, runId)) return;
          flushAssistantDeltaNow();
          setConversationChars((count) => count + response.length);
          void finalizePromptRun(runId, turnId, "completed", undefined, response);
        },
        onError: (message, rawOutput) => {
          if (!isCurrentRun(activeRunIdRef.current, runId)) return;
          flushAssistantDeltaNow();
          const combinedOutput = [message, rawOutput].filter(Boolean).join("\n");
          const errorMessage = isLikelyAuthFailure(combinedOutput)
            ? [
              "Codexa reported an authentication/session error.",
              "Recovery:",
              "  codex login",
              "",
              `Raw error: ${message}`,
            ].join("\n")
            : message;

          if (isLikelyAuthFailure(combinedOutput)) {
            setRuntimeUnauthenticated("Auth/session failure detected in neural link.");
          }

          void finalizePromptRun(runId, turnId, "failed", errorMessage);
        },
        onProgress: (line) => {
          if (isNoiseLine(line)) return;
          if (!isCurrentRun(activeRunIdRef.current, runId)) return;
          const currentUiState = uiStateRef.current;
          const isRespondingForTurn = currentUiState.kind === "RESPONDING" && currentUiState.turnId === turnId;
          if (hasAssistantDelta || isRespondingForTurn) return;
          dispatchSession({ type: "RUN_APPEND_PROGRESS", runId, lines: [line] });
        },
      },
    );

    cleanupRef.current = () => {
      flushAssistantDeltaNow();
      activityTracker?.stop();
      stopProviderRun?.();
    };

    return true;
  }, [
    appendErrorEvent,
    appendStaticEvent,
    appendSystemEvent,
    authStatus.state,
    backend,
    finalizePromptRun,
    model,
    mode,
    provider,
    reasoningLevel,
    dispatchSession,
    setRuntimeUnauthenticated,
    workspaceRoot,
  ]);

  const handleSubmit = useCallback(() => {
    const value = inputValue.trim();
    if (!value) return;

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

    const commandResult = handleCommand(
      value,
      backend,
      model,
      mode,
      authPreference,
      reasoningLevel,
      themeSelection.committedTheme,
      workspaceCommandContext,
    );
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
        case "auth":
          if (commandResult.value) {
            setAuthPreferenceWithNotice(commandResult.value as AuthPreference);
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
        case "open_theme_picker":
          openThemePicker();
          return;
        case "open_auth_panel":
          openAuthPanel();
          return;
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

    const workspaceGuardMessage = getPromptWorkspaceGuardMessage(value, workspaceRoot);
    if (workspaceGuardMessage) {
      appendErrorEvent("Workspace boundary", workspaceGuardMessage);
      return;
    }
    startPromptRun(value, value);
  }, [
    appendErrorEvent,
    appendSystemEvent,
    backend,
    busy,
    buildFollowUpPrompt,
    dispatchSession,
    findUserPromptForTurn,
    focusManager,
    handleCopy,
    handleClear,
    handleQuit,
    handleShellExecute,
    handleWorkspaceRelaunch,
    inputValue,
    openAuthPanel,
    openBackendPicker,
    openModePicker,
    openModelPicker,
    openReasoningPicker,
    refreshAuthStatus,
    resetComposer,
    setAuthPreferenceWithNotice,
    setBackendWithNotice,
    setModeWithNotice,
    setModelWithNotice,
    setReasoningWithNotice,
    startPromptRun,
    themeSelection.committedTheme,
    uiState,
    workspaceCommandContext,
    workspaceRoot,
  ]);

  // Keep a small gutter so wide bordered cards don't trip a horizontal
  // scrollbar when the shell content lands exactly on the terminal edge.
  const shellWidth = getShellWidth(terminalLayout.cols);
  const showComposer = screen === "main";

  return (
    <ThemeProvider theme={activeThemeName} customTheme={customTheme}>
      <Box flexDirection="column" width={shellWidth} height={terminalLayout.rows - 1}>
        {screen === "main" && (
          <Box flexDirection="column" borderBottom={true} flexShrink={0}>
            <MemoizedTopHeader
              authState={authStatus.state}
              workspaceRoot={workspaceRoot}
              layout={terminalLayout}
            />
          </Box>
        )}

        <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingBottom={1}>
          <Timeline events={[...staticEvents, ...activeEvents]} layout={terminalLayout} uiState={uiState} />
        </Box>

        {screen === "backend-picker" && (
          <BackendPicker
            currentBackend={backend}
            onSelect={(value) => setBackendWithNotice(value as AvailableBackend)}
            onCancel={() => setScreen("main")}
          />
        )}

        {screen === "model-picker" && (
          <ModelPicker
            currentModel={model}
            onSelect={(value) => setModelWithNotice(value as AvailableModel)}
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

        {screen === "theme-picker" && (
          <ThemePicker
            currentTheme={themeSelection.committedTheme}
            onSelect={(value) => {
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
              setThemeSelection((currentTheme) => cancelThemeSelection(currentTheme));
              setScreen("main");
            }}
          />
        )}

        {showComposer && (
          <Box flexDirection="column" flexShrink={0}>
            <MemoizedBottomComposer
              key={composerInstanceKey}
              layout={terminalLayout}
              uiState={uiState}
              mode={mode}
              model={model}
              reasoningLevel={reasoningLevel}
              tokensUsed={estimateTokens(conversationChars)}
              modelSpec={currentModelSpec}
              value={inputValue}
              cursor={cursor}
              onChangeInput={(value, nextCursor) => dispatchSession({ type: "SET_INPUT", value, cursor: nextCursor })}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              onChangeValue={(value) => dispatchSession({ type: "SET_INPUT", value, cursor })}
              onChangeCursor={(nextCursor) => dispatchSession({ type: "SET_INPUT", value: inputValue, cursor: nextCursor })}
              onHistoryUp={handleHistoryUp}
              onHistoryDown={handleHistoryDown}
              onOpenBackendPicker={openBackendPicker}
              onOpenModelPicker={openModelPicker}
              onOpenModePicker={openModePicker}
              onOpenThemePicker={openThemePicker}
              onOpenAuthPanel={openAuthPanel}
              onClear={handleClear}
              onCycleMode={cycleModeWithNotice}
              onQuit={handleQuit}
            />
          </Box>
        )}

        {screen !== "main" && (
          <Box marginTop={1} paddingX={1}>
            <Text color={activeTheme.DIM}>Close the active panel with Esc to return to the composer.</Text>
          </Box>
        )}
      </Box>
    </ThemeProvider>
  );
}
