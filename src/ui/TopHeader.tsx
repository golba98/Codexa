import React, { memo } from "react";
import { Box, Text } from "ink";
import { APP_VERSION, HEADER_CONFIG_DEFAULTS, type HeaderConfig } from "../config/settings.js";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { getAuthStateLabel } from "../core/auth/codexAuth.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import { useTheme } from "./theme.js";
import type { Layout } from "./layout.js";

const WORDMARK = [
  " ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗ █████╗ ",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝██╔══██╗",
  "██║     ██║   ██║██║  ██║█████╗   ╚███╔╝ ███████║",
  "██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗ ██╔══██║",
  "╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗██║  ██║",
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
];


interface TopHeaderProps {
  authState: CodexAuthState;
  workspaceLabel: string;
  layout: Layout;
  runtimeSummary?: RuntimeSummary | null;
  headerConfig?: HeaderConfig;
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

export function TopHeader({
  authState,
  workspaceLabel,
  layout,
  headerConfig = HEADER_CONFIG_DEFAULTS,
}: TopHeaderProps) {
  renderDebug.useRenderDebug("Header", {
    authState,
    workspaceLabel,
    cols: layout.cols,
    rows: layout.rows,
    mode: layout.mode,
  });
  renderDebug.useLifecycleDebug("Header", {
    authState,
    cols: layout.cols,
    rows: layout.rows,
    mode: layout.mode,
  });

  const { cols, mode } = layout;
  const theme = useTheme();

  const authLabelRaw = getAuthStateLabel(authState);
  const authLabel = authLabelRaw.length > 0
    ? authLabelRaw[0]!.toUpperCase() + authLabelRaw.slice(1)
    : authLabelRaw;

  const wsDisplay = truncatePath(workspaceLabel, Math.max(18, cols - 40));

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
          {headerConfig.showBrand && (
            <Text color={theme.TEXT} bold>{`Codexa v${APP_VERSION}`}</Text>
          )}
          {headerConfig.showAuthStatus && (
            <Text color={theme.TEXT}>{`Auth: ${authLabel}`}</Text>
          )}
          {headerConfig.showWorkspace && (
            <Text color={theme.MUTED} wrap="truncate">{`Workspace: ${wsDisplay}`}</Text>
          )}
        </Box>
      </Box>
    );
  }

  // Compact / micro / activity-collapsed: single-line header
  const compactParts: React.ReactNode[] = [];
  if (headerConfig.showBrand) {
    compactParts.push(
      <Text key="brand" color={theme.TEXT} bold>{`Codexa v${APP_VERSION}`}</Text>,
    );
  }
  if (headerConfig.showAuthStatus) {
    if (compactParts.length > 0) compactParts.push(<Text key="sep-auth" color={theme.DIM}>{"  ·  "}</Text>);
    compactParts.push(<Text key="auth" color={theme.TEXT}>{authLabel}</Text>);
  }
  if (headerConfig.showWorkspace) {
    if (compactParts.length > 0) compactParts.push(<Text key="sep-ws" color={theme.DIM}>{"  ·  "}</Text>);
    compactParts.push(<Text key="ws" color={theme.MUTED} wrap="truncate">{wsDisplay}</Text>);
  }

  return (
    <Box flexDirection="row" paddingX={1} width="100%">
      {compactParts}
    </Box>
  );
}

// Memoize to prevent re-renders during streaming when props haven't changed
export const MemoizedTopHeader = memo(TopHeader, (prev, next) => {
  return (
    prev.authState === next.authState &&
    prev.workspaceLabel === next.workspaceLabel &&
    prev.layout.cols === next.layout.cols &&
    prev.layout.rows === next.layout.rows &&
    prev.layout.mode === next.layout.mode &&
    prev.runtimeSummary === next.runtimeSummary &&
    prev.headerConfig === next.headerConfig
  );
});
