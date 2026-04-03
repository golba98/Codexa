import React from "react";
import { Box, Text } from "ink";
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
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
];

/** Truncate a path to fit within maxWidth, replacing the middle with "…" */
function truncatePath(path: string, maxWidth: number): string {
  // Use double backslashes for visual consistency with reference image
  const displayPath = path.replace(/\\/g, "\\\\");
  if (maxWidth <= 3 || displayPath.length <= maxWidth) return displayPath;
  const half = Math.floor((maxWidth - 1) / 2);
  return displayPath.slice(0, half) + "…" + displayPath.slice(displayPath.length - (maxWidth - half - 1));
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
        <Text color={theme.TEXT} bold>{`Codexa v11.0`}</Text>
        <Text color={theme.MUTED}>{`Auth: ${authLabel}`}</Text>
      </Box>
    );
  }

  // ── COMPACT (60–109 cols): stacked metadata without full wordmark ─────────
  if (mode === "compact") {
    const wsDisplay = truncatePath(workspaceRoot, Math.max(18, cols - 14));

    return (
      <Box flexDirection="column" paddingX={1} width="100%">
        <Text color={theme.TEXT} bold>{`Codexa v11.0`}</Text>
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
        <Box width={wordmarkWidth} flexShrink={0} overflow="hidden">
          {WORDMARK.map((line, index) => (
            <Text key={`${index}-${line}`} color={theme.TEXT} bold>{line}</Text>
          ))}
        </Box>

        <Box flexDirection="column" marginLeft={gap} marginTop={1} width={metaWidth}>
          <Text color={theme.TEXT} bold>{`Codexa v11.0`}</Text>
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
