import React from "react";
import { Box, Text } from "ink";
import { APP_VERSION } from "../config/settings.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { getAuthStateLabel } from "../core/auth/codexAuth.js";
import { useTheme } from "./theme.js";
import { CodexLogo } from "./CodexLogo.js";
import type { Layout } from "./layout.js";

interface TopHeaderProps {
  authState: CodexAuthState;
  workspaceRoot: string;
  layout: Layout;
}

const FULL_LOGO_WIDTH = 50;
const HORIZONTAL_FRAME_PADDING = 4; // round border + paddingX on both sides
const FULL_ROW_GAP = 3;

/** Truncate a path to fit within maxWidth, replacing the middle with "…" */
function truncatePath(path: string, maxWidth: number): string {
  if (maxWidth <= 3 || path.length <= maxWidth) return path;
  const half = Math.floor((maxWidth - 1) / 2);
  return path.slice(0, half) + "…" + path.slice(path.length - (maxWidth - half - 1));
}

export function TopHeader({ authState, workspaceRoot, layout }: TopHeaderProps) {
  const { cols, mode } = layout;
  const theme = useTheme();

  const authLabel = getAuthStateLabel(authState);
  const authColor =
    authState === "authenticated"
      ? theme.SUCCESS
      : authState === "unauthenticated"
        ? theme.ERROR
        : theme.WARNING;

  const authIcon =
    authState === "authenticated"   ? "✓"
    : authState === "unauthenticated" ? "✗"
    : "~";

  // ── MICRO (<60 cols): single-line, no border, no logo ─────────────────────
  if (mode === "micro") {
    return (
      <Box paddingX={1} paddingY={0}>
        <Text color={theme.ACCENT} bold>{"✦ "}</Text>
        <Text color={theme.TEXT}   bold>{"Codexa "}</Text>
        <Text color={theme.DIM}>{`v${APP_VERSION}  `}</Text>
        <Text color={authColor} bold>{authIcon}</Text>
        <Text color={theme.DIM}>{` ${authLabel}`}</Text>
      </Box>
    );
  }

  // ── COMPACT (60–109 cols): mini logo + stacked info, bordered ─────────────
  if (mode === "compact") {
    // Available width inside border (2 chars) minus paddingX (2×1) = cols - 4
    const innerWidth = Math.max(20, cols - 4);
    const wsDisplay = truncatePath(workspaceRoot, innerWidth - 12); // "Workspace: " is 11 chars

    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.BORDER_SUBTLE}
        width="100%"
        paddingX={1}
        paddingY={0}
      >
        {/* Row 1: mini logo + version */}
        <Box flexDirection="row" justifyContent="space-between">
          <CodexLogo layout="compact" />
          <Text color={theme.DIM}>{`v${APP_VERSION}`}</Text>
        </Box>

        {/* Row 2: auth */}
        <Box marginTop={0}>
          <Text color={theme.MUTED} bold>{"Auth: "}</Text>
          <Text color={authColor} bold>{authIcon}</Text>
          <Text color={authColor}>{` ${authLabel}`}</Text>
        </Box>

        {/* Row 3: workspace — only if there's room */}
        {wsDisplay.length > 0 && (
          <Box>
            <Text color={theme.MUTED} bold>{"WS: "}</Text>
            <Text color={theme.INFO}>{wsDisplay}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // ── FULL (≥110 cols): big banner, side-by-side info ───────────────────────
  const innerWidth = Math.max(60, cols - HORIZONTAL_FRAME_PADDING);
  const metaWidth = Math.max(24, innerWidth - FULL_LOGO_WIDTH - FULL_ROW_GAP);
  const fullWorkspaceDisplay = truncatePath(workspaceRoot, Math.max(12, metaWidth - 11));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.BORDER_SUBTLE} width="100%">
      <Box flexDirection="row" paddingX={2} paddingY={1} alignItems="flex-start">
        <Box width={FULL_LOGO_WIDTH} flexShrink={0}>
          <CodexLogo layout="full" />
        </Box>

        <Box flexDirection="column" marginLeft={FULL_ROW_GAP} marginTop={1} width={metaWidth}>
          <Text color={theme.TEXT} bold>
            Codexa <Text color={theme.INFO}>{`v${APP_VERSION}`}</Text>
          </Text>

          <Box marginTop={1}>
            <Text color={theme.MUTED} bold>{"Auth: "}</Text>
            <Text color={authColor}>{authLabel}</Text>
          </Box>

          <Box marginTop={1}>
            <Text color={theme.MUTED} bold>{"Workspace: "}</Text>
            <Text color={theme.INFO}>{fullWorkspaceDisplay}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
