import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, RunProgressEntry, RunToolActivity, UserPromptEvent } from "../session/types.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";
import type { RenderTimelineItem } from "./Timeline.js";
import {
  __clearTimelineMeasureCachesForTests,
  __getStreamingBlockRowCacheSizeForTests,
  buildActionEventRows,
  buildTimelineSnapshot,
  type StreamEvent,
} from "./timelineMeasure.js";

function makeTool(overrides: Partial<RunToolActivity> = {}): RunToolActivity {
  return {
    id: "tool-1",
    command: "Get-Content README.md",
    status: "completed",
    startedAt: 10,
    completedAt: 20,
    summary: "Read 12 lines",
    ...overrides,
  };
}

function makeActionEvent(tool: RunToolActivity): Extract<StreamEvent, { kind: "action" }> {
  return {
    kind: "action",
    streamSeq: 1,
    tool,
  };
}

function buildRows(tool: RunToolActivity, overrides: Partial<Parameters<typeof buildActionEventRows>[0]> = {}) {
  return buildActionEventRows({
    keyPrefix: "turn-1-action-1",
    width: 80,
    event: makeActionEvent(tool),
    borderTone: "borderActive",
    verbose: true,
    isLive: false,
    ...overrides,
  });
}

test("buildActionEventRows reuses row array for stable tool inputs", () => {
  __clearTimelineMeasureCachesForTests();
  const tool = makeTool();

  const first = buildRows(tool);
  const second = buildRows(tool);

  assert.strictEqual(second, first);
});

test("buildActionEventRows returns new rows when tool summary changes", () => {
  __clearTimelineMeasureCachesForTests();
  const first = buildRows(makeTool({ summary: "Read 12 lines" }));
  const second = buildRows(makeTool({ summary: "Read 14 lines" }));

  assert.notStrictEqual(second, first);
});

test("completed action rows ignore live-target changes that do not render", () => {
  __clearTimelineMeasureCachesForTests();
  const tool = makeTool({ status: "completed" });

  const first = buildRows(tool, { isLive: true });
  const second = buildRows(tool, { isLive: false });

  assert.strictEqual(second, first);
});

test("running action rows change when live cursor display changes", () => {
  __clearTimelineMeasureCachesForTests();
  const tool = makeTool({ status: "running", completedAt: null });

  const first = buildRows(tool, { isLive: true });
  const second = buildRows(tool, { isLive: false });

  assert.notStrictEqual(second, first);
});

test("completed action rows ignore invisible timestamp changes when duration is unchanged", () => {
  __clearTimelineMeasureCachesForTests();

  const first = buildRows(makeTool({ startedAt: 10, completedAt: 20 }));
  const second = buildRows(makeTool({ startedAt: 15, completedAt: 25 }));

  assert.strictEqual(second, first);
});

test("streaming row cache size is bounded", () => {
  __clearTimelineMeasureCachesForTests();

  for (let index = 0; index < 225; index += 1) {
    buildRows(makeTool({ id: `tool-${index}`, summary: `Read ${index} lines` }));
  }

  assert.equal(__getStreamingBlockRowCacheSizeForTests(), 200);
});

function makeProgressEntry(text: string): RunProgressEntry {
  return {
    id: "thinking-1",
    source: "reasoning",
    text,
    sequence: 1,
    createdAt: 1,
    updatedAt: 1,
    pendingNewlineCount: 0,
    blocks: [{
      id: "thinking-1-block-1",
      text,
      sequence: 1,
      createdAt: 1,
      updatedAt: 1,
      status: "active",
      streamSeq: 1,
    }],
  };
}

function makeRun(thinkingText: string): RunEvent {
  return {
    id: 2,
    type: "run",
    createdAt: 1,
    startedAt: 1,
    durationMs: null,
    backendId: "codex-subprocess",
    backendLabel: "Codexa",
    runtime: TEST_RUNTIME,
    prompt: "Explain",
    progressEntries: [makeProgressEntry(thinkingText)],
    status: "running",
    summary: "processing...",
    truncatedOutput: false,
    toolActivities: [makeTool({ streamSeq: 2 })],
    activity: [],
    touchedFileCount: 0,
    errorMessage: null,
    turnId: 1,
    streamItems: [
      { streamSeq: 1, kind: "thinking", refId: "thinking-1-block-1" },
      { streamSeq: 2, kind: "action", refId: "tool-1" },
    ],
    responseSegments: [],
    lastStreamSeq: 2,
    activeResponseSegmentId: null,
  };
}

function makeRenderItem(thinkingText: string): RenderTimelineItem {
  const user: UserPromptEvent = {
    id: 1,
    type: "user",
    createdAt: 1,
    prompt: "Explain",
    turnId: 1,
  };
  return {
    key: "turn-1",
    type: "turn",
    padded: true,
    item: {
      type: "turn",
      turnId: 1,
      turnIndex: 0,
      user,
      run: makeRun(thinkingText),
      assistant: null,
    },
    renderState: {
      opacity: "active",
      question: null,
      runPhase: "streaming",
    },
  };
}

test("completed action wrapped rows stay stable when earlier thinking grows", () => {
  __clearTimelineMeasureCachesForTests();

  const first = buildTimelineSnapshot(
    [makeRenderItem("Inspecting proof files.")],
    { totalWidth: 72, debugLabel: "test-before" },
  );
  const second = buildTimelineSnapshot(
    [makeRenderItem("Inspecting proof files and reading surrounding documentation before summarizing the verification workflow.")],
    { totalWidth: 72, debugLabel: "test-after" },
  );

  const firstActionRows = first.rows.filter((row) => row.key.includes("-action-2-"));
  const secondActionRows = second.rows.filter((row) => row.key.includes("-action-2-"));

  assert.ok(firstActionRows.length > 0);
  assert.equal(secondActionRows.length, firstActionRows.length);
  assert.deepEqual(secondActionRows.map((row) => row.key), firstActionRows.map((row) => row.key));
  for (let index = 0; index < firstActionRows.length; index += 1) {
    assert.strictEqual(secondActionRows[index], firstActionRows[index]);
  }
});
