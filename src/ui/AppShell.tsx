import React, { memo, useEffect, useMemo, useRef } from "react";
import { Box, Static } from "ink";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import type { Screen, TimelineEvent, UIState } from "../session/types.js";
import { getShellHeight, getShellWidth, type Layout } from "./layout.js";
import {
  buildActiveRenderItems,
  buildStaticRenderItems,
  buildTimelineItems,
  Timeline,
  TimelineRowView,
  type TimelineItem,
} from "./Timeline.js";
import { buildNativeTranscriptParts, type NativeTranscriptRowItem, type TimelineRow } from "./timelineMeasure.js";
import { buildStaticIntroRows, StaticIntroItem } from "./StaticIntroItem.js";

type AppShellLayout = Layout & { layoutEpoch?: number };
type NativeStaticItem =
  | { key: string; type: "session-intro" }
  | ({ type: "rows" } & NativeTranscriptRowItem);

export interface AppShellProps {
  layout: AppShellLayout;
  screen: Screen;
  authState: CodexAuthState;
  workspaceLabel: string;
  workspaceRoot?: string | null;
  runtimeSummary?: RuntimeSummary | null;
  staticEvents: TimelineEvent[];
  activeEvents: TimelineEvent[];
  uiState: UIState;
  panel: React.ReactNode;
  mainPanel?: React.ReactNode;
  mainPanelMode?: "viewport" | "full-output";
  composer: React.ReactNode;
  composerRows: number;
  panelHint?: React.ReactNode;
  verboseMode?: boolean;
  mouseCapture?: boolean;
}

export function isCrampedViewport(rows: number | undefined): boolean {
  return (rows ?? 24) <= 24;
}

function NativeRowsItem({ rows }: { rows: TimelineRow[] }) {
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <TimelineRowView key={row.key} row={row} />
      ))}
    </Box>
  );
}

function AppShellInner({
  layout,
  screen,
  authState,
  workspaceLabel,
  workspaceRoot = null,
  runtimeSummary = null,
  staticEvents,
  activeEvents,
  uiState,
  panel,
  mainPanel,
  mainPanelMode = "viewport",
  composer,
  composerRows,
  panelHint,
  verboseMode = false,
  mouseCapture = false,
}: AppShellProps) {
  renderDebug.useRenderDebug("AppShell", {
    cols: layout.cols,
    rows: layout.rows,
    mode: layout.mode,
    layoutEpoch: layout.layoutEpoch,
    screen,
    authState,
    workspaceLabel,
    workspaceRoot,
    runtimeSummary,
    staticEvents,
    activeEvents,
    uiState,
    composer,
    composerRows,
    verboseMode,
  });
  renderDebug.useLifecycleDebug("AppShell", {
    screen,
    cols: layout.cols,
    rows: layout.rows,
    mode: layout.mode,
  });

  const shellWidth = getShellWidth(layout.cols);
  const shellHeight = getShellHeight(layout.rows);
  const showComposer = screen === "main";
  const showMainPanel = screen === "main" && mainPanel !== undefined && mainPanel !== null;
  const showMainPanelFullOutput = showMainPanel && mainPanelMode === "full-output";
  const showTimeline = screen === "main" && !showMainPanel;
  const showPanelStage = screen !== "main";
  const previousMeasurements = useRef<{
    timelineRows: number;
    composerRows: number;
    shellHeight: number;
    shellWidth: number;
  } | null>(null);

  // Capture the very first render's props for the static intro.
  // Ink's <Static> will re-flush the item if the rendered output changes.
  // By freezing these props, we ensure the intro is truly session-static
  // and doesn't replay when authState or layout changes later.
  const initialIntroRef = useRef<{
    authState: CodexAuthState;
    workspaceLabel: string;
    layout: Layout;
    verboseMode: boolean;
    workspaceRoot: string | null;
  } | null>(null);
  if (!initialIntroRef.current) {
    initialIntroRef.current = {
      authState,
      workspaceLabel,
      layout,
      verboseMode,
      workspaceRoot: workspaceRoot ?? null,
    };
  }

  // Compute the intro block's row count once, using the frozen startup layout.
  // This is used below to anchor the composer at the terminal bottom in native mode.
  const introRowCountRef = useRef<number | null>(null);
  if (introRowCountRef.current === null && !mouseCapture && initialIntroRef.current) {
    introRowCountRef.current = buildStaticIntroRows(initialIntroRef.current).length;
  }
  const introRowCount = introRowCountRef.current ?? 8;

  // Timeline owns all vertical space above the fixed composer.
  const calculatedTimelineRowsRaw = shellHeight - (showComposer ? composerRows : 0);
  const calculatedTimelineRows = Math.max(2, calculatedTimelineRowsRaw);

  const { finalShellHeight, finalShellWidth, finalTimelineRows } = useMemo(() => {
    const prev = previousMeasurements.current;
    const isValid = shellHeight > 0
      && shellWidth > 0
      && Number.isFinite(shellHeight)
      && Number.isFinite(shellWidth)
      && Number.isFinite(calculatedTimelineRowsRaw)
      && calculatedTimelineRowsRaw >= 2;

    if (!isValid && prev) {
      renderDebug.traceEvent("layout", "measurementFallback", {
        reason: "invalid-shell-or-timeline-rows",
        shellHeight,
        shellWidth,
        calculatedTimelineRowsRaw,
        previousTimelineRows: prev.timelineRows,
      });
      return {
        finalShellHeight: prev.shellHeight,
        finalShellWidth: prev.shellWidth,
        finalTimelineRows: prev.timelineRows,
      };
    }

    if (!isValid) {
      renderDebug.traceEvent("layout", "measurementFallback", {
        reason: "invalid-initial-shell-or-timeline-rows",
        shellHeight,
        shellWidth,
        calculatedTimelineRowsRaw,
        clampedTimelineRows: calculatedTimelineRows,
      });
    }

    return {
      finalShellHeight: shellHeight,
      finalShellWidth: shellWidth,
      finalTimelineRows: Math.max(2, calculatedTimelineRows),
    };
  }, [shellHeight, shellWidth, calculatedTimelineRows, calculatedTimelineRowsRaw]);

  const nativeTranscriptParts = useMemo(() => {
    if (mouseCapture) {
      return { staticItems: [], liveRows: [] };
    }

    const staticItems = buildTimelineItems(staticEvents);
    const activeItems = buildTimelineItems(activeEvents);
    const turnIds = [...staticItems, ...activeItems]
      .filter((item): item is Extract<TimelineItem, { type: "turn" }> => item.type === "turn")
      .map((item) => item.turnId);

    const parts = buildNativeTranscriptParts(
      [
        ...buildStaticRenderItems(staticItems, turnIds, null, null, null),
        ...buildActiveRenderItems(activeItems, turnIds, uiState),
      ],
      {
        totalWidth: finalShellWidth,
        verboseMode,
        debugLabel: "app-shell-native",
        workspaceRoot,
      },
    );

    // If we're not supposed to show the timeline yet (e.g. during early mount
    // or when in a full-panel mode), we still calculate the static parts
    // but hide the live rows. This ensures the static array length remains
    // stable in Ink's <Static> component, preventing re-renders.
    if (!showTimeline) {
      return { ...parts, liveRows: [] };
    }

    return parts;
  }, [activeEvents, finalShellWidth, mouseCapture, showTimeline, staticEvents, uiState, verboseMode, workspaceRoot]);

  // In native mode the root box is content-sized (no fixed height), so without an
  // explicit spacer the composer appears immediately after the intro instead of being
  // anchored near the terminal bottom.  The spacer fills the gap between whatever
  // live content exists and where the composer should sit.
  const nativeSpacerRows = useMemo(() => {
    if (mouseCapture || !showComposer || showMainPanel) return 0;
    const liveHeight = nativeTranscriptParts.liveRows.length;
    return Math.max(0, finalShellHeight - introRowCount - composerRows - liveHeight);
  }, [mouseCapture, showComposer, showMainPanel, finalShellHeight, introRowCount, composerRows, nativeTranscriptParts.liveRows.length]);

  // In native mode (no SGR capture), stable rows go into Ink's <Static> as soon as they
  // are no longer changing. Only the current live action/response remains dynamic.
  const nativeStaticAllItems = useMemo<NativeStaticItem[]>(
    () =>
      mouseCapture
        ? []
        : [
          { key: "session-intro", type: "session-intro" as const },
          ...nativeTranscriptParts.staticItems.map((item) => ({ ...item, type: "rows" as const })),
        ],
    [mouseCapture, nativeTranscriptParts.staticItems],
  );

  renderDebug.traceEvent("layout", "nativeTranscript", {
    nativeMode: !mouseCapture,
    mouseCapture,
    showTimeline,
    activeEvents: activeEvents.length,
    staticEvents: staticEvents.length,
    staticItems: nativeStaticAllItems.length,
    liveRows: nativeTranscriptParts.liveRows.length,
    contentSized: true,
    finalTimelineRows,
    composerRows,
  });

  renderDebug.traceLayoutValidity("AppShell", {
    cols: layout.cols,
    rows: layout.rows,
    shellWidth,
    shellHeight,
    timelineRows: finalTimelineRows,
    calculatedTimelineRowsRaw,
    composerRows,
  });
  if (!Number.isFinite(calculatedTimelineRowsRaw) || calculatedTimelineRowsRaw <= 0) {
    renderDebug.traceBlankFrame("AppShell", {
      reason: "invalid-available-timeline-rows",
      availableTimelineRows: calculatedTimelineRowsRaw,
      finalTimelineRows,
      composerRows,
      shellHeight: finalShellHeight,
      screen,
      uiStateKind: uiState.kind,
    });
  }

  useEffect(() => {
    const previous = previousMeasurements.current;
    const changed: string[] = [];
    if (!previous) {
      changed.push("mount");
    } else {
      if (previous.timelineRows !== finalTimelineRows) changed.push("availableTimelineRows");
      if (previous.composerRows !== composerRows) changed.push("composerRows");
      if (previous.shellHeight !== finalShellHeight) changed.push("height");
    }

    if (changed.length > 0) {
      renderDebug.traceEvent("layout", "measurementUpdate", {
        reason: changed.join(","),
        availableTimelineRows: finalTimelineRows,
        rawAvailableTimelineRows: calculatedTimelineRowsRaw,
        composerRows,
        shellHeight: finalShellHeight,
        showComposer,
        showTimeline,
        showMainPanelFullOutput,
      });
    }

    previousMeasurements.current = {
      timelineRows: finalTimelineRows,
      composerRows,
      shellHeight: finalShellHeight,
      shellWidth: finalShellWidth,
    };
  }, [calculatedTimelineRowsRaw, composerRows, finalShellHeight, finalShellWidth, showComposer, showMainPanelFullOutput, showTimeline, finalTimelineRows]);

  if (showMainPanelFullOutput) {
    return (
      <Box flexDirection="column" width="100%">
        <Box flexDirection="column" width={finalShellWidth}>
          {mainPanel}

          {showComposer && (
            <Box flexDirection="column" flexShrink={0}>
              {composer}
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // Native mode: no fixed shell height — content-sized so Ink's lastOutputHeight stays small.
  // Static history is printed once, while live rows only cover the currently changing event.
  if (!mouseCapture) {
    return (
      <Box flexDirection="column" width={finalShellWidth}>
        <Static items={nativeStaticAllItems}>
          {(item) => {
            if (item.type === "session-intro") {
              const intro = initialIntroRef.current!;
              return (
                <StaticIntroItem
                  key="session-intro"
                  authState={intro.authState}
                  workspaceLabel={intro.workspaceLabel}
                  layout={intro.layout}
                  verboseMode={intro.verboseMode}
                  workspaceRoot={intro.workspaceRoot}
                />
              );
            }

            return (
              <NativeRowsItem key={item.key} rows={item.rows} />
            );
          }}
        </Static>

        {showTimeline && nativeTranscriptParts.liveRows.length > 0 && (
          <NativeRowsItem rows={nativeTranscriptParts.liveRows} />
        )}

        {showMainPanel && (
          <Box flexDirection="column" paddingY={1} justifyContent="center">
            {mainPanel}
          </Box>
        )}

        {showPanelStage && (
          <Box flexDirection="column" paddingY={1} justifyContent="center">
            {panel}
          </Box>
        )}

        {nativeSpacerRows > 0 && (
          <Box height={nativeSpacerRows} />
        )}

        {showComposer && (
          <Box flexDirection="column" flexShrink={0}>
            {composer}
          </Box>
        )}

        {showPanelStage && panelHint}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%" height={finalShellHeight}>
      <Box flexDirection="column" width={finalShellWidth}>
        {showTimeline && (
          <Box flexDirection="column" height={finalTimelineRows} overflow="hidden">
            <Timeline
              staticEvents={staticEvents}
              activeEvents={activeEvents}
              layout={layout}
              uiState={uiState}
              viewportRows={finalTimelineRows}
              verboseMode={verboseMode}
              authState={authState}
              workspaceLabel={workspaceLabel}
              workspaceRoot={workspaceRoot}
              mouseCapture={mouseCapture}
            />
          </Box>
        )}

        {showMainPanel && (
          <Box flexDirection="column" height={finalTimelineRows} overflow="hidden" justifyContent="center">
            {mainPanel}
          </Box>
        )}

        {showPanelStage && (
          <Box flexDirection="column" flexGrow={1} justifyContent="center" overflow="hidden" paddingY={1}>
            {panel}
          </Box>
        )}

        {showComposer && (
          <Box flexDirection="column" flexShrink={0}>
            {composer}
          </Box>
        )}

        {showPanelStage && panelHint}
      </Box>
    </Box>
  );
}

/**
 * Memoized AppShell — prevents re-renders when irrelevant App state changes.
 *
 * The App component re-renders on every streaming delta (via dispatchSession),
 * cursor move, and conversationChars update.  AppShell itself only needs to
 * re-render when the layout, screen, event lists, uiState, or composer
 * layout rows actually change.
 *
 * `composer` must remain in the comparator because MemoizedBottomComposer
 * receives value/cursor updates through this prop; without it the composer
 * would display stale input. Non-main panels are compared so picker content can
 * refresh while the active screen stays unchanged, such as model discovery
 * replacing the loading model picker with the interactive picker.
 */
export const AppShell = memo(AppShellInner, (prev, next) => {
  const panelPropsEqual = next.screen === "main"
    ? prev.mainPanel === next.mainPanel
    : (prev.panel === next.panel && prev.panelHint === next.panelHint);

  return (
    prev.layout.cols     === next.layout.cols     &&
    prev.layout.rows     === next.layout.rows     &&
    prev.layout.mode     === next.layout.mode     &&
    prev.layout.layoutEpoch === next.layout.layoutEpoch &&
    prev.screen          === next.screen          &&
    prev.authState       === next.authState       &&
    prev.workspaceLabel  === next.workspaceLabel  &&
    prev.workspaceRoot   === next.workspaceRoot   &&
    prev.runtimeSummary  === next.runtimeSummary  &&
    prev.staticEvents    === next.staticEvents    &&
    prev.activeEvents    === next.activeEvents    &&
    prev.uiState         === next.uiState         &&
    prev.composerRows    === next.composerRows    &&
    prev.composer        === next.composer        &&
    prev.mainPanel       === next.mainPanel       &&
    prev.mainPanelMode   === next.mainPanelMode   &&
    prev.verboseMode     === next.verboseMode     &&
    prev.mouseCapture    === next.mouseCapture    &&
    panelPropsEqual
  );
});
