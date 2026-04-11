// ─── StatusBar ────────────────────────────────────────────────────────────────
// Persistent two-row bar rendered at the top of every screen.
// Replaces the old TopHeader's role of showing context metadata.
//
// Row 1: ◆ CODEXA v0.9.1  ●  <auth>  ⬡  <model> · <mode>
// Row 2: ⌂  <workspace>   ⬡  Tokens: ████░░░  42%
//
// The component is split so token/model info can re-render independently
// of workspace/auth info — both are memoized.
//
// PERF: Wrapped in React.memo with an explicit prop comparator so this
// component does NOT re-render during streaming (which updates activeEvents
// and causes App → AppShell to re-render on every streaming chunk).
// Only props that visibly affect status-bar output are compared.

import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import { APP_VERSION, formatModeLabel } from "../config/settings.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { getAuthStateLabel } from "../core/auth/codexAuth.js";
import type { ModelSpec } from "../core/modelSpecs.js";
import { useTheme } from "./theme.js";
import type { Layout } from "./layout.js";
import { getModeColor } from "./modeColor.js";

interface StatusBarProps {
  authState: CodexAuthState;
  workspaceRoot: string;
  layout: Layout;
  model: string;
  mode: string;
  tokensUsed: number;
  modelSpec: ModelSpec;
}

/** Truncate a path from the middle: ~/projects/my-app/src/…/deep */
function truncatePath(path: string, maxWidth: number): string {
  if (maxWidth <= 3 || path.length <= maxWidth) return path;
  const half = Math.floor((maxWidth - 1) / 2);
  return path.slice(0, half) + "…" + path.slice(path.length - (maxWidth - half - 1));
}

function tokenBarString(tokensUsed: number, modelSpec: ModelSpec): {
  filled: string;
  empty: string;
  pct: number | null;
} {
  const TOTAL_BLOCKS = 10;
  if (modelSpec.status !== "verified" || modelSpec.contextWindow <= 0) {
    return { filled: "", empty: "░".repeat(TOTAL_BLOCKS), pct: null };
  }
  const pct = Math.min(100, Math.round((tokensUsed / modelSpec.contextWindow) * 100));
  const filledCount = Math.round((pct / 100) * TOTAL_BLOCKS);
  return {
    filled: "█".repeat(filledCount),
    empty: "░".repeat(TOTAL_BLOCKS - filledCount),
    pct,
  };
}

function formatApprox(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function StatusBarInner({
  authState,
  workspaceRoot,
  layout,
  model,
  mode,
  tokensUsed,
  modelSpec,
}: StatusBarProps) {
  const theme = useTheme();
  const { cols, mode: layoutMode } = layout;

  const authLabel = getAuthStateLabel(authState);
  const authColor =
    authState === "authenticated"   ? theme.SUCCESS
    : authState === "unauthenticated" ? theme.ERROR
    : theme.WARNING;
  const authIcon =
    authState === "authenticated"   ? "●"
    : authState === "unauthenticated" ? "✗"
    : "~";

  const modeColor = getModeColor(mode, theme);
  const modeLabel = layoutMode === "micro"
    ? (mode === "suggest" ? "S" : mode === "auto-edit" ? "E" : "A")
    : formatModeLabel(mode);

  // Memoize expensive token-bar computation — only recompute when usage or spec changes.
  const tokenBar = useMemo(
    () => tokenBarString(tokensUsed, modelSpec),
    [tokensUsed, modelSpec],
  );

  // Derive token color from pct — stable unless pct or theme colors change.
  const tokenColor = useMemo(
    () => (
      tokenBar.pct === null ? theme.DIM
      : tokenBar.pct >= 90  ? theme.ERROR
      : tokenBar.pct >= 70  ? theme.WARNING
      : theme.SUCCESS
    ),
    [tokenBar.pct, theme.DIM, theme.ERROR, theme.WARNING, theme.SUCCESS],
  );

  // ── MICRO (<60 cols) ──────────────────────────────────────────────────────
  if (layoutMode === "micro") {
    return (
      <Box
        borderStyle="double"
        borderColor={theme.BORDER_SUBTLE}
        paddingX={1}
        width="100%"
        flexDirection="row"
        justifyContent="space-between"
      >
        <Box>
          <Text color={theme.ACCENT} bold>{"✦ "}</Text>
          <Text color={theme.TEXT} bold>{"Codexa "}</Text>
          <Text color={theme.DIM}>{`v${APP_VERSION}`}</Text>
        </Box>
        <Box>
          <Text color={authColor} bold>{authIcon}</Text>
          <Text color={theme.DIM}>{" · "}</Text>
          <Text color={modeColor} bold>{modeLabel}</Text>
        </Box>
      </Box>
    );
  }

  // ── COMPACT + FULL ────────────────────────────────────────────────────────
  // Inner usable width: cols - 2 (border) - 2 (paddingX)
  const innerW = Math.max(30, cols - 4);
  // Row 1: "◆ CODEXA v0.9.1  ●  <auth>  ⬡  <model> · <mode>"
  const modelModeStr = `${model} · ${modeLabel}`;
  // Row 2: "⌂  <workspace>  ⬡  Tokens: ████░  42%"
  const tokenSuffix = tokenBar.pct !== null
    ? `  ${formatApprox(tokensUsed)}  ${tokenBar.pct}%`
    : `  ${formatApprox(tokensUsed)}`;
  // Memoize the path truncation — expensive for long paths and stable for most renders.
  const wsMaxWidth = Math.max(8, innerW - 16 - tokenSuffix.length - modelModeStr.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wsDisplay = useMemo(
    () => truncatePath(workspaceRoot, wsMaxWidth),
    // wsMaxWidth depends on cols/model/mode/tokensUsed — recalculate only when it changes.
    [workspaceRoot, wsMaxWidth],
  );

  return (
    <Box
      borderStyle="double"
      borderColor={theme.BORDER_SUBTLE}
      paddingX={1}
      width="100%"
      flexDirection="column"
    >
      {/* Row 1: identity + auth + model/mode */}
      <Box flexDirection="row" justifyContent="space-between">
        <Box>
          <Text color={theme.ACCENT} bold>{"✦ "}</Text>
          <Text color={theme.TEXT} bold>{"Codexa "}</Text>
          <Text color={theme.DIM}>{`v${APP_VERSION}`}</Text>
          <Text color={theme.BORDER_SUBTLE}>{" ║ "}</Text>
          <Text color={authColor} bold>{authIcon}</Text>
          <Text color={authColor}>{" "}{authLabel}</Text>
        </Box>
        <Box>
          <Text color={theme.DIM}>{"⬡ "}</Text>
          <Text color={theme.MUTED} bold>{model}</Text>
          <Text color={theme.DIM}>{" · "}</Text>
          <Text color={modeColor} bold>{modeLabel}</Text>
        </Box>
      </Box>

      {/* Row 2: workspace + token bar */}
      <Box flexDirection="row" justifyContent="space-between">
        <Box>
          <Text color={theme.DIM}>{"⌂ "}</Text>
          <Text color={theme.INFO}>{wsDisplay}</Text>
        </Box>
        <Box>
          <Text color={theme.DIM}>{"Tokens: "}</Text>
          <Text color={tokenColor} bold>{tokenBar.filled}</Text>
          <Text color={theme.DIM}>{tokenBar.empty}</Text>
          {tokenBar.pct !== null && (
            <>
              <Text color={theme.DIM}>{" "}</Text>
              <Text color={tokenColor} bold>{tokenBar.pct}%</Text>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Memoized StatusBar — gates re-renders on the exact subset of props
 * that affect what the bar displays.  Streaming updates (activeEvents,
 * uiState, cursor) flow through App → AppShell but do NOT reach
 * StatusBar unless authState / workspaceRoot / layout / model / mode /
 * tokensUsed / modelSpec actually change.
 */
export const StatusBar = memo(StatusBarInner, (prev, next) => {
  return (
    prev.authState       === next.authState       &&
    prev.workspaceRoot   === next.workspaceRoot   &&
    prev.layout.cols     === next.layout.cols     &&
    prev.layout.rows     === next.layout.rows     &&
    prev.layout.mode     === next.layout.mode     &&
    prev.model           === next.model           &&
    prev.mode            === next.mode            &&
    prev.tokensUsed      === next.tokensUsed      &&
    prev.modelSpec       === next.modelSpec
  );
});
