import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, RunProgressEntry, RunToolActivity, UserPromptEvent } from "../session/types.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";
import type { RenderTimelineItem } from "./Timeline.js";
import {
  __clearTimelineMeasureCachesForTests,
  __getStreamingBlockRowCacheSizeForTests,
  buildActionEventRows,
  buildStableTimelineSnapshot,
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

test("buildActionEventRows preserves bordered action card shape when summary changes", () => {
  __clearTimelineMeasureCachesForTests();
  const first = buildRows(makeTool({ summary: "Read 12 lines" }));
  const second = buildRows(makeTool({ summary: "Read 14 lines" }));

  assert.equal(second.length, first.length);
  assert.deepEqual(second.map((row) => row.key), first.map((row) => row.key));
  assert.match(first.map((row) => row.spans.map((span) => span.text).join("")).join("\n"), /╭── action/);
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

test("action summary updates do not resize bordered action cards", () => {
  __clearTimelineMeasureCachesForTests();

  const first = buildRows(makeTool({ summary: null }));
  const second = buildRows(makeTool({ summary: "Read 14 lines and summarized the file contents" }));

  assert.equal(second.length, first.length);
  assert.deepEqual(second.map((row) => row.key), first.map((row) => row.key));
});

test("bordered action cards show duration only after completion", () => {
  __clearTimelineMeasureCachesForTests();

  const running = buildRows(makeTool({ status: "running", completedAt: null }), { isLive: true });
  const completed = buildRows(makeTool({ status: "completed", completedAt: 42 }), { isLive: false });
  const runningText = running.map((row) => row.spans.map((span) => span.text).join("")).join("\n");
  const completedText = completed.map((row) => row.spans.map((span) => span.text).join("")).join("\n");

  assert.equal(running.length, completed.length);
  assert.match(runningText, /╭── action/);
  assert.match(runningText, /Read file/);
  assert.doesNotMatch(runningText, /ms|s/);
  assert.match(completedText, /Read file\s+32ms/);
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

function makeActionSequenceRenderItem(tools: RunToolActivity[]): RenderTimelineItem {
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
    durationMs: null,
    backendId: "codex-subprocess",
    backendLabel: "Codexa",
    runtime: TEST_RUNTIME,
    prompt: "Inspect files",
    progressEntries: [],
    status: "running",
    summary: "running...",
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
      runPhase: "streaming",
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

function stableRowsForTools(tools: RunToolActivity[]) {
  return buildStableTimelineSnapshot(
    [makeActionSequenceRenderItem(tools)],
    { totalWidth: 72, debugLabel: "action-sequence" },
  ).snapshot.rows;
}

function actionRows(rows: Array<{ key: string }>, streamSeq: number): string[] {
  return rows
    .map((row) => row.key)
    .filter((key) => key.includes(`-action-${streamSeq}-`));
}

function actionTopIndex(rows: Array<{ key: string }>, streamSeq: number): number {
  return rows.findIndex((row) => row.key.includes(`-action-${streamSeq}-top`));
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
