import assert from "node:assert/strict";
import test from "node:test";
import type { RunProgressEntry, TimelineEvent } from "../session/types.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";
import type { TimelineRow, TimelineSnapshot } from "./timelineMeasure.js";
import { buildTimelineSnapshot } from "./timelineMeasure.js";
import {
  buildActiveRenderItems,
  buildStaticRenderItems,
  buildTimelineItems,
  createFollowTailViewport,
  endTimelineViewport,
  findAnchorItem,
  homeTimelineViewport,
  pageDownTimelineViewport,
  pageUpTimelineViewport,
  parseWheelScrollDirections,
  reflowTimelineViewport,
  resolveTurnOpacity,
  scrollTimelineViewport,
  selectTimelineRows,
  stepDownTimelineViewport,
  stepUpTimelineViewport,
  syncTimelineViewport,
  type RenderTimelineItem,
  type TimelineViewportState,
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

function createProgressEntry(sequence: number, text: string, blockTexts: string[] = [text]): RunProgressEntry {
  return {
    id: `progress-${sequence}`,
    source: "reasoning",
    text,
    sequence,
    createdAt: sequence,
    updatedAt: sequence,
    pendingNewlineCount: 0,
    blocks: blockTexts.map((blockText, index) => ({
      id: `progress-${sequence}-block-${index + 1}`,
      text: blockText,
      sequence: index + 1,
      createdAt: sequence,
      updatedAt: sequence,
      status: index === blockTexts.length - 1 ? "active" : "completed",
    })),
  };
}

function createCompletedProgressEntry(sequence: number, text: string, blockTexts: string[] = [text]): RunProgressEntry {
  const entry = createProgressEntry(sequence, text, blockTexts);
  return {
    ...entry,
    blocks: entry.blocks.map((block) => ({
      ...block,
      status: "completed",
    })),
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
      runtime: TEST_RUNTIME,
      prompt: "Implement rate limiting",
      progressEntries: [createProgressEntry(1, "Scanning routes...")],
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
      contentChunks: [],
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
  assert.equal(items[0].run?.progressEntries[0]?.text, "Scanning routes...");
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
      runtime: TEST_RUNTIME,
      prompt: "Completed turn",
      progressEntries: [],
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
      contentChunks: [],
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
      runtime: TEST_RUNTIME,
      prompt: "Live turn",
      progressEntries: [],
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

test("timeline snapshot keeps the prompt card top border closed", () => {
  const items = buildTimelineItems([
    {
      id: 1,
      type: "user",
      createdAt: 1,
      prompt: "Reproduce the prompt border issue",
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
      runtime: TEST_RUNTIME,
      prompt: "Reproduce the prompt border issue",
      progressEntries: [],
      status: "running",
      summary: "Running",
      truncatedOutput: false,
      toolActivities: [],
      activity: [],
      touchedFileCount: 0,
      errorMessage: null,
      turnId: 10,
    },
  ]);
  const renderItems = buildActiveRenderItems(items, [10], { kind: "THINKING", turnId: 10 });
  const snapshot = buildTimelineSnapshot(renderItems, { totalWidth: 56 });
  const topBorder = snapshot.rows[0]?.spans.map((span) => span.text).join("").trim();

  assert.equal(topBorder?.includes("╭── PROMPT"), true);
  assert.match(topBorder ?? "", /──╮$/);
  assert.doesNotMatch(topBorder ?? "", / ──╮$/);
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

test("default timeline shows compact processing signals while a run is streaming", () => {
  const items = buildTimelineItems([
    {
      id: 1,
      type: "user",
      createdAt: 1,
      prompt: "Create a file",
      turnId: 99,
    },
    {
      id: 2,
      type: "run",
      createdAt: 2,
      startedAt: 2,
      durationMs: null,
      backendId: "codex-subprocess",
      backendLabel: "Codexa",
      runtime: TEST_RUNTIME,
      prompt: "Create a file",
      progressEntries: [
        createProgressEntry(1, "Todo 1/2: Write Hello_World.py"),
        createProgressEntry(2, "Verifying generated file"),
      ],
      status: "running",
      summary: "Running",
      truncatedOutput: false,
      toolActivities: [
        {
          id: "tool-1",
          command: "python -m pytest",
          status: "running",
          startedAt: 2,
        },
      ],
      activity: [
        {
          path: "Hello_World.py",
          operation: "created",
          detectedAt: 3,
        },
      ],
      touchedFileCount: 1,
      errorMessage: null,
      turnId: 99,
    },
    {
      id: 3,
      type: "assistant",
      createdAt: 4,
      content: "I created the file and I am verifying it.",
      contentChunks: [],
      turnId: 99,
    },
  ]);

  const renderItems = buildActiveRenderItems(items, [99], { kind: "RESPONDING", turnId: 99 });
  const snapshot = buildTimelineSnapshot(renderItems, { totalWidth: 70 });
  const joined = snapshot.rows
    .map((row) => row.spans.map((span) => span.text).join(""))
    .join("\n");

  assert.match(joined, /Processing/);
  assert.match(joined, /Verifying generated file/);
  assert.match(joined, /python -m pytest/);
  assert.match(joined, /Hello_World\.py/);
  assert.match(joined, /GPT 5\.4/);
});

test("streaming processing output renders separated readable segments with a live marker", () => {
  const items = buildTimelineItems([
    {
      id: 1,
      type: "user",
      createdAt: 1,
      prompt: "Improve streaming thoughts",
      turnId: 100,
    },
    {
      id: 2,
      type: "run",
      createdAt: 2,
      startedAt: 2,
      durationMs: null,
      backendId: "codex-subprocess",
      backendLabel: "Codexa",
      runtime: TEST_RUNTIME,
      prompt: "Improve streaming thoughts",
      progressEntries: [
        createCompletedProgressEntry(1, "I inspected the renderer and found the content is flattened into plain card rows.", [
          "I inspected the renderer and found the content is flattened into plain card rows.",
        ]),
        createProgressEntry(2, "Next I am separating completed thoughts from the active live segment.", [
          "Next I am separating completed thoughts from the active live segment.",
        ]),
      ],
      status: "running",
      summary: "Running",
      truncatedOutput: false,
      toolActivities: [],
      activity: [],
      touchedFileCount: 0,
      errorMessage: null,
      turnId: 100,
    },
    {
      id: 3,
      type: "assistant",
      createdAt: 4,
      content: "Working...",
      contentChunks: [],
      turnId: 100,
    },
  ]);

  const renderItems = buildActiveRenderItems(items, [100], { kind: "RESPONDING", turnId: 100 });
  const snapshot = buildTimelineSnapshot(renderItems, { totalWidth: 54 });
  const joined = snapshot.rows
    .map((row) => row.spans.map((span) => span.text).join(""))
    .join("\n");

  assert.match(joined, /Current: Next I am separating/);
  assert.match(joined, /Update 1/);
  assert.match(joined, /Live/);
  assert.match(joined, /▌/);
  assert.ok(snapshot.rows.every((row) => row.spans.map((span) => span.text).join("").length <= 54));
});

test("completed runs keep progress updates as separate readable blocks", () => {
  const items = buildTimelineItems([
    {
      id: 1,
      type: "user",
      createdAt: 1,
      prompt: "Investigate the failure",
      turnId: 77,
    },
    {
      id: 2,
      type: "run",
      createdAt: 2,
      startedAt: 2,
      durationMs: 1200,
      backendId: "codex-subprocess",
      backendLabel: "Codexa",
      runtime: TEST_RUNTIME,
      prompt: "Investigate the failure",
      progressEntries: [
        createProgressEntry(1, "Checking the failing test"),
        createProgressEntry(2, "Reviewing output\n\nComparing expected behavior", [
          "Reviewing output",
          "Comparing expected behavior",
        ]),
      ],
      status: "completed",
      summary: "Completed",
      truncatedOutput: false,
      toolActivities: [],
      activity: [],
      touchedFileCount: 0,
      errorMessage: null,
      turnId: 77,
    },
    {
      id: 3,
      type: "assistant",
      createdAt: 3,
      content: "Done",
      contentChunks: [],
      turnId: 77,
    },
  ]);

  const renderItems = buildStaticRenderItems(items, [77], null, null, null);
  const snapshot = buildTimelineSnapshot(renderItems, { totalWidth: 72 });
  const joined = snapshot.rows
    .map((row) => row.spans.map((span) => span.text).join(""))
    .join("\n");

  assert.match(joined, /Processing/);
  assert.match(joined, /Update 1/);
  assert.match(joined, /Update 2/);
  assert.match(joined, /Checking the failing test/);
  assert.match(joined, /Comparing expected behavior/);
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

// ─── findAnchorItem ───────────────────────────────────────────────────────────

test("findAnchorItem locates the item and row-within-item for a given anchorRow", () => {
  // snapshot: 3 items with [2, 3, 2] rows = rows 0-1, 2-4, 5-6
  const snapshot = createSnapshot([2, 3, 2]);

  // First item, first row
  assert.deepEqual(findAnchorItem(snapshot, 0), { itemIndex: 0, rowWithinItem: 0 });
  // First item, last row
  assert.deepEqual(findAnchorItem(snapshot, 1), { itemIndex: 0, rowWithinItem: 1 });
  // Second item, first row
  assert.deepEqual(findAnchorItem(snapshot, 2), { itemIndex: 1, rowWithinItem: 0 });
  // Second item, middle row
  assert.deepEqual(findAnchorItem(snapshot, 3), { itemIndex: 1, rowWithinItem: 1 });
  // Second item, last row
  assert.deepEqual(findAnchorItem(snapshot, 4), { itemIndex: 1, rowWithinItem: 2 });
  // Third item, last row
  assert.deepEqual(findAnchorItem(snapshot, 6), { itemIndex: 2, rowWithinItem: 1 });
});

test("findAnchorItem clamps to last item when anchorRow is beyond snapshot bounds", () => {
  const snapshot = createSnapshot([2, 3]);
  // totalRows = 5, so anchorRow 99 should clamp to last item's last row
  const result = findAnchorItem(snapshot, 99);
  assert.equal(result.itemIndex, 1);
  assert.equal(result.rowWithinItem, 2); // last item has 3 rows → last = 2
});

// ─── reflowTimelineViewport ───────────────────────────────────────────────────

test("reflowTimelineViewport keeps followTail when user is pinned to bottom", () => {
  const liveSnapshot = createSnapshot([2, 3, 2]);
  const pinned = createFollowTailViewport(liveSnapshot.totalRows);
  const reflowed = reflowTimelineViewport(pinned, liveSnapshot);

  assert.equal(reflowed.followTail, true);
  assert.equal(reflowed.anchorRow, liveSnapshot.totalRows - 1);
  assert.equal(reflowed.frozenSnapshot, null);
});

test("reflowTimelineViewport maps anchor to same item when width decreases (more wrapping)", () => {
  // Old layout: 2 items with [2, 3] rows.  User is looking at row 1 (end of item-0).
  const oldFrozen = createSnapshot([2, 3]);
  const browsing: TimelineViewportState = {
    anchorRow: 1, // last row of item-0
    followTail: false,
    unseenItems: 0,
    unseenRows: 0,
    frozenSnapshot: oldFrozen,
  };

  // New layout (narrower): same 2 items but item-0 now wraps to 4 rows, item-1 to 5 rows
  const newLive = createSnapshot([4, 5]);
  const reflowed = reflowTimelineViewport(browsing, newLive);

  assert.equal(reflowed.followTail, false);
  // item-0 is now 4 rows.  rowWithinItem was 1, still 1 in new layout.
  // new anchorRow = 0 (rows before item-0) + 1 = 1
  assert.equal(reflowed.anchorRow, 1);
  assert.equal(reflowed.frozenSnapshot?.itemCount, 2);
  assert.equal(reflowed.frozenSnapshot?.totalRows, 9); // 4 + 5
});

test("reflowTimelineViewport clamps rowWithinItem when width increases (less wrapping)", () => {
  // Old layout: item-0 has 5 rows.  Anchor at row 4 (last row of item-0).
  const oldFrozen = createSnapshot([5, 3]);
  const browsing: TimelineViewportState = {
    anchorRow: 4,
    followTail: false,
    unseenItems: 0,
    unseenRows: 0,
    frozenSnapshot: oldFrozen,
  };

  // New layout (wider): item-0 now wraps to only 2 rows (less wrapping), item-1 to 1 row
  const newLive = createSnapshot([2, 1]);
  const reflowed = reflowTimelineViewport(browsing, newLive);

  assert.equal(reflowed.followTail, false);
  // rowWithinItem was 4, but item-0 only has 2 rows → clamped to 1 (last row)
  // new anchorRow = 0 + 1 = 1
  assert.equal(reflowed.anchorRow, 1);
  assert.equal(reflowed.frozenSnapshot?.totalRows, 3); // 2 + 1
});

test("reflowTimelineViewport preserves unseenItems and unseenRows after width change", () => {
  // User scrolled up when there were 2 items.  One more item arrived since then.
  const oldFrozen = createSnapshot([2, 3]);
  const browsing: TimelineViewportState = {
    anchorRow: 4, // last row of item-1 in old frozen
    followTail: false,
    unseenItems: 1,
    unseenRows: 2,
    frozenSnapshot: oldFrozen,
  };

  // New layout: 3 items (frozen 2 + 1 unseen), all at new width
  const newLive = createSnapshot([3, 4, 2]); // 9 total
  const reflowed = reflowTimelineViewport(browsing, newLive);

  assert.equal(reflowed.followTail, false);
  // frozenItemCount = 2 → new frozen uses first 2 items from newLive: [3, 4]
  assert.equal(reflowed.frozenSnapshot?.itemCount, 2);
  assert.equal(reflowed.frozenSnapshot?.totalRows, 7); // 3 + 4
  // unseenItems = 3 - 2 = 1
  assert.equal(reflowed.unseenItems, 1);
  // unseenRows = 9 - 7 = 2
  assert.equal(reflowed.unseenRows, 2);
});

test("reflowTimelineViewport does not snap to bottom during active streaming", () => {
  // User scrolled up mid-stream.  frozenSnapshot has 3 items (includes partial assistant).
  const oldFrozen = createSnapshot([1, 2, 3]);
  const browsing: TimelineViewportState = {
    anchorRow: 2, // within item-1 (rows 1-2) → rowWithinItem = 1
    followTail: false,
    unseenItems: 0,
    unseenRows: 0,
    frozenSnapshot: oldFrozen,
  };

  // Width change arrives mid-stream: liveSnapshot has grown (assistant has more content)
  // Items 0..2 from frozenSnapshot, item-2 now larger due to more streaming content
  const newLive = createSnapshot([1, 2, 6]);
  const reflowed = reflowTimelineViewport(browsing, newLive);

  // Must NOT snap to bottom
  assert.equal(reflowed.followTail, false);
  // item-1 has 2 rows in new layout → rowWithinItem=1 preserved
  // anchorRow = item-0 (1 row) + 1 = 2
  assert.equal(reflowed.anchorRow, 2);
  assert.equal(reflowed.frozenSnapshot?.itemCount, 3);
});

// ─── selectTimelineRows: height-change stability ──────────────────────────────

test("height increase while scrolled up shows more content above without snapping to bottom", () => {
  const snapshot = createSnapshot([3, 3, 3, 3]); // 12 rows, 4 items
  // User is at anchorRow=8 (last row of item-2), viewing rows 5-8 at viewportRows=4
  const browsing: TimelineViewportState = {
    anchorRow: 8,
    followTail: false,
    unseenItems: 0,
    unseenRows: 0,
    frozenSnapshot: snapshot,
  };

  const smallViewport = selectTimelineRows(snapshot, browsing, 4);
  assert.equal(smallViewport.window.startRow, 5);
  assert.equal(smallViewport.window.endRow, 9);

  // Terminal grows to 8 rows — more content visible above, bottom anchor preserved
  const largeViewport = selectTimelineRows(snapshot, browsing, 8);
  assert.equal(largeViewport.window.startRow, 1);
  assert.equal(largeViewport.window.endRow, 9);
  // Confirm not snapped to bottom
  assert.notEqual(largeViewport.window.endRow, snapshot.totalRows);
});

test("height decrease while scrolled up preserves bottom anchor", () => {
  const snapshot = createSnapshot([3, 3, 3, 3]); // 12 rows
  const browsing: TimelineViewportState = {
    anchorRow: 8,
    followTail: false,
    unseenItems: 0,
    unseenRows: 0,
    frozenSnapshot: snapshot,
  };

  // Viewport shrinks from 4 to 2 rows
  const shrunk = selectTimelineRows(snapshot, browsing, 2);
  // Bottom (anchorRow=8) is preserved; only 2 rows visible
  assert.equal(shrunk.window.endRow, 9);
  assert.equal(shrunk.window.startRow, 7);
  assert.equal(shrunk.visibleRows.length, 2);
});

// ─── streaming while detached does not jump to bottom ────────────────────────

test("streaming deltas while detached do not move the viewport to bottom", () => {
  const initial = createSnapshot([1, 1, 1, 1]); // 4 items, 4 rows
  // User pages up — frozen at initial snapshot
  const browsing = pageUpTimelineViewport(createFollowTailViewport(initial.totalRows), initial, 3);
  assert.equal(browsing.followTail, false);

  // Multiple streaming deltas arrive (same width — syncTimelineViewport path)
  const afterDelta1 = syncTimelineViewport(browsing, createSnapshot([1, 1, 1, 1, 2]));
  const afterDelta2 = syncTimelineViewport(afterDelta1, createSnapshot([1, 1, 1, 1, 4]));
  const afterDelta3 = syncTimelineViewport(afterDelta2, createSnapshot([1, 1, 1, 1, 6]));

  // Must remain detached throughout
  assert.equal(afterDelta3.followTail, false);
  assert.equal(afterDelta3.frozenSnapshot?.itemCount, 4);

  // The visible rows are still from the frozen snapshot, not the live tail
  const selected = selectTimelineRows(createSnapshot([1, 1, 1, 1, 6]), afterDelta3, 3);
  assert.equal(selected.sourceSnapshot.itemCount, 4);
  assert.notEqual(selected.window.endRow, 11); // not snapped to live tail
});

test("scrolling down to the frozen tail with pending unseen content resumes live follow", () => {
  const initial = createSnapshot([2, 2]);
  const browsing = scrollTimelineViewport(
    createFollowTailViewport(initial.totalRows),
    initial,
    4,
    -2, // scroll up 2 rows
  );
  assert.equal(browsing.followTail, false);

  const updated = createSnapshot([2, 2, 3]);
  const withNew = syncTimelineViewport(browsing, updated);
  assert.equal(withNew.unseenItems, 1);

  // Scroll down past frozen tail → resume follow
  const resumed = pageDownTimelineViewport(withNew, updated, 4);
  assert.equal(resumed.followTail, true);
  assert.equal(resumed.frozenSnapshot, null);
});
