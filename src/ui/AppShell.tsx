import React from "react";
import { Box } from "ink";
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
  staticEvents: TimelineEvent[];
  activeEvents: TimelineEvent[];
  uiState: UIState;
  panel: React.ReactNode;
  composer: React.ReactNode;
  composerRows: number;
  panelHint?: React.ReactNode;
}

export function isCrampedViewport(rows: number | undefined): boolean {
  return (rows ?? 24) <= 24;
}

export function AppShell({
  layout,
  screen,
  authState,
  workspaceRoot,
  staticEvents,
  activeEvents,
  uiState,
  panel,
  composer,
  composerRows,
  panelHint,
}: AppShellProps) {
  const shellWidth = getShellWidth(layout.cols);
  const shellHeight = getShellHeight(layout.rows);
  const showComposer = screen === "main";
  const showTimeline = screen === "main";
  const showPanelStage = screen !== "main";
  const headerRows = showTimeline ? measureTopHeaderRows(layout) + 1 : 0;
  const timelineRows = Math.max(1, shellHeight - headerRows - (showComposer ? composerRows : 0));

  return (
    <Box flexDirection="column" width="100%" height={shellHeight}>
      <Box flexDirection="column" width={shellWidth}>
        {showTimeline && (
          <Box flexDirection="column" borderBottom={true} flexShrink={0}>
            <MemoizedTopHeader authState={authState} workspaceRoot={workspaceRoot} layout={layout} />
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
