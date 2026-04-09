import { useCallback, useRef, useState } from "react";
import type { AssistantEvent, RunEvent, ShellEvent, TimelineEvent, UIState, UserPromptEvent } from "./types.js";
import {
  appendRunActivity,
  appendRunThinking,
  appendStaticEvents,
  cancelRunEvent,
  completeRunEvent,
  failRunEvent,
  reduceUIState,
  upsertRunToolActivity,
  type UIStateAction,
} from "./chatLifecycle.js";
import type { RunFileActivity } from "../core/workspaceActivity.js";
import type { RunToolActivity } from "./types.js";

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
  | { type: "RUN_APPEND_PROGRESS"; runId: number; lines: string[] }
  | { type: "RUN_UPSERT_TOOL_ACTIVITY"; runId: number; activity: RunToolActivity }
  | { type: "RUN_APPEND_ASSISTANT_DELTA"; turnId: number; chunk: string; eventFactory: () => AssistantEvent }
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
        uiState: reduceUIState(state.uiState, { type: "DISMISS_TRANSIENT" }),
      };
    case "SET_ACTIVE_EVENTS":
      return { ...state, activeEvents: action.events };
    case "RUN_APPEND_ACTIVITY":
      return {
        ...state,
        activeEvents: state.activeEvents.map((event) =>
          event.id === action.runId && event.type === "run"
            ? appendRunActivity(event as RunEvent, action.activity)
            : event
        ),
      };
    case "RUN_APPEND_PROGRESS":
      return {
        ...state,
        activeEvents: state.activeEvents.map((event) =>
          event.id === action.runId && event.type === "run"
            ? appendRunThinking(event as RunEvent, action.lines)
            : event
        ),
      };
    case "RUN_UPSERT_TOOL_ACTIVITY":
      return {
        ...state,
        activeEvents: state.activeEvents.map((event) =>
          event.id === action.runId && event.type === "run"
            ? upsertRunToolActivity(event as RunEvent, action.activity)
            : event
        ),
      };
    case "RUN_APPEND_ASSISTANT_DELTA": {
      const existingAssistant = state.activeEvents.find(
        (event): event is AssistantEvent => event.type === "assistant" && event.turnId === action.turnId,
      );

      if (existingAssistant) {
        return {
          ...state,
          activeEvents: state.activeEvents.map((event) =>
            event.type === "assistant" && event.turnId === action.turnId
              ? { ...event, content: event.content + action.chunk }
              : event
          ),
          uiState: reduceUIState(state.uiState, { type: "FIRST_ASSISTANT_DELTA", turnId: action.turnId }),
        };
      }

      return {
        ...state,
        activeEvents: [...state.activeEvents, action.eventFactory()],
        uiState: reduceUIState(state.uiState, { type: "FIRST_ASSISTANT_DELTA", turnId: action.turnId }),
      };
    }
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
          uiState: action.status === "completed"
            ? action.question
              ? reduceUIState(state.uiState, { type: "AWAITING_USER_ACTION", turnId: action.turnId, question: action.question })
              : reduceUIState(state.uiState, { type: "RUN_COMPLETED", turnId: action.turnId })
            : action.status === "failed"
              ? reduceUIState(state.uiState, { type: "RUN_FAILED", turnId: action.turnId, message: action.message ?? "Run failed" })
              : reduceUIState(state.uiState, { type: "RUN_CANCELED", turnId: action.turnId }),
        };
      }

      const finalizedRun =
        action.status === "completed"
          ? completeRunEvent(runEvent)
          : action.status === "failed"
            ? failRunEvent(runEvent, action.message ?? "Run failed", action.message ?? "Run failed")
            : cancelRunEvent(runEvent);

      const assistantContent =
        action.status === "completed"
          ? action.response?.trim() ? action.response : assistantEvent?.content ?? ""
          : assistantEvent?.content?.trim() ? assistantEvent.content : "";

      const additions: TimelineEvent[] = [];
      if (userEvent) additions.push(userEvent);
      additions.push(finalizedRun);
      if (assistantContent.trim()) {
        additions.push(
          assistantEvent
            ? { ...assistantEvent, content: action.status === "completed" && action.response ? action.response : assistantEvent.content }
            : action.assistantFactory(),
        );
      }

      return {
        ...state,
        staticEvents: appendStaticEvents(state.staticEvents, additions),
        activeEvents: remainingEvents,
        uiState: action.status === "completed"
          ? action.question
            ? reduceUIState(state.uiState, { type: "AWAITING_USER_ACTION", turnId: action.turnId, question: action.question })
            : reduceUIState(state.uiState, { type: "RUN_COMPLETED", turnId: action.turnId })
          : action.status === "failed"
            ? reduceUIState(state.uiState, { type: "RUN_FAILED", turnId: action.turnId, message: action.message ?? "Run failed" })
            : reduceUIState(state.uiState, { type: "RUN_CANCELED", turnId: action.turnId }),
      };
    }
    case "FINALIZE_SHELL":
      return {
        ...state,
        staticEvents: appendStaticEvents(state.staticEvents, [action.finalEvent]),
        activeEvents: state.activeEvents.filter((event) => !(event.type === "shell" && event.id === action.shellId)),
        uiState: reduceUIState(state.uiState, { type: "SHELL_FINISHED", shellId: action.shellId }),
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
      return { ...state, uiState: reduceUIState(state.uiState, action.action) };
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

      setState((current) => queued.reduce(reduceSessionState, current));
    });
  }, []);

  return { state, dispatch };
}
