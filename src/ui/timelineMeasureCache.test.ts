import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, RunProgressEntry, RunToolActivity, UserPromptEvent } from "../session/types.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";
import type { RenderTimelineItem } from "./Timeline.js";
import {
  __clearTimelineMeasureCachesForTests,
  __getStreamingBlockRowCacheSizeForTests,
  __wrapStyledSpansForTests,
  buildActionEventRows,
  buildStableTimelineSnapshot,
  buildTimelineSnapshot,
  type StreamEvent,
  type TimelineRowSpan,
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
    verbose: false,
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

test("buildActionEventRows preserves compact action row shape when summary changes", () => {
  __clearTimelineMeasureCachesForTests();
  const first = buildRows(makeTool({ summary: "Read 12 lines" }));
  const second = buildRows(makeTool({ summary: "Read 14 lines" }));

  assert.equal(second.length, first.length);
  assert.deepEqual(second.map((row) => row.key), first.map((row) => row.key));
  assert.match(first.map((row) => row.spans.map((span) => span.text).join("")).join("\n"), /^✓ Read file/);
});

test("completed action rows ignore live-target changes that do not render", () => {
  __clearTimelineMeasureCachesForTests();
  const tool = makeTool({ status: "completed" });

  const first = buildRows(tool, { isLive: true });
  const second = buildRows(tool, { isLive: false });

  assert.strictEqual(second, first);
});

test("running action rows keep their shape when live cursor display changes", () => {
  __clearTimelineMeasureCachesForTests();
  const tool = makeTool({ status: "running", completedAt: null });

  const first = buildRows(tool, { isLive: true });
  const second = buildRows(tool, { isLive: false });

  assert.equal(second.length, first.length);
  assert.match(first.map((row) => row.spans.map((span) => span.text).join("")).join("\n"), /▌/);
  assert.doesNotMatch(second.map((row) => row.spans.map((span) => span.text).join("")).join("\n"), /▌/);
  assert.deepEqual(second.map((row) => row.key), first.map((row) => row.key));
});

test("running to completed action update keeps row count and keys stable", () => {
  __clearTimelineMeasureCachesForTests();

  const running = buildRows(makeTool({
    status: "running",
    completedAt: null,
    summary: null,
  }), { isLive: true });
  const completed = buildRows(makeTool({
    status: "completed",
    completedAt: 42,
    summary: "Read 12 lines",
  }), { isLive: false });

  assert.equal(completed.length, running.length);
  assert.deepEqual(completed.map((row) => row.key), running.map((row) => row.key));
});

test("action summary updates do not resize compact action rows", () => {
  __clearTimelineMeasureCachesForTests();

  const first = buildRows(makeTool({ summary: null }));
  const second = buildRows(makeTool({ summary: "Read 14 lines and summarized the file contents" }));

  assert.equal(second.length, first.length);
  assert.deepEqual(second.map((row) => row.key), first.map((row) => row.key));
});

test("compact action rows show duration only after completion", () => {
  __clearTimelineMeasureCachesForTests();

  const running = buildRows(makeTool({ status: "running", completedAt: null }), { isLive: true });
  const completed = buildRows(makeTool({ status: "completed", completedAt: 42 }), { isLive: false });
  const runningText = running.map((row) => row.spans.map((span) => span.text).join("")).join("\n");
  const completedText = completed.map((row) => row.spans.map((span) => span.text).join("")).join("\n");

  assert.equal(running.length, completed.length);
  assert.match(runningText, /Read file/);
  assert.doesNotMatch(runningText, /ms|s/);
  assert.match(completedText, /Read file .*32ms/);
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
    buildRows(makeTool({
      id: `tool-${index}`,
      status: "running",
      completedAt: null,
      summary: `Read ${index} lines`,
    }));
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

function makeStreamingResponseRenderItem(text: string): RenderTimelineItem {
  const user: UserPromptEvent = {
    id: 10,
    type: "user",
    createdAt: 1,
    prompt: "Compare algorithms",
    turnId: 2,
  };
  const run: RunEvent = {
    id: 11,
    type: "run",
    createdAt: 1,
    startedAt: 1,
    durationMs: null,
    backendId: "codex-subprocess",
    backendLabel: "Codexa",
    runtime: TEST_RUNTIME,
    prompt: "Compare algorithms",
    progressEntries: [],
    status: "running",
    summary: "streaming...",
    truncatedOutput: false,
    toolActivities: [],
    activity: [],
    touchedFileCount: 0,
    errorMessage: null,
    turnId: 2,
    streamItems: [{ streamSeq: 1, kind: "response", refId: "response-1" }],
    responseSegments: [{
      id: "response-1",
      streamSeq: 1,
      chunks: [text],
      status: "active",
      startedAt: 1,
    }],
    lastStreamSeq: 1,
    activeResponseSegmentId: "response-1",
  };

  return {
    key: "turn-2",
    type: "turn",
    padded: true,
    item: {
      type: "turn",
      turnId: 2,
      turnIndex: 1,
      user,
      run,
      assistant: null,
    },
    renderState: {
      opacity: "active",
      question: null,
      runPhase: "streaming",
    },
  };
}

function makeActionSequenceRenderItem(
  tools: RunToolActivity[],
  options: { finalized?: boolean } = {},
): RenderTimelineItem {
  // Action-burst compaction is a height-reducing transform and only runs for a
  // FINISHED turn (run.status !== "running"). Default to a live/streaming run;
  // callers exercising compaction must opt in via { finalized: true }.
  const finalized = options.finalized ?? false;
  const user: UserPromptEvent = {
    id: 20,
    type: "user",
    createdAt: 1,
    prompt: "Inspect files",
    turnId: 3,
  };
  const run: RunEvent = {
    id: 21,
    type: "run",
    createdAt: 1,
    startedAt: 1,
    durationMs: finalized ? 100 : null,
    backendId: "codex-subprocess",
    backendLabel: "Codexa",
    runtime: TEST_RUNTIME,
    prompt: "Inspect files",
    progressEntries: [],
    status: finalized ? "completed" : "running",
    summary: finalized ? "completed" : "running...",
    truncatedOutput: false,
    toolActivities: tools,
    activity: [],
    touchedFileCount: 0,
    errorMessage: null,
    turnId: 3,
    streamItems: tools.map((tool) => ({
      streamSeq: tool.streamSeq ?? 0,
      kind: "action" as const,
      refId: tool.id,
    })),
    responseSegments: [],
    lastStreamSeq: tools.reduce((max, tool) => Math.max(max, tool.streamSeq ?? 0), 0),
    activeResponseSegmentId: null,
  };

  return {
    key: "turn-3",
    type: "turn",
    padded: true,
    item: {
      type: "turn",
      turnId: 3,
      turnIndex: 2,
      user,
      run,
      assistant: null,
    },
    renderState: {
      opacity: "active",
      question: null,
      runPhase: finalized ? "none" : "streaming",
    },
  };
}

function makeCompletedPlanRenderItem(planText: string): RenderTimelineItem {
  const user: UserPromptEvent = {
    id: 30,
    type: "user",
    createdAt: 1,
    prompt: "Plan a better architectural update to the file tree",
    turnId: 4,
  };
  const run: RunEvent = {
    id: 31,
    type: "run",
    createdAt: 1,
    startedAt: 1,
    durationMs: 100,
    backendId: "codex-subprocess",
    backendLabel: "Codexa",
    runtime: TEST_RUNTIME,
    prompt: user.prompt,
    progressEntries: [],
    status: "completed",
    summary: "completed",
    truncatedOutput: false,
    toolActivities: [],
    activity: [],
    touchedFileCount: 0,
    errorMessage: null,
    turnId: 4,
    streamItems: [{ streamSeq: 1, kind: "plan", refId: "plan-31" }],
    responseSegments: [],
    lastStreamSeq: 1,
    activeResponseSegmentId: null,
    plan: {
      id: "plan-31",
      streamSeq: 1,
      chunks: planText ? [planText] : [],
      status: "completed",
      startedAt: 1,
    },
  };

  return {
    key: "turn-plan-4",
    type: "turn",
    padded: true,
    item: {
      type: "turn",
      turnId: 4,
      turnIndex: 3,
      user,
      run,
      assistant: null,
    },
    renderState: {
      opacity: "active",
      question: null,
      runPhase: "none",
    },
  };
}

function snapshotText(rows: Array<{ spans: Array<{ text: string }> }>): string {
  return rows.map((row) => row.spans.map((span) => span.text).join("")).join("\n");
}

function stableRowsForTools(tools: RunToolActivity[], options: { finalized?: boolean } = {}) {
  return buildStableTimelineSnapshot(
    [makeActionSequenceRenderItem(tools, options)],
    { totalWidth: 72, debugLabel: "action-sequence" },
  ).snapshot.rows;
}

function actionRows(rows: Array<{ key: string }>, streamSeq: number): string[] {
  return rows
    .map((row) => row.key)
    .filter((key) => key.includes(`-action-${streamSeq}-`));
}

function actionTopIndex(rows: Array<{ key: string }>, streamSeq: number): number {
  return rows.findIndex((row) => row.key.includes(`-action-${streamSeq}-plain`));
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

test("active thinking rows are omitted while action rows remain visible", () => {
  __clearTimelineMeasureCachesForTests();

  const snapshot = buildTimelineSnapshot(
    [makeRenderItem("Inspecting proof files.")],
    { totalWidth: 72, debugLabel: "active-thinking-omitted" },
  );
  const joined = snapshot.rows.map((row) => row.spans.map((span) => span.text).join("")).join("\n");

  assert.doesNotMatch(joined, /Inspecting proof files/i);
  assert.match(joined, /Read file/i);
});

test("stable active action sequence appends without moving existing action keys", () => {
  __clearTimelineMeasureCachesForTests();

  const firstRunningRows = stableRowsForTools([
    makeTool({ id: "tool-1", status: "running", completedAt: null, summary: null, streamSeq: 1 }),
  ]);
  const firstCompletedRows = stableRowsForTools([
    makeTool({ id: "tool-1", status: "completed", completedAt: 42, summary: "Read 12 lines", streamSeq: 1 }),
  ]);
  const secondRunningRows = stableRowsForTools([
    makeTool({ id: "tool-1", status: "completed", completedAt: 42, summary: "Read 12 lines", streamSeq: 1 }),
    makeTool({ id: "tool-2", command: "Get-Content package.json", status: "running", completedAt: null, summary: null, streamSeq: 2 }),
  ]);
  const bothCompletedRows = stableRowsForTools([
    makeTool({ id: "tool-1", status: "completed", completedAt: 42, summary: "Read 12 lines", streamSeq: 1 }),
    makeTool({ id: "tool-2", command: "Get-Content package.json", status: "completed", completedAt: 56, summary: "Read package", streamSeq: 2 }),
  ]);

  const firstActionKeys = actionRows(firstRunningRows, 1);
  assert.ok(firstActionKeys.length > 0);
  assert.deepEqual(actionRows(firstCompletedRows, 1), firstActionKeys);
  assert.deepEqual(actionRows(secondRunningRows, 1), firstActionKeys);
  assert.deepEqual(actionRows(bothCompletedRows, 1), firstActionKeys);
  assert.ok(actionTopIndex(secondRunningRows, 1) < actionTopIndex(secondRunningRows, 2));
  assert.ok(actionTopIndex(bothCompletedRows, 1) < actionTopIndex(bothCompletedRows, 2));
});

test("stable active action rows keep stream order when a later action completes first", () => {
  __clearTimelineMeasureCachesForTests();

  const rows = stableRowsForTools([
    makeTool({ id: "tool-1", status: "running", completedAt: null, summary: null, streamSeq: 1 }),
    makeTool({ id: "tool-2", command: "Get-Content package.json", status: "completed", completedAt: 56, summary: "Read package", streamSeq: 2 }),
  ]);

  assert.ok(actionTopIndex(rows, 1) >= 0);
  assert.ok(actionTopIndex(rows, 2) >= 0);
  assert.ok(actionTopIndex(rows, 1) < actionTopIndex(rows, 2));
});

test("default stable timeline summarizes long repeated read action bursts once finalized", () => {
  __clearTimelineMeasureCachesForTests();

  const tools = Array.from({ length: 7 }, (_, index) => makeTool({
    id: `tool-${index + 1}`,
    command: `Get-Content file-${index + 1}.txt`,
    status: "completed",
    completedAt: 50 + index,
    summary: `Read file ${index + 1}`,
    streamSeq: index + 1,
  }));

  // Compaction is height-reducing, so it only applies after the run finalizes.
  const rows = stableRowsForTools(tools, { finalized: true });
  const text = snapshotText(rows);

  assert.match(text, /3 repeated read activity summarized/);
  assert.ok(actionTopIndex(rows, 1) >= 0);
  assert.ok(actionTopIndex(rows, 2) >= 0);
  assert.ok(actionTopIndex(rows, 6) >= 0);
  assert.ok(actionTopIndex(rows, 7) >= 0);
  assert.equal(actionTopIndex(rows, 3), -1);
  assert.equal(actionTopIndex(rows, 5), -1);
});

test("verbose stable timeline keeps every repeated read action visible", () => {
  __clearTimelineMeasureCachesForTests();

  const tools = Array.from({ length: 7 }, (_, index) => makeTool({
    id: `tool-${index + 1}`,
    command: `Get-Content file-${index + 1}.txt`,
    status: "completed",
    completedAt: 50 + index,
    summary: `Read file ${index + 1}`,
    streamSeq: index + 1,
  }));
  const rows = buildStableTimelineSnapshot(
    [makeActionSequenceRenderItem(tools)],
    { totalWidth: 72, debugLabel: "verbose-action-sequence", verboseMode: true },
  ).snapshot.rows;

  assert.doesNotMatch(snapshotText(rows), /repeated read activity summarized/);
  for (let index = 1; index <= 7; index += 1) {
    assert.ok(actionTopIndex(rows, index) >= 0, `tool ${index} should stay visible`);
  }
});

test("stable timeline freezes completed action rows while active text changes", () => {
  __clearTimelineMeasureCachesForTests();

  const first = buildStableTimelineSnapshot(
    [makeRenderItem("Inspecting proof files.")],
    { totalWidth: 72, debugLabel: "stable-before" },
  );
  const second = buildStableTimelineSnapshot(
    [makeRenderItem("Inspecting proof files and reading surrounding documentation before summarizing the verification workflow.")],
    { totalWidth: 72, debugLabel: "stable-after" },
  );

  const firstActionRows = first.frozenRows.filter((row) => row.key.includes("-action-2-"));
  const secondActionRows = second.frozenRows.filter((row) => row.key.includes("-action-2-"));

  assert.ok(firstActionRows.length > 0);
  assert.equal(secondActionRows.length, firstActionRows.length);
  for (let index = 0; index < firstActionRows.length; index += 1) {
    assert.strictEqual(secondActionRows[index], firstActionRows[index]);
  }
});

test("buildTimelineSnapshot re-renders when a completed plan changes from empty to final text", () => {
  __clearTimelineMeasureCachesForTests();

  const empty = buildTimelineSnapshot(
    [makeCompletedPlanRenderItem("")],
    { totalWidth: 90, debugLabel: "plan-empty" },
  );
  const final = buildTimelineSnapshot(
    [makeCompletedPlanRenderItem("## Final architecture plan\n1. Update the file tree renderer.")],
    { totalWidth: 90, debugLabel: "plan-final" },
  );

  assert.doesNotMatch(snapshotText(empty.rows), /Final architecture plan/);
  assert.match(snapshotText(final.rows), /Final architecture plan/);
  assert.match(snapshotText(final.rows), /Update the file tree renderer/);
});

test("buildStableTimelineSnapshot re-renders final plan text under the same turn key", () => {
  __clearTimelineMeasureCachesForTests();

  const empty = buildStableTimelineSnapshot(
    [makeCompletedPlanRenderItem("")],
    { totalWidth: 90, debugLabel: "stable-plan-empty" },
  );
  const final = buildStableTimelineSnapshot(
    [makeCompletedPlanRenderItem("## Final architecture plan\n1. Update the file tree renderer.")],
    { totalWidth: 90, debugLabel: "stable-plan-final" },
  );

  assert.doesNotMatch(snapshotText(empty.snapshot.rows), /Final architecture plan/);
  assert.match(snapshotText(final.snapshot.rows), /Final architecture plan/);
  assert.match(snapshotText(final.snapshot.rows), /Update the file tree renderer/);
});

test("unchanged active response rows keep references while streaming text grows", () => {
  __clearTimelineMeasureCachesForTests();

  const first = buildTimelineSnapshot(
    [makeStreamingResponseRenderItem("Line one.\nLine two.")],
    { totalWidth: 72, debugLabel: "response-before" },
  );
  const second = buildTimelineSnapshot(
    [makeStreamingResponseRenderItem("Line one.\nLine two.\nLine three is arriving.")],
    { totalWidth: 72, debugLabel: "response-after" },
  );

  const firstStableLine = first.rows.find((row) =>
    row.key.includes("-codex-response-1-content-0")
    && row.spans.some((span) => span.text.includes("Line one.")),
  );
  const secondStableLine = second.rows.find((row) => row.key === firstStableLine?.key);

  assert.ok(firstStableLine);
  assert.strictEqual(secondStableLine, firstStableLine);
});

test("gap row keys use event.streamSeq — stable across compaction changes", () => {
  __clearTimelineMeasureCachesForTests();

  // Use non-sequential streamSeq values to distinguish from eventIndex (0,1,2).
  const tools = [
    makeTool({ id: "tool-1", command: "Get-Content a.txt", status: "completed", completedAt: 10, summary: "Read a", streamSeq: 3 }),
    makeTool({ id: "tool-2", command: "Get-Content b.txt", status: "completed", completedAt: 11, summary: "Read b", streamSeq: 7 }),
    makeTool({ id: "tool-3", command: "Get-Content c.txt", status: "completed", completedAt: 12, summary: "Read c", streamSeq: 12 }),
  ];

  const run: RunEvent = {
    id: 54, type: "run", createdAt: 1, startedAt: 1, durationMs: 200,
    backendId: "codex-subprocess", backendLabel: "Codexa", runtime: TEST_RUNTIME,
    prompt: "Read files",
    progressEntries: [],
    status: "completed", summary: "done", truncatedOutput: false,
    toolActivities: tools,
    activity: [], touchedFileCount: 0, errorMessage: null, turnId: 7,
    streamItems: tools.map((t) => ({ kind: "action" as const, streamSeq: t.streamSeq!, refId: t.id })),
    responseSegments: [], lastStreamSeq: 12, activeResponseSegmentId: null,
  };

  const user: UserPromptEvent = { id: 55, type: "user", createdAt: 1, prompt: "Read files", turnId: 7 };
  const item: RenderTimelineItem = {
    key: "turn-7",
    type: "turn",
    padded: true,
    item: { type: "turn", turnId: 7, turnIndex: 0, user, run, assistant: null },
    renderState: { opacity: "active", question: null, runPhase: "none" },
  };

  const parts = buildStableTimelineSnapshot([item], { totalWidth: 80, debugLabel: "gap-key-test" });
  const allRowKeys = parts.frozenRows.map((r) => r.key);
  const gapKeys = allRowKeys.filter((k) => k.includes("-stream-gap-"));

  // There should be gaps before tool-2 (streamSeq=7) and tool-3 (streamSeq=12).
  // With the fix the gap key encodes the event's streamSeq, not the eventIndex.
  assert.ok(gapKeys.some((k) => k.includes("-stream-gap-7")),  "gap before tool-2 should use streamSeq=7");
  assert.ok(gapKeys.some((k) => k.includes("-stream-gap-12")), "gap before tool-3 should use streamSeq=12");
  // Old index-based keys (1, 2) must not be present.
  assert.equal(gapKeys.some((k) => k.endsWith("-stream-gap-1")), false, "old eventIndex-based gap key must not exist");
  assert.equal(gapKeys.some((k) => k.endsWith("-stream-gap-2")), false, "old eventIndex-based gap key must not exist");
});

test("timeline measurement coverage for THINKING -> RESPONDING -> FINALIZE_RUN", () => {
  __clearTimelineMeasureCachesForTests();

  const tool = makeTool({ id: "tool-1", status: "running", completedAt: null, summary: null, streamSeq: 1 });
  const runEvent: RunEvent = {
    id: 2,
    type: "run",
    createdAt: 2,
    startedAt: 2,
    durationMs: null,
    backendId: "codex-subprocess",
    backendLabel: "Test",
    runtime: TEST_RUNTIME,
    prompt: "Test",
    progressEntries: [],
    status: "running",
    summary: "Running",
    truncatedOutput: false,
    toolActivities: [tool],
    activity: [],
    touchedFileCount: 0,
    errorMessage: null,
    turnId: 1,
    streamItems: [{ kind: "action", streamSeq: 1, refId: "tool-1" }],
    responseSegments: [],
    lastStreamSeq: 1,
    activeResponseSegmentId: null,
  };

  const item1: RenderTimelineItem = {
    key: "turn-1",
    type: "turn",
    padded: true,
    item: { type: "turn", turnId: 1, turnIndex: 1, user: null, run: runEvent, assistant: null },
    renderState: { opacity: "active", question: null, runPhase: "thinking" },
  };

  const snapshot1 = buildTimelineSnapshot([item1], { totalWidth: 120 });
  const actionKeys1 = snapshot1.rows.filter(r => r.key.includes("-action-")).map(r => r.key);
  assert.ok(actionKeys1.length > 0);

  // Complete action
  tool.status = "completed";
  const snapshot2 = buildTimelineSnapshot([item1], { totalWidth: 120 });
  const actionKeys2 = snapshot2.rows.filter(r => r.key.includes("-action-")).map(r => r.key);
  assert.deepEqual(actionKeys2, actionKeys1);

  // Add response
  runEvent.responseSegments = [{
    id: "resp-1",
    streamSeq: 2,
    chunks: ["Answer starts"],
    status: "active",
    startedAt: 3,
  }];
  runEvent.streamItems = [...(runEvent.streamItems ?? []), { kind: "response", streamSeq: 2, refId: "resp-1" }];
  item1.renderState.runPhase = "streaming";

  const snapshot3 = buildTimelineSnapshot([item1], { totalWidth: 120 });
  const actionKeys3 = snapshot3.rows.filter(r => r.key.includes("-action-")).map(r => r.key);
  assert.deepEqual(actionKeys3, actionKeys1);

  // Finalize
  runEvent.status = "completed";
  runEvent.durationMs = 100;
  runEvent.responseSegments[0].status = "completed";
  item1.renderState.runPhase = "none";

  const snapshot4 = buildTimelineSnapshot([item1], { totalWidth: 120 });
  const actionKeys4 = snapshot4.rows.filter(r => r.key.includes("-action-")).map(r => r.key);
  assert.deepEqual(actionKeys4, actionKeys1);
});

// ─── wrapStyledSpans word-boundary regression tests ───────────────────────────

function assertNoMidWordSplit(rowTexts: string[], words: string[]) {
  for (const word of words) {
    for (let r = 0; r < rowTexts.length - 1; r++) {
      const tail = rowTexts[r]!;
      const head = rowTexts[r + 1]!;
      for (let split = 1; split < word.length; split++) {
        const prefix = word.slice(0, split);
        const suffix = word.slice(split);
        assert.ok(
          !(tail.endsWith(prefix) && head.startsWith(suffix)),
          `"${word}" split as "${prefix}" | "${suffix}" between rows ${r} and ${r + 1}`,
        );
      }
    }
  }
}

test("wrapStyledSpans: no mid-word split within a single styled span", () => {
  const spans: TimelineRowSpan[] = [
    { text: "where the test mock for stdout is missing some WriteStream properties.", tone: "info" },
  ];
  const rows = __wrapStyledSpansForTests(spans, 40);
  const rowTexts = rows.map((row) => row.map((s) => s.text).join(""));
  assertNoMidWordSplit(rowTexts, ["for", "stdout", "WriteStream", "where", "test", "mock", "missing", "some", "properties"]);
});

test("wrapStyledSpans: no mid-word split across mixed styled spans", () => {
  const spans: TimelineRowSpan[] = [
    { text: "normal text before ", tone: undefined },
    { text: "src/ui/ActivityIndicator.test.tsx", tone: "info" },
    { text: " where the test mock for", tone: undefined },
    { text: " WriteStream", tone: "info" },
  ];
  const rows = __wrapStyledSpansForTests(spans, 40);
  const rowTexts = rows.map((row) => row.map((s) => s.text).join(""));
  assertNoMidWordSplit(rowTexts, ["for", "WriteStream", "where", "mock", "normal", "text", "before"]);
});

test("wrapStyledSpans: overlong token falls back to character split within line width", () => {
  const spans: TimelineRowSpan[] = [
    { text: "a_very_long_token_without_spaces_that_exceeds_width", tone: "muted" },
  ];
  const rows = __wrapStyledSpansForTests(spans, 20);
  assert.ok(rows.length > 1, "should produce multiple rows for an overlong token");
  for (const row of rows) {
    const rowWidth = row.reduce((sum, s) => sum + s.text.length, 0);
    assert.ok(rowWidth <= 20, `row width ${rowWidth} exceeds 20`);
  }
});

test("wrapStyledSpans: hard newlines in span text produce separate rows", () => {
  const spans: TimelineRowSpan[] = [
    { text: "first line\nsecond line", tone: "text" as never },
  ];
  const rows = __wrapStyledSpansForTests(spans, 80);
  assert.equal(rows.length, 2);
  assert.ok(rows[0]!.map((s) => s.text).join("").includes("first line"));
  assert.ok(rows[1]!.map((s) => s.text).join("").includes("second line"));
});
