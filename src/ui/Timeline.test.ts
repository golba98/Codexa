import assert from "node:assert/strict";
import test from "node:test";
import type { TimelineEvent } from "../session/types.js";
import type { TimelineRow, TimelineSnapshot } from "./timelineMeasure.js";
import { buildTimelineSnapshot } from "./timelineMeasure.js";
import {
  buildActiveRenderItems,
  buildStaticRenderItems,
  buildTimelineItems,
  createFollowTailViewport,
  endTimelineViewport,
  homeTimelineViewport,
  pageDownTimelineViewport,
  pageUpTimelineViewport,
  parseWheelScrollDirections,
  resolveTurnOpacity,
  selectTimelineRows,
  stepDownTimelineViewport,
  stepUpTimelineViewport,
  syncTimelineViewport,
  type RenderTimelineItem,
} from "./Timeline.js";

function createRow(key: string): TimelineRow {
  return {
    key,
    spans: [{ text: key }],
  };
}

function createSnapshot(rowCounts: number[]): TimelineSnapshot {
  const items = rowCounts.map((count, itemIndex) => {
    const rows = Array.from({ length: count }, (_, rowIndex) => createRow(`item-${itemIndex}-row-${rowIndex}`));
    return {
      key: `item-${itemIndex}`,
      rows,
      rowCount: rows.length,
    };
  });
  const rows = items.flatMap((item) => item.rows);
  return {
    items,
    rows,
    totalRows: rows.length,
    itemCount: items.length,
  };
}

test("groups user, run, and assistant events into a single turn item", () => {
  const events: TimelineEvent[] = [
    {
      id: 1,
      type: "user",
      createdAt: 1,
      prompt: "Implement rate limiting",
      turnId: 10,
    },
    {
      id: 2,
      type: "run",
      createdAt: 2,
      startedAt: 2,
      durationMs: null,
      backendId: "codex-subprocess",
      backendLabel: "Codexa",
      mode: "auto-edit",
      model: "gpt-5.4",
      prompt: "Implement rate limiting",
      thinkingLines: ["Scanning routes..."],
      status: "running",
      summary: "Running",
      truncatedOutput: false,
      toolActivities: [],
      activity: [],
      touchedFileCount: 0,
      errorMessage: null,
      turnId: 10,
    },
    {
      id: 3,
      type: "assistant",
      createdAt: 3,
      content: "I found the auth router.",
      turnId: 10,
    },
    {
      id: 4,
      type: "system",
      createdAt: 4,
      title: "Mode updated",
      content: "AUTO-EDIT enabled",
    },
  ];

  const items = buildTimelineItems(events);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.type, "turn");
  assert.equal(items[1]?.type, "event");

  if (items[0]?.type !== "turn") {
    throw new Error("Expected first item to be a turn");
  }

  assert.equal(items[0].turnId, 10);
  assert.equal(items[0].user?.prompt, "Implement rate limiting");
  assert.equal(items[0].run?.thinkingLines[0], "Scanning routes...");
  assert.equal(items[0].assistant?.content, "I found the auth router.");
});

test("derives active, recent, and dim turn opacity from ordered turn ids", () => {
  const turnIds = [1, 2, 3];

  assert.equal(resolveTurnOpacity(turnIds, 3, 3), "active");
  assert.equal(resolveTurnOpacity(turnIds, 2, 3), "recent");
  assert.equal(resolveTurnOpacity(turnIds, 1, 3), "dim");

  assert.equal(resolveTurnOpacity(turnIds, 3, null), "recent");
  assert.equal(resolveTurnOpacity(turnIds, 1, null), "dim");
});

test("separates committed and active turn render state", () => {
  const committed = buildTimelineItems([
    {
      id: 1,
      type: "user",
      createdAt: 1,
      prompt: "Completed turn",
      turnId: 1,
    },
    {
      id: 2,
      type: "run",
      createdAt: 2,
      startedAt: 2,
      durationMs: 250,
      backendId: "codex-subprocess",
      backendLabel: "Codexa",
      mode: "auto-edit",
      model: "gpt-5.4",
      prompt: "Completed turn",
      thinkingLines: [],
      status: "completed",
      summary: "Completed",
      truncatedOutput: false,
      toolActivities: [],
      activity: [],
      touchedFileCount: 0,
      errorMessage: null,
      turnId: 1,
    },
    {
      id: 3,
      type: "assistant",
      createdAt: 3,
      content: "Done",
      turnId: 1,
    },
  ]);

  const active = buildTimelineItems([
    {
      id: 4,
      type: "user",
      createdAt: 4,
      prompt: "Live turn",
      turnId: 2,
    },
    {
      id: 5,
      type: "run",
      createdAt: 5,
      startedAt: 5,
      durationMs: null,
      backendId: "codex-subprocess",
      backendLabel: "Codexa",
      mode: "auto-edit",
      model: "gpt-5.4",
      prompt: "Live turn",
      thinkingLines: [],
      status: "running",
      summary: "Running",
      truncatedOutput: false,
      toolActivities: [],
      activity: [],
      touchedFileCount: 0,
      errorMessage: null,
      turnId: 2,
    },
  ]);

  const turnIds = [1, 2];
  const staticItems = buildStaticRenderItems(committed, turnIds, 2, null, null);
  const activeThinkingItems = buildActiveRenderItems(active, turnIds, { kind: "THINKING", turnId: 2 });
  const activeStreamingItems = buildActiveRenderItems(active, turnIds, { kind: "RESPONDING", turnId: 2 });

  assert.equal(staticItems[0]?.type, "turn");
  assert.equal(staticItems[0]?.type === "turn" ? staticItems[0].renderState.runPhase : "none", "final");
  assert.equal(staticItems[0]?.type === "turn" ? staticItems[0].renderState.opacity : "dim", "recent");
  assert.equal(activeThinkingItems[0]?.type === "turn" ? activeThinkingItems[0].renderState.runPhase : "none", "thinking");
  assert.equal(activeStreamingItems[0]?.type === "turn" ? activeStreamingItems[0].renderState.runPhase : "none", "streaming");
});

test("builds multi-row snapshots from wrapped timeline items", () => {
  const item: RenderTimelineItem = {
    key: "event-1",
    type: "event",
    padded: false,
    event: {
      id: 1,
      type: "system",
      createdAt: 1,
      title: "Long system event",
      content: "This content is intentionally long enough to wrap across multiple transcript rows in a narrow viewport.",
    },
  };

  const snapshot = buildTimelineSnapshot([item], { totalWidth: 32 });
  assert(snapshot.totalRows > 3);
  assert.equal(snapshot.itemCount, 1);
});

test("keeps a frozen browse snapshot while live rows continue to arrive", () => {
  const live = createSnapshot([2, 2]);
  const browsing = pageUpTimelineViewport(createFollowTailViewport(live.totalRows), live, 3);
  const updated = createSnapshot([2, 2, 1]);
  const withUpdate = syncTimelineViewport(browsing, updated);
  const selected = selectTimelineRows(updated, withUpdate, 3);

  assert.equal(withUpdate.followTail, false);
  assert.equal(withUpdate.unseenItems, 1);
  assert.equal(withUpdate.unseenRows, 1);
  assert.equal(selected.sourceSnapshot.itemCount, 2);
  assert.deepEqual(selected.visibleRows.map((row) => row.key), [
    "item-0-row-0",
    "item-0-row-1",
    "item-1-row-0",
  ]);
});

test("page down from the frozen tail resumes live follow mode", () => {
  const live = createSnapshot([2, 2, 1]);
  const frozenSnapshot = createSnapshot([2, 2]);
  const frozenTail = {
    anchorRow: frozenSnapshot.totalRows - 1,
    followTail: false,
    unseenItems: 1,
    unseenRows: 1,
    frozenSnapshot,
  };
  const resumed = pageDownTimelineViewport(frozenTail, live, 3);

  assert.equal(resumed.followTail, true);
  assert.equal(resumed.anchorRow, live.totalRows - 1);
  assert.equal(resumed.frozenSnapshot, null);
});

test("wheel stepping leaves follow mode and only resumes at the frozen tail", () => {
  const snapshot = createSnapshot([1, 1, 1, 1]);
  const viewportRows = 3;

  const stepUp = stepUpTimelineViewport(createFollowTailViewport(snapshot.totalRows), snapshot, viewportRows);
  assert.equal(stepUp.followTail, false);
  assert.equal(stepUp.anchorRow, snapshot.totalRows - 2);
  assert.equal(stepUp.frozenSnapshot?.itemCount, 4);

  const stepDown = stepDownTimelineViewport(stepUp, snapshot, viewportRows);
  assert.equal(stepDown.followTail, true);
  assert.equal(stepDown.anchorRow, snapshot.totalRows - 1);
  assert.equal(stepDown.frozenSnapshot, null);
});

test("manual browse snapshot survives run start and first assistant delta", () => {
  const initial = createSnapshot([1, 1, 1, 1]);
  const browsing = stepUpTimelineViewport(createFollowTailViewport(initial.totalRows), initial, 3);
  const afterRunStart = syncTimelineViewport(browsing, createSnapshot([1, 1, 1, 1, 1]));
  const afterFirstDelta = syncTimelineViewport(afterRunStart, createSnapshot([1, 1, 1, 1, 1, 2]));
  const selected = selectTimelineRows(createSnapshot([1, 1, 1, 1, 1, 2]), afterFirstDelta, 3);

  assert.equal(afterRunStart.followTail, false);
  assert.equal(afterRunStart.unseenItems, 1);
  assert.equal(afterRunStart.unseenRows, 1);
  assert.equal(afterFirstDelta.followTail, false);
  assert.equal(afterFirstDelta.unseenItems, 2);
  assert.equal(afterFirstDelta.unseenRows, 3);
  assert.deepEqual(selected.visibleRows.map((row) => row.key), [
    "item-0-row-0",
    "item-1-row-0",
    "item-2-row-0",
  ]);
});

test("parses sgr mouse wheel directions without treating other mouse events as scroll", () => {
  const raw = "\u001b[<64;12;9M\u001b[<65;12;10M\u001b[<0;12;10M";
  assert.deepEqual(parseWheelScrollDirections(raw), ["up", "down"]);
});

test("home anchors the browse window to the first page and end restores tail follow", () => {
  const snapshot = createSnapshot([2, 2, 2]);
  const home = homeTimelineViewport(createFollowTailViewport(snapshot.totalRows), snapshot, 4);
  const window = selectTimelineRows(snapshot, home, 4);
  const end = endTimelineViewport(snapshot.totalRows);

  assert.equal(home.followTail, false);
  assert.equal(window.window.startRow, 0);
  assert.equal(window.window.endRow, 4);
  assert.equal(end.followTail, true);
  assert.equal(end.anchorRow, snapshot.totalRows - 1);
});
