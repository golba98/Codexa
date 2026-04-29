import React, { memo, useEffect, useMemo, useRef } from "react";
import { Box } from "ink";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import type { Screen, TimelineEvent, UIState } from "../session/types.js";
import { getShellHeight, getShellWidth, type Layout } from "./layout.js";
import { Timeline } from "./Timeline.js";
import { measureTopHeaderRows, MemoizedTopHeader } from "./TopHeader.js";

type AppShellLayout = Layout & { layoutEpoch?: number };

export interface AppShellProps {
  layout: AppShellLayout;
  screen: Screen;
  authState: CodexAuthState;
  workspaceLabel: string;
  runtimeSummary?: RuntimeSummary | null;
  staticEvents: TimelineEvent[];
  activeEvents: TimelineEvent[];
  uiState: UIState;
  panel: React.ReactNode;
  composer: React.ReactNode;
  composerRows: number;
  panelHint?: React.ReactNode;
  verboseMode?: boolean;
}

export function isCrampedViewport(rows: number | undefined): boolean {
  return (rows ?? 24) <= 24;
}

function AppShellInner({
  layout,
  screen,
  authState,
  workspaceLabel,
  runtimeSummary = null,
  staticEvents,
  activeEvents,
  uiState,
  panel,
  composer,
  composerRows,
  panelHint,
  verboseMode = false,
}: AppShellProps) {
  renderDebug.useRenderDebug("AppShell", {
    cols: layout.cols,
    rows: layout.rows,
    mode: layout.mode,
    layoutEpoch: layout.layoutEpoch,
    screen,
    authState,
    workspaceLabel,
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
  const showTimeline = screen === "main";
  const showPanelStage = screen !== "main";
  const previousMeasurements = useRef<{
    headerRows: number;
    timelineRows: number;
    composerRows: number;
    shellHeight: number;
  } | null>(null);

  // Memoize headerRows — only changes when layout mode/cols changes, not on streaming.
  const headerRows = useMemo(
    () => (showTimeline ? measureTopHeaderRows(layout) + 1 : 0),
    [showTimeline, layout.cols, layout.rows, layout.mode],
  );

  // timelineRows similarly stable — only changes when layout or composerRows change.
  const timelineRows = useMemo(
    () => Math.max(1, shellHeight - headerRows - (showComposer ? composerRows : 0)),
    [shellHeight, headerRows, showComposer, composerRows],
  );
  renderDebug.traceLayoutValidity("AppShell", {
    cols: layout.cols,
    rows: layout.rows,
    shellWidth,
    shellHeight,
    headerRows,
    timelineRows,
    composerRows,
  });

  useEffect(() => {
    const previous = previousMeasurements.current;
    const changed: string[] = [];
    if (!previous) {
      changed.push("mount");
    } else {
      if (previous.headerRows !== headerRows) changed.push("headerRows");
      if (previous.timelineRows !== timelineRows) changed.push("availableTimelineRows");
      if (previous.composerRows !== composerRows) changed.push("composerRows");
      if (previous.shellHeight !== shellHeight) changed.push("height");
    }

    if (changed.length > 0) {
      renderDebug.traceEvent("layout", "measurementUpdate", {
        reason: changed.join(","),
        headerRows,
        availableTimelineRows: timelineRows,
        composerRows,
        shellHeight,
        showComposer,
        showTimeline,
      });
    }

    previousMeasurements.current = {
      headerRows,
      timelineRows,
      composerRows,
      shellHeight,
    };
  }, [composerRows, headerRows, shellHeight, showComposer, showTimeline, timelineRows]);

  return (
    <Box flexDirection="column" width="100%" height={shellHeight}>
      <Box flexDirection="column" width={shellWidth}>
        {showTimeline && (
          <Box flexDirection="column" borderBottom={true} flexShrink={0}>
            {/* MemoizedTopHeader already has its own comparator — stable during streaming. */}
            <MemoizedTopHeader authState={authState} workspaceLabel={workspaceLabel} layout={layout} runtimeSummary={runtimeSummary} />
          </Box>
        )}

        {showTimeline && (
          <Box flexDirection="column" height={timelineRows} overflow="hidden">
            <Timeline
              staticEvents={staticEvents}
              activeEvents={activeEvents}
              layout={layout}
              uiState={uiState}
              viewportRows={timelineRows}
              verboseMode={verboseMode}
            />
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
    || (prev.panel === next.panel && prev.panelHint === next.panelHint);

  return (
    prev.layout.cols     === next.layout.cols     &&
    prev.layout.rows     === next.layout.rows     &&
    prev.layout.mode     === next.layout.mode     &&
    prev.layout.layoutEpoch === next.layout.layoutEpoch &&
    prev.screen          === next.screen          &&
    prev.authState       === next.authState       &&
    prev.workspaceLabel  === next.workspaceLabel  &&
    prev.runtimeSummary  === next.runtimeSummary  &&
    prev.staticEvents    === next.staticEvents    &&
    prev.activeEvents    === next.activeEvents    &&
    prev.uiState         === next.uiState         &&
    prev.composerRows    === next.composerRows    &&
    prev.composer        === next.composer        &&
    prev.verboseMode     === next.verboseMode     &&
    panelPropsEqual
  );
});
