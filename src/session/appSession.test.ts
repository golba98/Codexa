import assert from "node:assert/strict";
import test from "node:test";
import type { BackendProgressUpdate } from "../core/providers/types.js";
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
    progressEntries: [],
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
  return { id: 3, type: "assistant", createdAt: 3, content, contentChunks: [], turnId };
}

function makeProgressUpdate(id: string, text: string): BackendProgressUpdate {
  return {
    id,
    source: "reasoning",
    text,
  };
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
    runId: 2,
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
    runId: 2,
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
    runId: 2,
    chunk: "First chunk",
    eventFactory: () => makeAssistantEvent(turnId, "First chunk"),
  });

  assert.equal(state.uiState.kind, "RESPONDING");
});

test("RUN_APPLY_PROGRESS_UPDATES preserves separate entries and updates by id", () => {
  const turnId = 30;
  let state = stateWithActiveRun(turnId);

  state = reduceSessionState(state, {
    type: "RUN_APPLY_PROGRESS_UPDATES",
    runId: 2,
    updates: [
      makeProgressUpdate("progress-1", "Checking files"),
      makeProgressUpdate("progress-2", "Comparing snapshots"),
    ],
  });

  state = reduceSessionState(state, {
    type: "RUN_APPLY_PROGRESS_UPDATES",
    runId: 2,
    updates: [
      makeProgressUpdate("progress-1", "Checking files\n\nFound two candidates"),
    ],
  });

  const runEvent = state.activeEvents.find((event): event is RunEvent => event.type === "run");
  assert.ok(runEvent);
  assert.equal(runEvent.progressEntries.length, 2);
  assert.equal(runEvent.progressEntries[0]?.text, "Checking files\n\nFound two candidates");
  assert.equal(runEvent.progressEntries[0]?.blocks.length, 2);
  assert.equal(runEvent.progressEntries[0]?.blocks[0]?.text, "Checking files");
  assert.equal(runEvent.progressEntries[0]?.blocks[0]?.status, "completed");
  assert.equal(runEvent.progressEntries[0]?.blocks[1]?.text, "Found two candidates");
  assert.equal(runEvent.progressEntries[1]?.text, "Comparing snapshots");
  assert.equal(runEvent.progressEntries[1]?.blocks[0]?.text, "Comparing snapshots");
});

test("RUN_APPLY_PROGRESS_UPDATES keeps completed block identities stable while the active block grows", () => {
  const turnId = 31;
  let state = stateWithActiveRun(turnId);

  state = reduceSessionState(state, {
    type: "RUN_APPLY_PROGRESS_UPDATES",
    runId: 2,
    updates: [
      makeProgressUpdate("progress-1", "Inspecting workspace\n\nSwitching to scratch files"),
    ],
  });

  const afterFirstUpdate = state.activeEvents.find((event): event is RunEvent => event.type === "run");
  assert.ok(afterFirstUpdate);
  const completedBlock = afterFirstUpdate.progressEntries[0]?.blocks[0];
  const activeBlock = afterFirstUpdate.progressEntries[0]?.blocks[1];

  state = reduceSessionState(state, {
    type: "RUN_APPLY_PROGRESS_UPDATES",
    runId: 2,
    updates: [
      makeProgressUpdate("progress-1", "Inspecting workspace\n\nSwitching to scratch files in repo root"),
    ],
  });

  const afterSecondUpdate = state.activeEvents.find((event): event is RunEvent => event.type === "run");
  assert.ok(afterSecondUpdate);
  assert.strictEqual(afterSecondUpdate.progressEntries[0]?.blocks[0], completedBlock);
  assert.notStrictEqual(afterSecondUpdate.progressEntries[0]?.blocks[1], activeBlock);
  assert.equal(afterSecondUpdate.progressEntries[0]?.blocks[1]?.text, "Switching to scratch files in repo root");
});

test("reducer preserves response action response ordering across dispatched callbacks", () => {
  const turnId = 32;
  let state = stateWithActiveRun(turnId);

  state = reduceSessionState(state, {
    type: "RUN_APPEND_ASSISTANT_DELTA",
    turnId,
    runId: 2,
    chunk: "First segment.",
    eventFactory: () => makeAssistantEvent(turnId, "First segment."),
  });
  state = reduceSessionState(state, {
    type: "RUN_UPSERT_TOOL_ACTIVITY",
    runId: 2,
    activity: {
      id: "tool-1",
      command: "Get-Content README.md",
      status: "completed",
      startedAt: 10,
      completedAt: 20,
    },
  });
  state = reduceSessionState(state, {
    type: "RUN_APPEND_ASSISTANT_DELTA",
    turnId,
    runId: 2,
    chunk: "Second segment.",
    eventFactory: () => makeAssistantEvent(turnId, "Second segment."),
  });

  const runEvent = state.activeEvents.find((event): event is RunEvent => event.type === "run");
  assert.ok(runEvent);
  assert.deepEqual(runEvent.streamItems?.map((item) => item.kind), ["response", "action", "response"]);
  assert.equal(runEvent.responseSegments?.[0]?.chunks.join(""), "First segment.");
  assert.equal(runEvent.responseSegments?.[1]?.chunks.join(""), "Second segment.");
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
