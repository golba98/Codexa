import React, { memo } from "react";
import { Box, Text } from "ink";
import { APP_VERSION } from "../config/settings.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { getAuthStateLabel } from "../core/auth/codexAuth.js";
import { useTheme } from "./theme.js";
import type { Layout } from "./layout.js";

interface TopHeaderProps {
  authState: CodexAuthState;
  workspaceRoot: string;
  layout: Layout;
}

const WORDMARK = [
  " ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗ █████╗ ",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝██╔══██╗",
  "██║     ██║   ██║██║  ██║█████╗   ╚███╔╝ ███████║",
  "██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗ ██╔══██║",
  "╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗██║  ██║",
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═╝  ╚═╝",
];

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

  // ── MICRO (<60 cols): one-row metadata strip ───────────────────────────────
  if (mode === "micro") {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={0} width="100%">
        <Text color={theme.TEXT} bold>{`Codexa v${APP_VERSION}`}</Text>
        <Text color={theme.MUTED}>{`Auth: ${authLabel}`}</Text>
      </Box>
    );
  }

  // ── COMPACT (60–109 cols): stacked metadata without full wordmark ─────────
  if (mode === "compact") {
    const wsDisplay = truncatePath(workspaceRoot, Math.max(18, cols - 14));

    return (
      <Box flexDirection="column" paddingX={1} width="100%">
        <Text color={theme.TEXT} bold>{`Codexa v${APP_VERSION}`}</Text>
        <Box flexDirection="row">
          <Text color={theme.MUTED}>Auth: </Text>
          <Text color={theme.TEXT} bold>{authLabel}</Text>
        </Box>
        <Box flexDirection="row">
          <Text color={theme.MUTED}>Workspace: </Text>
          <Text color={theme.MUTED}>{wsDisplay}</Text>
        </Box>
      </Box>
    );
  }

  // ── FULL (≥110 cols): hero with large wordmark ────────────────────────────
  const wordmarkWidth = 56;
  const gap = 3;
  const metaWidth = Math.max(30, cols - wordmarkWidth - gap - 4);
  const fullWorkspaceDisplay = truncatePath(workspaceRoot, Math.max(16, metaWidth - 11));

  return (
    <Box flexDirection="column" width="100%" paddingX={1} marginBottom={1}>
      <Box flexDirection="row" paddingY={0} alignItems="flex-start" width="100%">
        <Box flexDirection="column" width={wordmarkWidth} flexShrink={0} overflow="hidden">
          {WORDMARK.map((line, index) => (
            <Box key={`${index}-box`} overflow="hidden">
              <Text color={theme.TEXT} bold wrap="truncate">{line}</Text>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column" marginLeft={gap} marginTop={1} width={metaWidth}>
          <Text color={theme.TEXT} bold>{`Codexa v${APP_VERSION}`}</Text>
          <Box flexDirection="row">
            <Text color={theme.MUTED}>Auth: </Text>
            <Text color={theme.TEXT} bold>{authLabel}</Text>
          </Box>
          <Box flexDirection="row" overflow="hidden">
            <Text color={theme.MUTED}>Workspace: </Text>
            <Text color={theme.MUTED} wrap="truncate">{fullWorkspaceDisplay}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

// Memoize to prevent re-renders during streaming when props haven't changed
export const MemoizedTopHeader = memo(TopHeader, (prev, next) => {
  return (
    prev.authState === next.authState &&
    prev.workspaceRoot === next.workspaceRoot &&
    prev.layout.cols === next.layout.cols &&
    prev.layout.mode === next.layout.mode
  );
});
