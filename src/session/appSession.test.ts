import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantEvent, RunEvent, UserPromptEvent } from "./types.js";
import { createInitialSessionState, reduceSessionState, type SessionState } from "./appSession.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";

function makeUserEvent(turnId: number): UserPromptEvent {
  return { id: 1, type: "user", createdAt: 1, prompt: "Do work", turnId };
}

function makeRunEvent(turnId: number): RunEvent {
  return {
    id: 2,
    type: "run",
    createdAt: 2,
    startedAt: 2,
    durationMs: null,
    backendId: "codex-subprocess",
    backendLabel: "Codexa",
    runtime: TEST_RUNTIME,
    prompt: "Do work",
    thinkingLines: [],
    status: "running",
    summary: "Running",
    truncatedOutput: false,
    toolActivities: [],
    activity: [],
    touchedFileCount: 0,
    errorMessage: null,
    turnId,
  };
}

function makeAssistantEvent(turnId: number, content: string): AssistantEvent {
  return { id: 3, type: "assistant", createdAt: 3, content, turnId };
}

function stateWithActiveRun(turnId: number): SessionState {
  const state = createInitialSessionState();
  return {
    ...state,
    activeEvents: [
      makeUserEvent(turnId),
      makeRunEvent(turnId),
    ],
  };
}

test("FINALIZE_RUN preserves streamed content when response is undefined", () => {
  const turnId = 1;
  let state = stateWithActiveRun(turnId);

  // Simulate streaming: append assistant delta
  state = reduceSessionState(state, {
    type: "RUN_APPEND_ASSISTANT_DELTA",
    turnId,
    chunk: "Streamed response text",
    eventFactory: () => makeAssistantEvent(turnId, "Streamed response text"),
  });

  // Finalize with undefined response — should preserve streamed content
  state = reduceSessionState(state, {
    type: "FINALIZE_RUN",
    runId: 2,
    turnId,
    status: "completed",
    response: undefined,
    assistantFactory: () => makeAssistantEvent(turnId, ""),
  });

  const assistantEvent = state.staticEvents.find(
    (e): e is AssistantEvent => e.type === "assistant",
  );
  assert.ok(assistantEvent, "Assistant event should exist in static events");
  assert.equal(assistantEvent.content, "Streamed response text");
});

test("FINALIZE_RUN replaces streamed content when response differs", () => {
  const turnId = 2;
  let state = stateWithActiveRun(turnId);

  // Simulate streaming
  state = reduceSessionState(state, {
    type: "RUN_APPEND_ASSISTANT_DELTA",
    turnId,
    chunk: "Partial streamed text",
    eventFactory: () => makeAssistantEvent(turnId, "Partial streamed text"),
  });

  // Finalize with different response — should replace
  state = reduceSessionState(state, {
    type: "FINALIZE_RUN",
    runId: 2,
    turnId,
    status: "completed",
    response: "Full sanitized response with additional content",
    assistantFactory: () => makeAssistantEvent(turnId, "Full sanitized response with additional content"),
  });

  const assistantEvent = state.staticEvents.find(
    (e): e is AssistantEvent => e.type === "assistant",
  );
  assert.ok(assistantEvent, "Assistant event should exist in static events");
  assert.equal(assistantEvent.content, "Full sanitized response with additional content");
});

test("RUN_APPEND_ASSISTANT_DELTA transitions UI state to RESPONDING", () => {
  const turnId = 3;
  let state = stateWithActiveRun(turnId);
  state = reduceSessionState(state, {
    type: "UI_ACTION",
    action: { type: "PROMPT_RUN_STARTED", turnId },
  });
  assert.equal(state.uiState.kind, "THINKING");

  state = reduceSessionState(state, {
    type: "RUN_APPEND_ASSISTANT_DELTA",
    turnId,
    chunk: "First chunk",
    eventFactory: () => makeAssistantEvent(turnId, "First chunk"),
  });

  assert.equal(state.uiState.kind, "RESPONDING");
});

test("finalized runs retain their runtime snapshot after unrelated state changes", () => {
  const turnId = 4;
  let state = stateWithActiveRun(turnId);

  state = reduceSessionState(state, {
    type: "FINALIZE_RUN",
    runId: 2,
    turnId,
    status: "completed",
    response: "Done",
    assistantFactory: () => makeAssistantEvent(turnId, "Done"),
  });

  const runEvent = state.staticEvents.find((event): event is RunEvent => event.type === "run");
  assert.ok(runEvent);
  assert.equal(runEvent.runtime.model, TEST_RUNTIME.model);
  assert.equal(runEvent.runtime.policy.sandboxMode, TEST_RUNTIME.policy.sandboxMode);
});
