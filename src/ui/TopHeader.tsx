import React, { memo } from "react";
import { Box, Text } from "ink";
import { APP_VERSION } from "../config/settings.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { getAuthStateLabel } from "../core/auth/codexAuth.js";
import { useTheme } from "./theme.js";
import type { Layout } from "./layout.js";

const WORDMARK = [
  " ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗  █████╗ ",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝ ██╔══██╗",
  "██║     ██║   ██║██║  ██║█████╗   ╚███╔╝  ███████║",
  "██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗  ██╔══██║",
  "╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗ ██║  ██║",
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═╝  ╚═╝",
];


interface TopHeaderProps {
  authState: CodexAuthState;
  workspaceRoot: string;
  layout: Layout;
}

export function measureTopHeaderRows(layout: Layout): number {
  return layout.mode === "full" ? WORDMARK.length : 1;
}

/** Truncate a path to fit within maxWidth, keeping the end and prefixing with "... " if needed */
function truncatePath(path: string, maxWidth: number): string {
  if (maxWidth <= 4 || path.length <= maxWidth) return path;
  // Prefix with "... " (4 chars) and take the last (maxWidth - 4) chars
  return "... " + path.slice(path.length - (maxWidth - 4));
}

export function TopHeader({ authState, workspaceRoot, layout }: TopHeaderProps) {
  const { cols, mode } = layout;
  const theme = useTheme();

  const authLabelRaw = getAuthStateLabel(authState);
  const authLabel = authLabelRaw.length > 0
    ? authLabelRaw[0]!.toUpperCase() + authLabelRaw.slice(1)
    : authLabelRaw;

  const wsDisplay = truncatePath(workspaceRoot, Math.max(18, cols - 40));

  // Full mode: always render wordmark + metadata side-by-side
  if (mode === "full") {
    return (
      <Box flexDirection="row" paddingX={1} width="100%">
        <Box flexDirection="column" flexShrink={0} marginRight={2}>
          {WORDMARK.map((line, i) => (
            <Text key={i} color={theme.ACCENT} bold>{line}</Text>
          ))}
        </Box>
        <Box flexDirection="column" justifyContent="center" flexGrow={1}>
          <Text color={theme.TEXT} bold>{`Codexa v${APP_VERSION}`}</Text>
          <Text color={theme.TEXT}>{`Auth: ${authLabel}`}</Text>
          <Text color={theme.MUTED} wrap="truncate">{`Workspace: ${wsDisplay}`}</Text>
        </Box>
      </Box>
    );
  }

  // Compact / micro / activity-collapsed: single-line header
  return (
    <Box flexDirection="row" paddingX={1} width="100%">
      <Text color={theme.TEXT} bold>{`Codexa v${APP_VERSION}`}</Text>
      <Text color={theme.DIM}>{"  ·  "}</Text>
      <Text color={theme.TEXT}>{authLabel}</Text>
      <Text color={theme.DIM}>{"  ·  "}</Text>
      <Text color={theme.MUTED} wrap="truncate">{wsDisplay}</Text>
    </Box>
  );
}

// Memoize to prevent re-renders during streaming when props haven't changed
export const MemoizedTopHeader = memo(TopHeader, (prev, next) => {
  return (
    prev.authState === next.authState &&
    prev.workspaceRoot === next.workspaceRoot &&
    prev.layout.cols === next.layout.cols &&
    prev.layout.rows === next.layout.rows &&
    prev.layout.mode === next.layout.mode
  );
});
