import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import * as renderDebug from "../../core/perf/renderDebug.js";
import type { TimelineEvent, UIState } from "../../session/types.js";
import type { TimelineSnapshot } from "./measure/types.js";
import { isBusyUiState } from "./timelineItems.js";
import {
  createFollowTailViewport,
  reflowTimelineViewport,
  selectTimelineRows,
  syncTimelineViewport,
  type TimelineViewportState,
} from "./timelineViewport.js";

interface TimelineViewportInput {
  snapshotForViewport: TimelineSnapshot;
  effectiveSnapshot: TimelineSnapshot;
  liveSnapshot: TimelineSnapshot;
  snapshotWidth: number;
  viewportRows: number;
  finalizeTransition: boolean;
  finalizedPlanAtTail: boolean;
  finalizeTransitionRef: RefObject<{
    runningTurnIds: number[];
    finalizedTurnIds: number[];
    busy: boolean;
  }>;
  runningTurnIds: number[];
  finalizedTurnIds: number[];
  uiState: UIState;
  staticEvents: TimelineEvent[];
  activeEvents: TimelineEvent[];
}

export function useTimelineViewport({
  snapshotForViewport,
  effectiveSnapshot,
  snapshotWidth,
  viewportRows,
  finalizeTransition,
  finalizedPlanAtTail,
  finalizeTransitionRef,
  runningTurnIds,
  finalizedTurnIds,
  uiState,
  staticEvents,
  activeEvents,
  liveSnapshot,
}: TimelineViewportInput) {
  const [viewport, setViewport] = useState<TimelineViewportState>(() =>
    createFollowTailViewport(snapshotForViewport.totalRows),
  );
  // Tracks the previous snapshotWidth so we can detect width changes inside
  // the liveSnapshot effect and dispatch reflowTimelineViewport instead of
  // syncTimelineViewport when the terminal has been resized.
  const snapshotWidthRef = useRef(snapshotWidth);
  // Tracks previous totalRows so we can skip setViewport when no new rows
  // arrived — avoiding a second React render / Ink stdout write per streaming
  // flush when the viewport already reflects the correct state.
  const prevTotalRowsRef = useRef(effectiveSnapshot.totalRows);
  useEffect(() => {
    const widthChanged = snapshotWidthRef.current !== snapshotWidth;
    snapshotWidthRef.current = snapshotWidth;

    const totalRows = snapshotForViewport.totalRows;
    const previousTotalRows = prevTotalRowsRef.current;
    const rowGrowth = totalRows - previousTotalRows;
    const totalRowsGrew = rowGrowth > 0;
    prevTotalRowsRef.current = totalRows;

    setViewport((current) => {
      // Width change: always reflow or sync to wrap text at the new width.
      if (widthChanged) {
        const next =
          !current.followTail && current.frozenSnapshot !== null
            ? reflowTimelineViewport(current, snapshotForViewport)
            : syncTimelineViewport(current, snapshotForViewport);
        renderDebug.traceFlickerEvent("viewportSync", {
          reason: "width-change",
          result: next === current ? "skipped" : "updated",
          previousTotalRows,
          totalRows,
          rowGrowth,
          previousAnchorRow: current.anchorRow,
          anchorRow: next.anchorRow,
          followTail: next.followTail,
          viewportRows,
        });
        return next;
      }

      // Frozen (user scrolled up): keep the frozen snapshot fresh when rows
      // grow or the stream finalizes so the unseen-item counters and
      // jump-to-bottom affordance stay accurate.
      if (!current.followTail) {
        const next =
          totalRowsGrew || finalizeTransition
            ? syncTimelineViewport(current, snapshotForViewport)
            : current;
        renderDebug.traceFlickerEvent("viewportSync", {
          reason: finalizeTransition
            ? totalRowsGrew
              ? "detached-finalize-growth"
              : "detached-finalize"
            : totalRowsGrew
              ? "detached-growth"
              : "detached-no-growth",
          result: next === current ? "skipped" : "updated",
          previousTotalRows,
          totalRows,
          rowGrowth,
          previousAnchorRow: current.anchorRow,
          anchorRow: next.anchorRow,
          followTail: next.followTail,
          viewportRows,
        });
        return next;
      }

      // Follow-tail: only advance anchorRow when content actually grew.
      // Streaming is append-only so shrinking rows is rare; if it happens the
      // anchorRow stays at the old position until the next growth tick.
      if (!totalRowsGrew) {
        renderDebug.traceFlickerEvent("viewportSync", {
          reason: "follow-tail-no-growth",
          result: "skipped",
          previousTotalRows,
          totalRows,
          rowGrowth,
          previousAnchorRow: current.anchorRow,
          anchorRow: current.anchorRow,
          followTail: current.followTail,
          viewportRows,
        });
        return current;
      }

      const useFinalizeContinuity =
        finalizeTransition &&
        !finalizedPlanAtTail &&
        rowGrowth > Math.max(1, Math.floor(viewportRows / 2));
      const next = syncTimelineViewport(current, snapshotForViewport, {
        finalizeContinuity: useFinalizeContinuity ? { previousTotalRows, viewportRows } : undefined,
      });
      renderDebug.traceFlickerEvent("viewportSync", {
        reason: useFinalizeContinuity ? "finalize-continuity" : "follow-tail-growth",
        result: next === current ? "skipped" : "updated",
        previousTotalRows,
        totalRows,
        rowGrowth,
        previousAnchorRow: current.anchorRow,
        anchorRow: next.anchorRow,
        followTail: next.followTail,
        viewportRows,
      });
      return next;
    });
  }, [finalizeTransition, finalizedPlanAtTail, snapshotForViewport, snapshotWidth, viewportRows]);

  useEffect(() => {
    finalizeTransitionRef.current = {
      runningTurnIds,
      finalizedTurnIds,
      busy: isBusyUiState(uiState),
    };
  }, [finalizedTurnIds, runningTurnIds, uiState]);

  const userPromptCount = useMemo(() => {
    return [...staticEvents, ...activeEvents].filter((event) => event.type === "user").length;
  }, [activeEvents, staticEvents]);

  const prevUserPromptCountRef = useRef(userPromptCount);

  useEffect(() => {
    if (userPromptCount > prevUserPromptCountRef.current) {
      setViewport(createFollowTailViewport(snapshotForViewport.totalRows));
    }
    prevUserPromptCountRef.current = userPromptCount;
  }, [userPromptCount, snapshotForViewport.totalRows]);

  const { visibleRows } = useMemo(() => {
    const selection = selectTimelineRows(snapshotForViewport, viewport, viewportRows);
    renderDebug.traceEvent("viewport", "slice", {
      providerState: uiState.kind,
      visibleRows: selection.visibleRows.length,
      visibleStart: selection.window.startRow,
      visibleEnd: selection.window.endRow,
      anchorRow: selection.window.anchorRow,
      maxScrollOffset: Math.max(0, selection.sourceSnapshot.totalRows - viewportRows),
      followTail: viewport.followTail,
      totalItems: selection.sourceSnapshot.itemCount,
      totalRows: selection.sourceSnapshot.totalRows,
      availableTimelineRows: viewportRows,
      sliceEmpty: selection.visibleRows.length === 0 && selection.sourceSnapshot.totalRows > 0,
      fallbackSnapshot: snapshotForViewport !== liveSnapshot,
    });
    renderDebug.traceFlickerEvent("viewportSlice", {
      visibleRows: selection.visibleRows.length,
      startRow: selection.window.startRow,
      endRow: selection.window.endRow,
      anchorRow: selection.window.anchorRow,
      followTail: viewport.followTail,
      totalRows: selection.sourceSnapshot.totalRows,
      fallbackSnapshot: snapshotForViewport !== liveSnapshot,
    });
    return selection;
  }, [snapshotForViewport, viewport, viewportRows]);
  return { visibleRows };
}
