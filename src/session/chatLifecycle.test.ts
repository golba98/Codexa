import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CHAT_LINES, MAX_VISIBLE_EVENTS } from "../config/settings.js";
import {
  appendRunActivity,
  appendRunThinking,
  appendStaticEvents,
  buildFollowUpPrompt,
  cancelRunEvent,
  completeRunEvent,
  createRunEvent,
  detectAgentQuestion,
  extractAssistantActionRequired,
  reduceUIState,
  guardConfigMutation,
  isCurrentRun,
} from "./chatLifecycle.js";
import type { TimelineEvent, UIState } from "./types.js";

function makeSystemEvent(id: number): TimelineEvent {
  return {
    id,
    type: "system",
    createdAt: id,
    title: `Event ${id}`,
    content: `Content ${id}`,
  };
}

test("creates a running run event", () => {
  const run = createRunEvent({
    id: 1,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    mode: "suggest",
    model: "gpt-5.4",
    prompt: "Hello",
    turnId: 1,
  });

  assert.equal(run.status, "running");
  assert.equal(run.thinkingLines.length, 0);
  assert.equal(run.truncatedOutput, false);
  assert.equal(run.activity.length, 0);
  assert.equal(run.touchedFileCount, 0);
});

test("caps streamed run output and marks truncation", () => {
  const run = createRunEvent({
    id: 2,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    mode: "suggest",
    model: "gpt-5.4",
    prompt: "Hello",
    turnId: 2,
  });

  const lines = Array.from({ length: MAX_CHAT_LINES + 4 }, (_, index) => `line ${index + 1}`);
  const capped = appendRunThinking(run, lines);

  assert.equal(capped.thinkingLines.length, MAX_CHAT_LINES);
  assert.equal(capped.thinkingLines[0], `line 5`);
  assert.equal(capped.thinkingLines[capped.thinkingLines.length - 1], `line ${MAX_CHAT_LINES + 4}`);
  assert.equal(capped.truncatedOutput, true);
});

test("completes and cancels runs with stable terminal statuses", () => {
  const running = appendRunActivity(appendRunThinking(
    createRunEvent({
      id: 3,
      backendId: "codex-subprocess",
      backendLabel: "Codex CLI",
      mode: "suggest",
      model: "gpt-5.4",
      prompt: "Hello",
      turnId: 3,
    }),
    ["first line"],
  ), [{
    path: "src/app.tsx",
    operation: "modified",
    detectedAt: 10,
    addedLines: 2,
    removedLines: 1,
  }]);

  const completed = completeRunEvent(running);
  const canceled = cancelRunEvent(running);

  assert.equal(completed.status, "completed");
  assert.match(completed.summary, /1 file touched/i);
  assert.equal(completed.activitySummary?.modified, 1);
  assert.equal(canceled.status, "canceled");
  assert.match(canceled.summary, /1 file touched/i);
});

test("appends structured file activity and tracks unique touched files", () => {
  const run = appendRunActivity(
    createRunEvent({
      id: 4,
      backendId: "codex-subprocess",
      backendLabel: "Codex CLI",
      mode: "suggest",
      model: "gpt-5.4",
      prompt: "Build a feature",
      turnId: 4,
    }),
    [
      { path: "README.md", operation: "created", detectedAt: 1, addedLines: 5 },
      { path: "src/app.tsx", operation: "modified", detectedAt: 2, addedLines: 3, removedLines: 1 },
      { path: "src/app.tsx", operation: "modified", detectedAt: 3, addedLines: 4, removedLines: 2 },
    ],
  );

  assert.equal(run.activity.length, 2);
  assert.equal(run.touchedFileCount, 2);
  assert.equal(run.activitySummary?.created, 1);
  assert.equal(run.activitySummary?.modified, 1);
  assert.match(run.summary, /2 files/i);
});

test("trims static history to the newest visible events", () => {
  const events = Array.from({ length: MAX_VISIBLE_EVENTS + 3 }, (_, index) => makeSystemEvent(index + 1));
  const trimmed = appendStaticEvents([], events);

  assert.equal(trimmed.length, MAX_VISIBLE_EVENTS + 3);
  assert.equal(trimmed[0]?.id, 1);
  assert.equal(trimmed[trimmed.length - 1]?.id, MAX_VISIBLE_EVENTS + 3);
});

test("blocks config changes while a run is active", () => {
  const blocked = guardConfigMutation("model", true);
  const allowed = guardConfigMutation("model", false);

  assert.equal(blocked.allowed, false);
  assert.match(blocked.message ?? "", /model/i);
  assert.equal(allowed.allowed, true);
});

test("ignores stale run callbacks after cancellation", () => {
  assert.equal(isCurrentRun(null, 7), false);
  assert.equal(isCurrentRun(7, 7), true);
  assert.equal(isCurrentRun(8, 7), false);
});

test("detects explicit and heuristic agent questions", () => {
  assert.equal(detectAgentQuestion("Done.\n[QUESTION]: Which file should I update?"), "Which file should I update?");
  assert.equal(detectAgentQuestion("Need one detail first.\nShould I use Redis?"), "Should I use Redis?");
});

test("extracts ACTION REQUIRED blocks and removes them from assistant output", () => {
  const message = [
    "Implemented the requested updates.",
    "",
    "**=========================================**",
    "**[ACTION REQUIRED]**",
    "**Verification Question:**",
    "**Are you satisfied with the visual updates to bolding and visibility? (y/n)**",
    "**=========================================**",
  ].join("\n");

  const parsed = extractAssistantActionRequired(message);
  assert.equal(parsed.content, "Implemented the requested updates.");
  assert.equal(parsed.question, "Are you satisfied with the visual updates to bolding and visibility? (y/n)");
});

test("builds a staged follow-up prompt from original task and answer", () => {
  const prompt = buildFollowUpPrompt({
    originalPrompt: "Implement rate limiting",
    assistantQuestion: "Should I use Redis?",
    userAnswer: "Use in-memory storage for now.",
  });

  assert.match(prompt, /Original task:/);
  assert.match(prompt, /Should I use Redis\?/);
  assert.match(prompt, /Use in-memory storage for now\./);
});

test("reduces ui state across thinking responding awaiting and shell states", () => {
  let state: UIState = { kind: "IDLE" };

  state = reduceUIState(state, { type: "PROMPT_RUN_STARTED", turnId: 9 });
  assert.deepEqual(state, { kind: "THINKING", turnId: 9 });

  state = reduceUIState(state, { type: "FIRST_ASSISTANT_DELTA", turnId: 9 });
  assert.deepEqual(state, { kind: "RESPONDING", turnId: 9 });

  state = reduceUIState(state, { type: "AWAITING_USER_ACTION", turnId: 9, question: "Use Redis?" });
  assert.deepEqual(state, { kind: "AWAITING_USER_ACTION", turnId: 9, question: "Use Redis?" });

  state = reduceUIState(state, { type: "DISMISS_TRANSIENT" });
  assert.deepEqual(state, { kind: "IDLE" });

  state = reduceUIState(state, { type: "SHELL_STARTED", shellId: 4 });
  assert.deepEqual(state, { kind: "SHELL_RUNNING", shellId: 4 });

  state = reduceUIState(state, { type: "SHELL_FINISHED", shellId: 4 });
  assert.deepEqual(state, { kind: "IDLE" });
});
