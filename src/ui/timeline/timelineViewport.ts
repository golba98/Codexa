import type { TimelineRow, TimelineSnapshot } from "./timelineMeasure.js";

// Re-enter follow-tail mode when the user scrolls within this many rows of the
// tail, preventing a "stuck just above bottom" state after a near-end wheel scroll.
export const NEAR_BOTTOM_THRESHOLD = 3;

export interface TimelineViewportState {
  anchorRow: number;
  followTail: boolean;
  unseenItems: number;
  unseenRows: number;
  frozenSnapshot: TimelineSnapshot | null;
}

export interface FinalizeContinuityOptions {
  previousTotalRows: number;
  viewportRows: number;
}

export function clampAnchorRow(anchorRow: number, totalRows: number): number {
  if (totalRows <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(anchorRow, totalRows - 1));
}

export function isNearBottom(anchorRow: number, totalRows: number): boolean {
  return totalRows <= 0 || anchorRow >= totalRows - 1 - NEAR_BOTTOM_THRESHOLD;
}

export function getFirstPageAnchor(totalRows: number, viewportRows: number): number {
  if (totalRows <= 0) {
    return 0;
  }
  return Math.min(totalRows - 1, Math.max(0, viewportRows - 1));
}

export function createFollowTailViewport(totalRows: number): TimelineViewportState {
  return {
    anchorRow: Math.max(0, totalRows - 1),
    followTail: true,
    unseenItems: 0,
    unseenRows: 0,
    frozenSnapshot: null,
  };
}

export function createAnchoredViewport(
  snapshot: TimelineSnapshot,
  anchorRow: number,
): TimelineViewportState {
  return {
    anchorRow: clampAnchorRow(anchorRow, snapshot.totalRows),
    followTail: false,
    unseenItems: 0,
    unseenRows: 0,
    frozenSnapshot: snapshot,
  };
}

export function findFinalResponseStartRow(
  snapshot: TimelineSnapshot,
  previousTotalRows: number,
  viewportRows: number,
): number | null {
  const searchFloor = Math.max(0, previousTotalRows - Math.max(1, viewportRows));
  const responseIndex = snapshot.rows.findIndex(
    (row, index) => index >= searchFloor && row.key.includes("-codex-response-"),
  );
  return responseIndex >= 0 ? responseIndex : null;
}

export function createFinalizeContinuityViewport(
  snapshot: TimelineSnapshot,
  options: FinalizeContinuityOptions,
): TimelineViewportState {
  if (snapshot.totalRows === 0) {
    return createFollowTailViewport(0);
  }

  const responseStartRow = findFinalResponseStartRow(
    snapshot,
    options.previousTotalRows,
    options.viewportRows,
  );
  const answerPreviewRows = Math.min(3, Math.max(1, Math.floor(options.viewportRows / 4)));
  const fallbackAnchor = options.previousTotalRows + answerPreviewRows - 1;
  const anchorRow =
    responseStartRow === null ? fallbackAnchor : responseStartRow + answerPreviewRows - 1;

  return createAnchoredViewport(snapshot, Math.min(snapshot.totalRows - 1, Math.max(0, anchorRow)));
}

// ─── Viewport operations ─────────────────────────────────────────────────────

export function getFrozenSnapshot(
  viewport: TimelineViewportState,
  liveSnapshot: TimelineSnapshot,
): TimelineSnapshot {
  return viewport.followTail || viewport.frozenSnapshot === null
    ? liveSnapshot
    : viewport.frozenSnapshot;
}

export function syncTimelineViewport(
  viewport: TimelineViewportState,
  liveSnapshot: TimelineSnapshot,
  options: { finalizeContinuity?: FinalizeContinuityOptions } = {},
): TimelineViewportState {
  if (liveSnapshot.totalRows === 0) {
    // Preserve a frozen scroll offset through a transient empty-snapshot moment so
    // the user's reading position is not reset to row 0.  Only reset when the
    // viewport is already in follow-tail mode (there is nothing meaningful to preserve).
    return viewport.followTail ? createFollowTailViewport(0) : viewport;
  }

  if (viewport.followTail) {
    if (options.finalizeContinuity) {
      return createFinalizeContinuityViewport(liveSnapshot, options.finalizeContinuity);
    }

    const nextAnchor = liveSnapshot.totalRows - 1;
    if (
      viewport.anchorRow === nextAnchor &&
      viewport.unseenItems === 0 &&
      viewport.unseenRows === 0 &&
      viewport.frozenSnapshot === null
    ) {
      return viewport;
    }
    return createFollowTailViewport(liveSnapshot.totalRows);
  }

  const frozenSnapshot = viewport.frozenSnapshot ?? liveSnapshot;
  const anchorRow = clampAnchorRow(viewport.anchorRow, frozenSnapshot.totalRows);
  const unseenItems = Math.max(0, liveSnapshot.itemCount - frozenSnapshot.itemCount);
  const unseenRows = Math.max(0, liveSnapshot.totalRows - frozenSnapshot.totalRows);

  if (
    viewport.anchorRow === anchorRow &&
    viewport.unseenItems === unseenItems &&
    viewport.unseenRows === unseenRows &&
    viewport.frozenSnapshot === frozenSnapshot
  ) {
    return viewport;
  }

  return detachedViewport(anchorRow, frozenSnapshot, liveSnapshot);
}

/**
 * Returns the item index and row-within-item for the given absolute anchorRow
 * inside a snapshot.  Used by reflowTimelineViewport to translate a row-based
 * anchor into a layout-independent (item, offset) anchor.
 */
export function findAnchorItem(
  snapshot: TimelineSnapshot,
  anchorRow: number,
): { itemIndex: number; rowWithinItem: number } {
  let rowOffset = 0;
  for (let i = 0; i < snapshot.items.length; i++) {
    const item = snapshot.items[i]!;
    if (rowOffset + item.rowCount > anchorRow) {
      return { itemIndex: i, rowWithinItem: anchorRow - rowOffset };
    }
    rowOffset += item.rowCount;
  }
  // anchorRow is at or beyond the last item – clamp to end
  const lastIdx = Math.max(0, snapshot.items.length - 1);
  const lastItem = snapshot.items[lastIdx];
  return {
    itemIndex: lastIdx,
    rowWithinItem: lastItem ? Math.max(0, lastItem.rowCount - 1) : 0,
  };
}

/**
 * Rebuilds the frozen viewport snapshot after a terminal width change.
 *
 * When the terminal is resized (width changes), all snapshot memos are
 * rebuilt at the new snapshotWidth, so liveSnapshot already contains
 * correctly reflowed rows.  However syncTimelineViewport preserves the
 * old frozenSnapshot (with old-width rows), causing visual corruption.
 *
 * This function replaces the stale frozen snapshot with a new one built
 * from the same items as before (liveSnapshot.items[0..frozenItemCount]),
 * now correctly wrapped at the new width.  The anchorRow is translated
 * from the old layout via an item-level anchor so the user's reading
 * position is preserved across reflow.
 */
export function reflowTimelineViewport(
  viewport: TimelineViewportState,
  liveSnapshot: TimelineSnapshot,
): TimelineViewportState {
  if (liveSnapshot.totalRows === 0) {
    return createFollowTailViewport(0);
  }

  if (viewport.followTail) {
    return createFollowTailViewport(liveSnapshot.totalRows);
  }

  const oldFrozen = viewport.frozenSnapshot ?? liveSnapshot;

  // Translate anchorRow → stable (item, rowWithinItem) anchor
  const clampedAnchor = clampAnchorRow(viewport.anchorRow, oldFrozen.totalRows);
  const { itemIndex: anchorItemIdx, rowWithinItem: anchorRowWithinItem } = findAnchorItem(
    oldFrozen,
    clampedAnchor,
  );

  // Grab the same items from liveSnapshot (already reflowed at new width)
  const frozenItemCount = oldFrozen.itemCount;
  const newFrozenItems = liveSnapshot.items.slice(0, frozenItemCount);

  if (newFrozenItems.length === 0) {
    return createFollowTailViewport(liveSnapshot.totalRows);
  }

  // Assemble a new frozen snapshot from the reflowed items
  const newFrozenRows = newFrozenItems.flatMap((item) => item.rows);
  const newFrozenSnapshot: TimelineSnapshot = {
    items: newFrozenItems,
    rows: newFrozenRows,
    totalRows: newFrozenRows.length,
    itemCount: frozenItemCount,
  };

  // Reconstruct anchorRow in the new layout
  let newAnchorRow = 0;
  for (let i = 0; i < anchorItemIdx; i++) {
    newAnchorRow += newFrozenItems[i]!.rowCount;
  }
  const targetItem = newFrozenItems[anchorItemIdx];
  if (targetItem) {
    newAnchorRow += Math.min(anchorRowWithinItem, targetItem.rowCount - 1);
  } else {
    // Anchor item is beyond the new frozen range (unseen) – clamp to end
    newAnchorRow = Math.max(0, newFrozenSnapshot.totalRows - 1);
  }
  newAnchorRow = clampAnchorRow(newAnchorRow, newFrozenSnapshot.totalRows);

  const unseenItems = Math.max(0, liveSnapshot.itemCount - frozenItemCount);
  const unseenRows = Math.max(0, liveSnapshot.totalRows - newFrozenSnapshot.totalRows);

  return {
    anchorRow: newAnchorRow,
    followTail: false,
    unseenItems,
    unseenRows,
    frozenSnapshot: newFrozenSnapshot,
  };
}

export function scrollTimelineViewport(
  viewport: TimelineViewportState,
  liveSnapshot: TimelineSnapshot,
  viewportRows: number,
  deltaRows: number,
): TimelineViewportState {
  if (liveSnapshot.totalRows === 0) {
    return createFollowTailViewport(0);
  }
  if (deltaRows === 0) {
    return viewport;
  }

  const frozenSnapshot = getFrozenSnapshot(viewport, liveSnapshot);
  const tailRow = Math.max(0, frozenSnapshot.totalRows - 1);

  if (deltaRows > 0 && viewport.followTail) {
    return viewport;
  }

  const currentAnchor = viewport.followTail
    ? tailRow
    : clampAnchorRow(viewport.anchorRow, frozenSnapshot.totalRows);

  const floor = getFirstPageAnchor(frozenSnapshot.totalRows, viewportRows);

  let nextAnchor = currentAnchor + deltaRows;

  if (nextAnchor >= tailRow) {
    return createFollowTailViewport(liveSnapshot.totalRows);
  }

  if (nextAnchor < floor) {
    nextAnchor = floor;
  }

  return detachedViewport(nextAnchor, frozenSnapshot, liveSnapshot);
}

// ─── Row selection & render items ────────────────────────────────────────────

export function selectTimelineRows(
  liveSnapshot: TimelineSnapshot,
  viewport: TimelineViewportState,
  viewportRows: number,
): {
  sourceSnapshot: TimelineSnapshot;
  visibleRows: TimelineRow[];
  window: {
    startRow: number;
    endRow: number;
    anchorRow: number;
  };
} {
  const sourceSnapshot =
    viewport.followTail || viewport.frozenSnapshot === null
      ? liveSnapshot
      : viewport.frozenSnapshot;
  const safeViewportRows = Math.max(1, viewportRows);

  if (sourceSnapshot.totalRows === 0) {
    return {
      sourceSnapshot,
      visibleRows: [],
      window: { startRow: 0, endRow: 0, anchorRow: 0 },
    };
  }

  const anchorRow = viewport.followTail
    ? sourceSnapshot.totalRows - 1
    : clampAnchorRow(viewport.anchorRow, sourceSnapshot.totalRows);
  const endRow = Math.max(1, anchorRow + 1);
  const startRow = Math.max(0, endRow - safeViewportRows);

  const visibleRows = sourceSnapshot.rows.slice(startRow, endRow);

  // Aggressive fallback: if slicing returned nothing but we have rows,
  // return at least the last row to avoid a blank screen.
  if (visibleRows.length === 0 && sourceSnapshot.totalRows > 0) {
    const fallbackRow = sourceSnapshot.rows[sourceSnapshot.totalRows - 1]!;
    return {
      sourceSnapshot,
      visibleRows: [fallbackRow],
      window: {
        startRow: sourceSnapshot.totalRows - 1,
        endRow: sourceSnapshot.totalRows,
        anchorRow: sourceSnapshot.totalRows - 1,
      },
    };
  }

  return {
    sourceSnapshot,
    visibleRows,
    window: {
      startRow,
      endRow,
      anchorRow,
    },
  };
}

function detachedViewport(
  anchorRow: number,
  frozenSnapshot: TimelineSnapshot,
  liveSnapshot: TimelineSnapshot,
): TimelineViewportState {
  return {
    anchorRow,
    followTail: false,
    unseenItems: Math.max(0, liveSnapshot.itemCount - frozenSnapshot.itemCount),
    unseenRows: Math.max(0, liveSnapshot.totalRows - frozenSnapshot.totalRows),
    frozenSnapshot,
  };
}
