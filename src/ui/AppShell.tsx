import React from "react";
import { Box } from "ink";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import type { Screen, TimelineEvent, UIState } from "../session/types.js";
import { isBusy } from "../session/types.js";
import { getShellHeight, getShellWidth, type Layout } from "./layout.js";
import { Timeline } from "./Timeline.js";
import { MemoizedTopHeader } from "./TopHeader.js";

export interface AppShellProps {
  layout: Layout;
  screen: Screen;
  authState: CodexAuthState;
  workspaceRoot: string;
  events: TimelineEvent[];
  uiState: UIState;
  panel: React.ReactNode;
  composer: React.ReactNode;
  runFooter: React.ReactNode;
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
  events,
  uiState,
  panel,
  composer,
  runFooter,
  panelHint,
}: AppShellProps) {
  const crampedViewport = isCrampedViewport(layout.rows);
  const shellWidth = getShellWidth(layout.cols);
  const shellHeight = crampedViewport ? layout.rows : getShellHeight(layout.rows);
  const showComposer = screen === "main";
  const showRunFooter = showComposer && crampedViewport && isBusy(uiState);

  return (
    <Box flexDirection="column" width="100%" height={shellHeight}>
      <Box flexDirection="column" width={shellWidth}>
        {screen === "main" && (
          <Box flexDirection="column" borderBottom={true} flexShrink={0}>
            <MemoizedTopHeader
              authState={authState}
              workspaceRoot={workspaceRoot}
              layout={layout}
            />
          </Box>
        )}

        <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingBottom={crampedViewport ? 0 : 1}>
          <Timeline events={events} layout={layout} uiState={uiState} />
        </Box>

        {panel}

        {showComposer && (
          <Box flexDirection="column" flexShrink={0}>
            {showRunFooter ? runFooter : composer}
          </Box>
        )}

        {screen !== "main" && panelHint}
      </Box>
    </Box>
  );
}
