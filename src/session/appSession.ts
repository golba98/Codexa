import { useCallback, useRef, useState } from "react";
import type { BackendProgressUpdate } from "../core/providers/types.js";
import type { AssistantEvent, RunEvent, ShellEvent, TimelineEvent, UIState, UserPromptEvent } from "./types.js";
import { getAssistantContent } from "./types.js";
import {
  appendRunActivity,
  appendRunResponseChunk,
  appendRunThinking,
  appendStaticEvents,
  cancelRunEvent,
  completeRunEvent,
  failRunEvent,
  finalizeResponseSegments,
  reduceUIState,
  upsertRunToolActivity,
  type UIStateAction,
} from "./chatLifecycle.js";
import type { RunFileActivity } from "../core/workspaceActivity.js";
import type { RunToolActivity } from "./types.js";
import type { LiveRenderUpdate } from "./liveRenderScheduler.js";
import * as renderDebug from "../core/perf/renderDebug.js";

export interface SessionState {
  staticEvents: TimelineEvent[];
  activeEvents: TimelineEvent[];
  uiState: UIState;
  inputValue: string;
  cursor: number;
  history: string[];
  historyIndex: number;
}

export type SessionAction =
  | { type: "APPEND_STATIC_EVENT"; event: TimelineEvent }
  | { type: "APPEND_STATIC_EVENTS"; events: TimelineEvent[] }
  | { type: "SET_INPUT"; value: string; cursor?: number }
  | { type: "RESET_INPUT" }
  | { type: "PUSH_HISTORY"; value: string }
  | { type: "HISTORY_UP" }
  | { type: "HISTORY_DOWN" }
  | { type: "CLEAR_TRANSCRIPT" }
  | { type: "SET_ACTIVE_EVENTS"; events: TimelineEvent[] }
  | { type: "RUN_APPEND_ACTIVITY"; runId: number; activity: RunFileActivity[] }
  | { type: "RUN_APPLY_PROGRESS_UPDATES"; runId: number; updates: BackendProgressUpdate[] }
  | { type: "RUN_UPSERT_TOOL_ACTIVITY"; runId: number; activity: RunToolActivity }
  | {
    type: "RUN_APPEND_ASSISTANT_DELTA";
    turnId: number;
    runId: number;
    chunk: string;
    eventFactory: () => AssistantEvent;
  }
  | {
    type: "RUN_APPLY_LIVE_UPDATES";
    turnId: number;
    runId: number;
    updates: LiveRenderUpdate[];
    assistantEventFactory: (chunk: string) => AssistantEvent;
  }
  | {
    type: "FINALIZE_RUN";
    runId: number;
    turnId: number;
    status: "completed" | "failed" | "canceled";
    message?: string;
    response?: string;
    question?: string | null;
    assistantFactory: () => AssistantEvent;
  }
  | { type: "FINALIZE_SHELL"; shellId: number; finalEvent: ShellEvent }
  | { type: "UPDATE_SHELL_LINES"; shellId: number; stream: "stdout" | "stderr"; lines: string[] }
  | { type: "REMOVE_ACTIVE_RUNTIME"; runId: number; turnId?: number | null }
  | { type: "UI_ACTION"; action: UIStateAction };

export function createInitialSessionState(): SessionState {
  return {
    staticEvents: [],
    activeEvents: [],
    uiState: { kind: "IDLE" },
    inputValue: "",
    cursor: 0,
    history: [],
    historyIndex: -1,
  };
}

function updateShellLines(event: ShellEvent, action: Extract<SessionAction, { type: "UPDATE_SHELL_LINES" }>): ShellEvent {
  if (action.stream === "stdout") {
    return { ...event, lines: [...event.lines, ...action.lines] };
  }
  return { ...event, stderrLines: [...event.stderrLines, ...action.lines] };
}

export function findUserPrompt(events: TimelineEvent[], turnId: number): UserPromptEvent | null {
  const event = events.find((entry): entry is UserPromptEvent => entry.type === "user" && entry.turnId === turnId);
  return event ?? null;
}

function reconcileAssistantContent(
  streamed: string | undefined,
  response: string | undefined,
  status: "completed" | "failed" | "canceled",
): string {
  if (status !== "completed") return streamed?.trim() ? streamed : "";
  if (!response?.trim()) return streamed ?? "";
  if (!streamed?.trim()) return response;

  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const sNorm = norm(streamed);
  const rNorm = norm(response);

  if (sNorm === rNorm) return streamed;                    // exact → keep streamed formatting
  if (rNorm.startsWith(sNorm) && sNorm.length > 20)       // streamed is prefix → use response
    return response;
  return response;                                          // different → authoritative response wins
}

function isAnimatedLifecycleKind(kind: UIState["kind"]): boolean {
  return kind === "THINKING" || kind === "RESPONDING" || kind === "SHELL_RUNNING";
}

function stateMatchesTurn(state: UIState, turnId: number): boolean {
  return "turnId" in state && state.turnId === turnId;
}

function getUIActionTurnId(action: UIStateAction): number | null {
  return "turnId" in action ? action.turnId : null;
}

function getUIStateTurnId(state: UIState): number | null {
  return "turnId" in state ? state.turnId : null;
}

function traceUITransition(params: {
  previous: UIState;
  next: UIState;
  reason: string;
  runId?: number;
  turnId?: number | null;
}): void {
  if (params.previous === params.next) return;

  renderDebug.traceLifecycleTransition({
    runId: params.runId,
    turnId: params.turnId ?? getUIStateTurnId(params.next) ?? getUIStateTurnId(params.previous),
    prevKind: params.previous.kind,
    nextKind: params.next.kind,
    reason: params.reason,
    composerEnabled: !isAnimatedLifecycleKind(params.next.kind),
    animationActive: isAnimatedLifecycleKind(params.next.kind),
    ts: Date.now(),
  });
}

function reduceTracedUIState(
  state: UIState,
  action: UIStateAction,
  options: { reason?: string; runId?: number } = {},
): UIState {
  const next = reduceUIState(state, action);
  traceUITransition({
    previous: state,
    next,
    reason: options.reason ?? action.type,
    runId: options.runId,
    turnId: getUIActionTurnId(action),
  });
  return next;
}

function terminalActionForFinalize(action: Extract<SessionAction, { type: "FINALIZE_RUN" }>): UIStateAction {
  if (action.status === "completed") {
    return action.question
      ? { type: "AWAITING_USER_ACTION", turnId: action.turnId, question: action.question }
      : { type: "RUN_COMPLETED", turnId: action.turnId };
  }

  if (action.status === "failed") {
    return { type: "RUN_FAILED", turnId: action.turnId, message: action.message ?? "Run failed" };
  }

  return { type: "RUN_CANCELED", turnId: action.turnId };
}

function enforceFinalizePostCondition(
  previous: UIState,
  reduced: UIState,
  action: Extract<SessionAction, { type: "FINALIZE_RUN" }>,
): UIState {
  if (!stateMatchesTurn(previous, action.turnId)) {
    return reduced;
  }

  const forced: UIState = action.status === "completed" && action.question
    ? { kind: "AWAITING_USER_ACTION", turnId: action.turnId, question: action.question }
    : action.status === "failed"
      ? { kind: "ERROR", turnId: action.turnId, message: action.message ?? "Run failed" }
      : { kind: "IDLE" };

  if (
    reduced.kind === forced.kind
    && getUIStateTurnId(reduced) === getUIStateTurnId(forced)
    && (!("message" in forced) || ("message" in reduced && reduced.message === forced.message))
    && (!("question" in forced) || ("question" in reduced && reduced.question === forced.question))
  ) {
    return reduced;
  }

  traceUITransition({
    previous: reduced,
    next: forced,
    reason: "FINALIZE_RUN_POST_CONDITION",
    runId: action.runId,
    turnId: action.turnId,
  });
  return forced;
}

function reduceFinalizeUIState(
  state: UIState,
  action: Extract<SessionAction, { type: "FINALIZE_RUN" }>,
): UIState {
  const reduced = reduceTracedUIState(
    state,
    terminalActionForFinalize(action),
    { reason: `FINALIZE_RUN:${action.status}`, runId: action.runId },
  );
  return enforceFinalizePostCondition(state, reduced, action);
}

export function reduceSessionState(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "APPEND_STATIC_EVENT":
      return { ...state, staticEvents: appendStaticEvents(state.staticEvents, [action.event]) };
    case "APPEND_STATIC_EVENTS":
      return { ...state, staticEvents: appendStaticEvents(state.staticEvents, action.events) };
    case "SET_INPUT":
      return {
        ...state,
        inputValue: action.value,
        cursor: Math.max(0, Math.min(action.cursor ?? action.value.length, action.value.length)),
      };
    case "RESET_INPUT":
      return { ...state, inputValue: "", cursor: 0, historyIndex: -1 };
    case "PUSH_HISTORY":
      return {
        ...state,
        history: [action.value, ...state.history.filter((entry) => entry !== action.value)].slice(0, 50),
        historyIndex: -1,
      };
    case "HISTORY_UP": {
      if (state.history.length === 0) return state;
      const nextIndex = Math.min(state.historyIndex + 1, state.history.length - 1);
      const nextValue = state.history[nextIndex] ?? "";
      return { ...state, historyIndex: nextIndex, inputValue: nextValue, cursor: nextValue.length };
    }
    case "HISTORY_DOWN": {
      if (state.historyIndex <= 0) {
        return { ...state, historyIndex: -1, inputValue: "", cursor: 0 };
      }
      const nextIndex = state.historyIndex - 1;
      const nextValue = state.history[nextIndex] ?? "";
      return { ...state, historyIndex: nextIndex, inputValue: nextValue, cursor: nextValue.length };
    }
    case "CLEAR_TRANSCRIPT":
      return {
        ...state,
        staticEvents: [],
        activeEvents: [],
        uiState: reduceTracedUIState(state.uiState, { type: "DISMISS_TRANSIENT" }),
      };
    case "SET_ACTIVE_EVENTS":
      return { ...state, activeEvents: action.events };
    case "RUN_APPEND_ACTIVITY": {
      if (!state.activeEvents.some((event) => event.id === action.runId && event.type === "run")) {
        return state;
      }
      return {
        ...state,
        activeEvents: state.activeEvents.map((event) =>
          event.id === action.runId && event.type === "run"
            ? appendRunActivity(event as RunEvent, action.activity)
            : event
        ),
      };
    }
    case "RUN_APPLY_PROGRESS_UPDATES": {
      if (!state.activeEvents.some((event) => event.id === action.runId && event.type === "run")) {
        return state;
      }
      return {
        ...state,
        activeEvents: state.activeEvents.map((event) =>
          event.id === action.runId && event.type === "run"
            ? appendRunThinking(event as RunEvent, action.updates)
            : event
        ),
      };
    }
    case "RUN_UPSERT_TOOL_ACTIVITY": {
      if (!state.activeEvents.some((event) => event.id === action.runId && event.type === "run")) {
        return state;
      }
      return {
        ...state,
        activeEvents: state.activeEvents.map((event) =>
          event.id === action.runId && event.type === "run"
            ? upsertRunToolActivity(event as RunEvent, action.activity)
            : event
        ),
      };
    }
    case "RUN_APPEND_ASSISTANT_DELTA": {
      const existingRun = state.activeEvents.find(
        (event): event is RunEvent =>
          event.type === "run" && event.id === action.runId && event.turnId === action.turnId,
      );
      if (!existingRun) {
        return state;
      }

      const existingAssistant = state.activeEvents.find(
        (event): event is AssistantEvent => event.type === "assistant" && event.turnId === action.turnId,
      );

      const updateRun = (event: TimelineEvent): TimelineEvent => (
        event.id === action.runId && event.type === "run"
          ? appendRunResponseChunk(event as RunEvent, action.chunk)
          : event
      );

      if (existingAssistant) {
        return {
          ...state,
          activeEvents: state.activeEvents.map((event) => {
            if (event.type === "assistant" && event.turnId === action.turnId) {
              return { ...event, contentChunks: [...(event as AssistantEvent).contentChunks, action.chunk] };
            }
            return updateRun(event);
          }),
          uiState: reduceTracedUIState(
            state.uiState,
            { type: "FIRST_ASSISTANT_DELTA", turnId: action.turnId },
            { runId: action.runId },
          ),
        };
      }

      return {
        ...state,
        activeEvents: [...state.activeEvents.map(updateRun), action.eventFactory()],
        uiState: reduceTracedUIState(
          state.uiState,
          { type: "FIRST_ASSISTANT_DELTA", turnId: action.turnId },
          { runId: action.runId },
        ),
      };
    }
    case "RUN_APPLY_LIVE_UPDATES":
      return action.updates.reduce((currentState, update) => {
        if (update.type === "activity") {
          return reduceSessionState(currentState, {
            type: "RUN_APPEND_ACTIVITY",
            runId: action.runId,
            activity: update.activity,
          });
        }

        if (update.type === "progress") {
          return reduceSessionState(currentState, {
            type: "RUN_APPLY_PROGRESS_UPDATES",
            runId: action.runId,
            updates: [update.update],
          });
        }

        if (update.type === "tool") {
          return reduceSessionState(currentState, {
            type: "RUN_UPSERT_TOOL_ACTIVITY",
            runId: action.runId,
            activity: update.activity,
          });
        }

        return reduceSessionState(currentState, {
          type: "RUN_APPEND_ASSISTANT_DELTA",
          turnId: action.turnId,
          runId: action.runId,
          chunk: update.chunk,
          eventFactory: () => action.assistantEventFactory(update.chunk),
        });
      }, state);
    case "FINALIZE_RUN": {
      const userEvent = state.activeEvents.find(
        (event): event is UserPromptEvent => event.type === "user" && event.turnId === action.turnId,
      );
      const runEvent = state.activeEvents.find(
        (event): event is RunEvent => event.type === "run" && event.id === action.runId,
      );
      const assistantEvent = state.activeEvents.find(
        (event): event is AssistantEvent => event.type === "assistant" && event.turnId === action.turnId,
      );

      const remainingEvents = state.activeEvents.filter((event) =>
        !(event.type === "run" && event.id === action.runId)
        && !(event.type === "assistant" && event.turnId === action.turnId)
        && !(event.type === "user" && event.turnId === action.turnId),
      );

      if (!runEvent) {
        return {
          ...state,
          activeEvents: remainingEvents,
          uiState: reduceFinalizeUIState(state.uiState, action),
        };
      }

      const baseFinalizedRun =
        action.status === "completed"
          ? completeRunEvent(runEvent)
          : action.status === "failed"
            ? failRunEvent(runEvent, action.message ?? "Run failed", action.message ?? "Run failed")
            : cancelRunEvent(runEvent);

      const streamedContent = getAssistantContent(assistantEvent);
      const assistantContent = reconcileAssistantContent(
        streamedContent,
        action.response,
        action.status,
      );

      // Reconcile response segments with the authoritative final text.
      // If the authoritative text differs from streamed (or no segments exist),
      // rewrite/synthesize the trailing segment so the rendered timeline
      // shows the final answer in chronological position.
      const trimmedFinal = assistantContent.trim();
      const streamedTrim = streamedContent.trim();
      const overrideSegmentText = trimmedFinal && trimmedFinal !== streamedTrim
        ? assistantContent
        : undefined;
      const finalizedRun = finalizeResponseSegments(baseFinalizedRun, overrideSegmentText);

      const additions: TimelineEvent[] = [];
      if (userEvent) additions.push(userEvent);
      additions.push(finalizedRun);
      if (assistantContent.trim()) {
        additions.push(
          assistantEvent
            ? { ...assistantEvent, content: assistantContent, contentChunks: [] }
            : action.assistantFactory(),
        );
      }

      return {
        ...state,
        staticEvents: appendStaticEvents(state.staticEvents, additions),
        activeEvents: remainingEvents,
        uiState: reduceFinalizeUIState(state.uiState, action),
      };
    }
    case "FINALIZE_SHELL":
      return {
        ...state,
        staticEvents: appendStaticEvents(state.staticEvents, [action.finalEvent]),
        activeEvents: state.activeEvents.filter((event) => !(event.type === "shell" && event.id === action.shellId)),
        uiState: reduceTracedUIState(state.uiState, { type: "SHELL_FINISHED", shellId: action.shellId }),
      };
    case "UPDATE_SHELL_LINES":
      return {
        ...state,
        activeEvents: state.activeEvents.map((event) =>
          event.id === action.shellId && event.type === "shell"
            ? updateShellLines(event as ShellEvent, action)
            : event
        ),
      };
    case "REMOVE_ACTIVE_RUNTIME":
      return {
        ...state,
        activeEvents: state.activeEvents.filter((event) =>
          !(event.type === "run" && event.id === action.runId)
          && !(event.type === "assistant" && action.turnId !== null && action.turnId !== undefined && event.turnId === action.turnId)
          && !(event.type === "shell" && event.id === action.runId)
          && !(event.type === "user" && action.turnId !== null && action.turnId !== undefined && event.turnId === action.turnId),
        ),
      };
    case "UI_ACTION":
      return { ...state, uiState: reduceTracedUIState(state.uiState, action.action) };
    default:
      return state;
  }
}

export function useAppSessionState() {
  const [state, setState] = useState<SessionState>(createInitialSessionState);
  const queueRef = useRef<SessionAction[]>([]);
  const scheduledRef = useRef(false);

  const dispatch = useCallback((action: SessionAction) => {
    queueRef.current.push(action);
    if (scheduledRef.current) return;

    scheduledRef.current = true;
    queueMicrotask(() => {
      scheduledRef.current = false;
      const queued = queueRef.current.splice(0, queueRef.current.length);
      if (queued.length === 0) return;

      renderDebug.traceTimelineUpdate({
        queuedActions: queued.length,
        actionTypes: queued.map((item) => item.type),
      });
      setState((current) => queued.reduce(reduceSessionState, current));
    });
  }, []);

  return { state, dispatch };
}
