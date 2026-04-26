import assert from "node:assert/strict";
import test from "node:test";
import type { BackendProgressUpdate } from "../core/providers/types.js";
import { MAX_CHAT_LINES, MAX_VISIBLE_EVENTS } from "../config/settings.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";
import {
  appendRunActivity,
  appendRunResponseChunk,
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
  upsertRunToolActivity,
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

function makeProgressUpdate(id: string, text: string): BackendProgressUpdate {
  return {
    id,
    source: "reasoning",
    text,
  };
}

function makeProgressUpdateWithSource(
  id: string,
  source: BackendProgressUpdate["source"],
  text: string,
): BackendProgressUpdate {
  return { id, source, text };
}

test("creates a running run event", () => {
  const run = createRunEvent({
    id: 1,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Hello",
    turnId: 1,
  });

  assert.equal(run.status, "running");
  assert.equal(run.progressEntries.length, 0);
  assert.equal(run.truncatedOutput, false);
  assert.equal(run.activity.length, 0);
  assert.equal(run.touchedFileCount, 0);
  assert.deepEqual(run.streamItems, []);
  assert.deepEqual(run.responseSegments, []);
  assert.equal(run.lastStreamSeq, 0);
  assert.equal(run.activeResponseSegmentId, null);
});

test("assigns stream sequence in append order across thinking action and response", () => {
  let run = createRunEvent({
    id: 30,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Hello",
    turnId: 30,
  });

  run = appendRunThinking(run, [makeProgressUpdate("reason-1", "I need to inspect the project files.")]);
  run = upsertRunToolActivity(run, {
    id: "tool-1",
    command: "rg --files",
    status: "completed",
    startedAt: 10,
    completedAt: 20,
  });
  run = appendRunResponseChunk(run, "Purpose\n5-Date Verification");

  assert.deepEqual(run.streamItems?.map((item) => item.kind), ["thinking", "action", "response"]);
  assert.deepEqual(run.streamItems?.map((item) => item.streamSeq), [1, 2, 3]);
});

test("splits response segments when an action interrupts assistant streaming", () => {
  let run = createRunEvent({
    id: 31,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Hello",
    turnId: 31,
  });

  run = appendRunResponseChunk(run, "First ");
  run = appendRunResponseChunk(run, "segment.");
  run = upsertRunToolActivity(run, {
    id: "tool-1",
    command: "Get-Content README.md",
    status: "completed",
    startedAt: 10,
    completedAt: 20,
  });
  run = appendRunResponseChunk(run, "Second segment.");

  assert.equal(run.responseSegments?.length, 2);
  assert.equal(run.responseSegments?.[0]?.chunks.join(""), "First segment.");
  assert.equal(run.responseSegments?.[1]?.chunks.join(""), "Second segment.");
  assert.deepEqual(run.streamItems?.map((item) => item.kind), ["response", "action", "response"]);
  assert.deepEqual(run.streamItems?.map((item) => item.streamSeq), [1, 2, 3]);
});

test("does not duplicate stream items when tool and thinking entries are patched", () => {
  let run = createRunEvent({
    id: 32,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Hello",
    turnId: 32,
  });

  run = appendRunThinking(run, [makeProgressUpdate("reason-1", "Inspecting files")]);
  run = appendRunThinking(run, [makeProgressUpdate("reason-1", "Inspecting files carefully")]);
  run = upsertRunToolActivity(run, {
    id: "tool-1",
    command: "git status",
    status: "running",
    startedAt: 10,
  });
  run = upsertRunToolActivity(run, {
    id: "tool-1",
    command: "git status",
    status: "completed",
    startedAt: 10,
    completedAt: 20,
  });

  assert.deepEqual(run.streamItems?.map((item) => item.kind), ["thinking", "action"]);
  assert.equal(run.streamItems?.length, 2);
});

test("raw tool and terminal progress sources do not become thinking stream items", () => {
  const rawSources: BackendProgressUpdate["source"][] = ["tool", "stdout", "stderr", "activity"];
  for (const source of rawSources) {
    const run = appendRunThinking(
      createRunEvent({
        id: 40,
        backendId: "codex-subprocess",
        backendLabel: "Codex CLI",
        runtime: TEST_RUNTIME,
        prompt: "Hello",
        turnId: 40,
      }),
      [makeProgressUpdateWithSource("raw-1", source, "Directory: C:\\Users\\jorda\\Project\n\nimport { useMemo } from \"react\";")],
    );

    assert.equal(run.streamItems?.length, 0, `${source} should not render as thinking`);
    assert.equal(run.progressEntries[0]?.blocks.length, 2);
  }
});

test("transcript progress becomes a visible thinking stream item", () => {
  const run = appendRunThinking(
    createRunEvent({
      id: 41,
      backendId: "codex-subprocess",
      backendLabel: "Codex CLI",
      runtime: TEST_RUNTIME,
      prompt: "Hello",
      turnId: 41,
    }),
    [makeProgressUpdateWithSource("transcript-1", "transcript", "Codex is checking project structure...")],
  );

  assert.deepEqual(run.streamItems?.map((item) => item.kind), ["thinking"]);
  assert.equal(run.progressEntries[0]?.blocks[0]?.streamSeq, 1);
  assert.equal(run.progressEntries[0]?.blocks[0]?.text, "Codex is checking project structure...");
});

test("preserves progress action progress action response stream ordering", () => {
  let run = createRunEvent({
    id: 42,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Hello",
    turnId: 42,
  });

  run = appendRunThinking(run, [makeProgressUpdateWithSource("transcript-1", "transcript", "Codex is checking project structure...")]);
  run = upsertRunToolActivity(run, {
    id: "tool-1",
    command: "Get-ChildItem -Force",
    status: "completed",
    startedAt: 10,
    completedAt: 20,
  });
  run = appendRunThinking(run, [makeProgressUpdate("reason-1", "Codex is validating the result...")]);
  run = upsertRunToolActivity(run, {
    id: "tool-2",
    command: "bun test",
    status: "running",
    startedAt: 30,
  });
  run = appendRunResponseChunk(run, "Done.");

  assert.deepEqual(run.streamItems?.map((item) => item.kind), ["thinking", "action", "thinking", "action", "response"]);
  assert.deepEqual(run.streamItems?.map((item) => item.streamSeq), [1, 2, 3, 4, 5]);
});

test("caps streamed run output and marks truncation", () => {
  const run = createRunEvent({
    id: 2,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Hello",
    turnId: 2,
  });

  const updates = Array.from(
    { length: MAX_CHAT_LINES + 4 },
    (_, index) => makeProgressUpdate(`progress-${index + 1}`, `line ${index + 1}`),
  );
  const capped = appendRunThinking(run, updates);

  assert.equal(capped.progressEntries.length, MAX_CHAT_LINES);
  assert.equal(capped.progressEntries[0]?.text, "line 5");
  assert.equal(capped.progressEntries[0]?.blocks[0]?.text, "line 5");
  assert.equal(capped.progressEntries[capped.progressEntries.length - 1]?.text, `line ${MAX_CHAT_LINES + 4}`);
  assert.equal(capped.truncatedOutput, true);
});

test("streams repeated same-id updates into structured blocks", () => {
  const run = createRunEvent({
    id: 22,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Hello",
    turnId: 22,
  });

  const first = appendRunThinking(run, [makeProgressUpdate("reason-1", "Checking files")]);
  const second = appendRunThinking(first, [makeProgressUpdate("reason-1", "Checking files\n")]);
  const updated = appendRunThinking(second, [makeProgressUpdate("reason-1", "Checking files\n\nComparing results")]);

  assert.equal(updated.progressEntries.length, 1);
  assert.equal(updated.progressEntries[0]?.sequence, 1);
  assert.equal(updated.progressEntries[0]?.text, "Checking files\n\nComparing results");
  assert.equal(updated.progressEntries[0]?.blocks.length, 2);
  assert.equal(updated.progressEntries[0]?.blocks[0]?.text, "Checking files");
  assert.equal(updated.progressEntries[0]?.blocks[0]?.status, "completed");
  assert.equal(updated.progressEntries[0]?.blocks[1]?.text, "Comparing results");
  assert.equal(updated.progressEntries[0]?.blocks[1]?.status, "active");
  assert.equal(updated.progressEntries[0]?.pendingNewlineCount, 0);
});

test("treats multiple blank lines as one new progress block", () => {
  const run = createRunEvent({
    id: 23,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Hello",
    turnId: 23,
  });

  const updated = appendRunThinking(run, [makeProgressUpdate("reason-2", "Inspecting config\n\n\nComparing defaults")]);

  assert.equal(updated.progressEntries[0]?.blocks.length, 2);
  assert.equal(updated.progressEntries[0]?.blocks[0]?.text, "Inspecting config");
  assert.equal(updated.progressEntries[0]?.blocks[1]?.text, "Comparing defaults");
});

test("splits long reasoning paragraphs on transition phrases", () => {
  const run = createRunEvent({
    id: 25,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Hello",
    turnId: 25,
  });

  const text = [
    "I checked the rendering path and confirmed the stream is being accumulated into one visible block.",
    "Next I am going to update the chunking rules so completed thoughts stay stable while the active thought grows.",
    "I found the renderer can keep the same outer card and still separate the content into readable rows.",
  ].join(" ");
  const updated = appendRunThinking(run, [makeProgressUpdate("reason-4", text)]);

  assert.equal(updated.progressEntries[0]?.blocks.length, 3);
  assert.equal(updated.progressEntries[0]?.blocks[0]?.status, "completed");
  assert.match(updated.progressEntries[0]?.blocks[1]?.text ?? "", /^Next /);
  assert.match(updated.progressEntries[0]?.blocks[2]?.text ?? "", /^I found /);
  assert.equal(updated.progressEntries[0]?.blocks[2]?.status, "active");
});

test("starts a readable block before a new list while keeping list items grouped", () => {
  const run = createRunEvent({
    id: 26,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Hello",
    turnId: 26,
  });

  const text = [
    "I inspected the processing card and found the content needs a stronger internal hierarchy.",
    "- Preserve the outer card",
    "- Mark the live segment",
    "- Keep wrapping clean",
  ].join("\n");
  const updated = appendRunThinking(run, [makeProgressUpdate("reason-5", text)]);

  assert.equal(updated.progressEntries[0]?.blocks.length, 2);
  assert.equal(updated.progressEntries[0]?.blocks[0]?.text, "I inspected the processing card and found the content needs a stronger internal hierarchy.");
  assert.equal(
    updated.progressEntries[0]?.blocks[1]?.text,
    "- Preserve the outer card\n- Mark the live segment\n- Keep wrapping clean",
  );
});

test("rebuilds one progress entry safely when the next update is not a prefix", () => {
  const run = createRunEvent({
    id: 24,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Hello",
    turnId: 24,
  });

  const initial = appendRunThinking(run, [makeProgressUpdate("reason-3", "Checking files\n\nComparing results")]);
  const rebuilt = appendRunThinking(initial, [makeProgressUpdate("reason-3", "Comparing results only")]);

  assert.equal(rebuilt.progressEntries[0]?.blocks.length, 1);
  assert.equal(rebuilt.progressEntries[0]?.blocks[0]?.text, "Comparing results only");
  assert.equal(rebuilt.progressEntries[0]?.blocks[0]?.status, "active");
});

test("completes and cancels runs with stable terminal statuses", () => {
  const running = appendRunActivity(appendRunThinking(
    createRunEvent({
      id: 3,
      backendId: "codex-subprocess",
      backendLabel: "Codex CLI",
      runtime: TEST_RUNTIME,
      prompt: "Hello",
      turnId: 3,
    }),
    [makeProgressUpdate("progress-1", "first line")],
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
      runtime: TEST_RUNTIME,
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

test("snapshots resolved runtime config onto a run event", () => {
  const run = createRunEvent({
    id: 5,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    runtime: TEST_RUNTIME,
    prompt: "Inspect the repo",
    turnId: 5,
  });

  assert.equal(run.runtime.model, TEST_RUNTIME.model);
  assert.equal(run.runtime.mode, TEST_RUNTIME.mode);
  assert.equal(run.runtime.policy.approvalPolicy, TEST_RUNTIME.policy.approvalPolicy);
});

test("ignores stale run callbacks after cancellation", () => {
  assert.equal(isCurrentRun(null, 7), false);
  assert.equal(isCurrentRun(7, 7), true);
  assert.equal(isCurrentRun(8, 7), false);
});

test("detects only explicit agent questions", () => {
  assert.equal(detectAgentQuestion("Done.\n[QUESTION]: Which file should I update?"), "Which file should I update?");
  assert.equal(detectAgentQuestion("Need one detail first.\nShould I use Redis?"), null);
});

test("does not treat ordinary trailing questions as blocking", () => {
  const parsed = extractAssistantActionRequired("Done with the inspection.\nShould I add tests?");
  assert.equal(parsed.question, null);
  assert.equal(parsed.content, "Done with the inspection.\nShould I add tests?");
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
  assert.match(prompt, /best-effort continuation/i);
  assert.match(prompt, /truly blocked on one critical missing fact/i);
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
