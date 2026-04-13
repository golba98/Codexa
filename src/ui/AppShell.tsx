import React, { memo, useMemo } from "react";
import { Box } from "ink";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import type { Screen, TimelineEvent, UIState } from "../session/types.js";
import { getShellHeight, getShellWidth, type Layout } from "./layout.js";
import { Timeline } from "./Timeline.js";
import { measureTopHeaderRows, MemoizedTopHeader } from "./TopHeader.js";

export interface AppShellProps {
  layout: Layout;
  screen: Screen;
  authState: CodexAuthState;
  workspaceRoot: string;
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
  workspaceRoot,
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
  const shellWidth = getShellWidth(layout.cols);
  const shellHeight = getShellHeight(layout.rows);
  const showComposer = screen === "main";
  const showTimeline = screen === "main";
  const showPanelStage = screen !== "main";

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

  return (
    <Box flexDirection="column" width="100%" height={shellHeight}>
      <Box flexDirection="column" width={shellWidth}>
        {showTimeline && (
          <Box flexDirection="column" borderBottom={true} flexShrink={0}>
            {/* MemoizedTopHeader already has its own comparator — stable during streaming. */}
            <MemoizedTopHeader authState={authState} workspaceRoot={workspaceRoot} layout={layout} runtimeSummary={runtimeSummary} />
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
 * ReactNode props (panel, panelHint) are excluded — their visibility is fully
 * determined by `screen`, which IS compared.  `composer` must remain in the
 * comparator because MemoizedBottomComposer receives value/cursor updates
 * through this prop; without it the composer would display stale input.
 */
export const AppShell = memo(AppShellInner, (prev, next) => {
  return (
    prev.layout.cols     === next.layout.cols     &&
    prev.layout.rows     === next.layout.rows     &&
    prev.layout.mode     === next.layout.mode     &&
    prev.screen          === next.screen          &&
    prev.authState       === next.authState       &&
    prev.workspaceRoot   === next.workspaceRoot   &&
    prev.runtimeSummary  === next.runtimeSummary  &&
    prev.staticEvents    === next.staticEvents    &&
    prev.activeEvents    === next.activeEvents    &&
    prev.uiState         === next.uiState         &&
    prev.composerRows    === next.composerRows    &&
    prev.composer        === next.composer        &&
    prev.verboseMode     === next.verboseMode
  );
});
