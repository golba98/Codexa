import React, { memo } from "react";
import { Box, Text } from "ink";
import { APP_VERSION, HEADER_CONFIG_DEFAULTS, type HeaderConfig } from "../config/settings.js";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { getAuthStateLabel } from "../core/auth/codexAuth.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import { useTheme } from "./theme.js";
import type { Layout } from "./layout.js";
import { getTextWidth } from "./textLayout.js";

export const HEADER_WORDMARK_LINES = [
  " ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗ █████╗ ",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝██╔══██╗",
  "██║     ██║   ██║██║  ██║█████╗   ╚███╔╝ ███████║",
  "██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗ ██╔══██║",
  "╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗██║  ██║",
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
];

const MIN_METADATA_COLUMN_WIDTH = 60;
const STACKED_METADATA_GAP_ROWS = 1;
const MIN_LOGO_TERMINAL_WIDTH = getWordmarkWidth() + 2;
const MIN_LOGO_TERMINAL_ROWS = 24;

export type HeaderHeroMode = "wide" | "stacked" | "compact";

export interface HeaderHeroLayout {
  mode: HeaderHeroMode;
  topMarginRows: number;
  bottomMarginRows: number;
  metadataGapColumns: number;
  metadataGapRows: number;
  logoRows: number;
  metadataRows: number;
  totalRows: number;
}

type HeaderMetadataLine = { key: string; text: string; color: string; bold: boolean };

interface TopHeaderProps {
  authState: CodexAuthState;
  workspaceLabel: string;
  layout: Layout;
  runtimeSummary?: RuntimeSummary | null;
  headerConfig?: HeaderConfig;
}

function getWordmarkWidth(): number {
  return HEADER_WORDMARK_LINES.reduce((maxWidth, line) => Math.max(maxWidth, getTextWidth(line)), 0);
}

function getMetadataRowCount(headerConfig: HeaderConfig): number {
  return [
    headerConfig.showBrand,
    headerConfig.showAuthStatus,
    headerConfig.showWorkspace,
    headerConfig.showProvider,
    headerConfig.showModel,
    headerConfig.showReasoning,
    headerConfig.showContext,
  ].filter(Boolean).length;
}

function getHeaderVerticalMargins(layout: Layout): { topMarginRows: number; bottomMarginRows: number } {
  if (layout.mode !== "full") {
    return {
      topMarginRows: 0,
      bottomMarginRows: layout.rows > 24 ? 1 : 0,
    };
  }

  if (layout.rows <= 24) {
    return { topMarginRows: 0, bottomMarginRows: 1 };
  }

  return {
    topMarginRows: 1,
    bottomMarginRows: layout.rows >= 36 ? 2 : 1,
  };
}

export function getHeaderHeroLayout(
  layout: Layout,
  headerConfig: HeaderConfig = HEADER_CONFIG_DEFAULTS,
): HeaderHeroLayout {
  const { topMarginRows, bottomMarginRows } = getHeaderVerticalMargins(layout);
  const metadataRows = getMetadataRowCount(headerConfig);
  const canRenderLogo = layout.cols >= MIN_LOGO_TERMINAL_WIDTH && layout.rows >= MIN_LOGO_TERMINAL_ROWS;

  if (!canRenderLogo) {
    return {
      mode: "compact",
      topMarginRows,
      bottomMarginRows,
      metadataGapColumns: 0,
      metadataGapRows: 0,
      logoRows: 1,
      metadataRows: 0,
      totalRows: topMarginRows + 1 + bottomMarginRows,
    };
  }

  const logoRows = HEADER_WORDMARK_LINES.length;
  const metadataGapColumns = layout.cols >= 150 ? 6 : layout.cols >= 130 ? 5 : 4;
  const canUseWideHero = layout.cols >= getWordmarkWidth() + metadataGapColumns + MIN_METADATA_COLUMN_WIDTH + 2;
  const metadataGapRows = canUseWideHero || metadataRows === 0 ? 0 : STACKED_METADATA_GAP_ROWS;
  const contentRows = canUseWideHero
    ? logoRows
    : logoRows + metadataGapRows + metadataRows;

  return {
    mode: canUseWideHero ? "wide" : "stacked",
    topMarginRows,
    bottomMarginRows,
    metadataGapColumns,
    metadataGapRows,
    logoRows,
    metadataRows,
    totalRows: topMarginRows + contentRows + bottomMarginRows,
  };
}

export function measureTopHeaderRows(
  layout: Layout,
  headerConfig: HeaderConfig = HEADER_CONFIG_DEFAULTS,
): number {
  return getHeaderHeroLayout(layout, headerConfig).totalRows;
}

/** Truncate a path to fit within maxWidth, keeping the end and prefixing with "... " if needed */
function truncatePath(path: string, maxWidth: number): string {
  if (maxWidth <= 4 || path.length <= maxWidth) return path;
  // Prefix with "... " (4 chars) and take the last (maxWidth - 4) chars
  return "... " + path.slice(path.length - (maxWidth - 4));
}

function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 1) return "";
  if (getTextWidth(text) <= maxWidth) return text;
  return `${text.slice(0, Math.max(0, maxWidth - 1))}…`;
}

export function TopHeader({
  authState,
  workspaceLabel,
  layout,
  runtimeSummary = null,
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

  const { cols } = layout;
  const theme = useTheme();

  const authLabelRaw = getAuthStateLabel(authState);
  const authLabel = authLabelRaw.length > 0
    ? authLabelRaw[0]!.toUpperCase() + authLabelRaw.slice(1)
    : authLabelRaw;

  const wsDisplay = truncatePath(workspaceLabel, Math.max(18, cols - 40));
  const heroLayout = getHeaderHeroLayout(layout, headerConfig);
  const modelLabel = runtimeSummary?.modelLabel ?? runtimeSummary?.model;
  const metadataLines = [
    headerConfig.showBrand ? { key: "brand", text: `Codexa v${APP_VERSION}`, color: theme.TEXT, bold: true } : null,
    headerConfig.showAuthStatus ? { key: "auth", text: `Auth: ${authLabel}`, color: theme.TEXT, bold: false } : null,
    headerConfig.showWorkspace ? { key: "workspace", text: `Workspace: ${wsDisplay}`, color: theme.MUTED, bold: false } : null,
    headerConfig.showProvider && runtimeSummary?.providerLabel
      ? { key: "provider", text: `Provider: ${runtimeSummary.providerLabel}`, color: theme.TEXT, bold: false }
      : null,
    headerConfig.showModel && modelLabel
      ? { key: "model", text: `Model: ${modelLabel}`, color: theme.MUTED, bold: false }
      : null,
    headerConfig.showReasoning && runtimeSummary?.reasoningLabel
      ? { key: "reasoning", text: `Reasoning: ${runtimeSummary.reasoningLabel}`, color: theme.MUTED, bold: false }
      : null,
    headerConfig.showContext && runtimeSummary?.contextLabel
      ? { key: "context", text: `Context: ${runtimeSummary.contextLabel}`, color: theme.MUTED, bold: false }
      : null,
  ].filter((line): line is HeaderMetadataLine => Boolean(line));

  // Add a 1-row gap between the version line and workspace line in wide mode
  // so the two pieces of metadata have breathing room beside the logo.
  const hasMetadataGap = heroLayout.mode === "wide"
    && metadataLines.length <= 3
    && metadataLines.some((l) => l.key === "brand")
    && metadataLines.some((l) => l.key === "workspace");
  const metadataVisualRows = metadataLines.length + (hasMetadataGap ? 1 : 0);

  const metadataColumn = (
    <Box flexDirection="column" flexGrow={1} minWidth={Math.min(MIN_METADATA_COLUMN_WIDTH, Math.max(1, cols - getWordmarkWidth() - heroLayout.metadataGapColumns - 2))}>
      {metadataLines.map((line) =>
        hasMetadataGap && line.key === "workspace" ? (
          <Box key={line.key} marginTop={1}>
            <Text color={line.color} bold={line.bold} wrap="truncate">{line.text}</Text>
          </Box>
        ) : (
          <Text key={line.key} color={line.color} bold={line.bold} wrap="truncate">{line.text}</Text>
        )
      )}
    </Box>
  );

  const logoColumn = (
    <Box flexDirection="column" flexShrink={0}>
      {HEADER_WORDMARK_LINES.map((line, i) => (
        <Text key={i} color={theme.ACCENT} bold>{line}</Text>
      ))}
    </Box>
  );

  if (heroLayout.mode !== "compact") {
    const metadataTopOffset = Math.max(0, Math.floor((HEADER_WORDMARK_LINES.length - metadataVisualRows) / 2));

    return (
      <Box flexDirection="column" paddingX={1} width="100%">
        {heroLayout.topMarginRows > 0 && (
          <Box height={heroLayout.topMarginRows} />
        )}

        {heroLayout.mode === "wide" ? (
          <Box flexDirection="row" width="100%">
            {logoColumn}
            <Box width={heroLayout.metadataGapColumns} flexShrink={0} />
            <Box flexDirection="column" flexGrow={1} paddingTop={metadataTopOffset}>
              {metadataColumn}
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column" width="100%">
            {logoColumn}
            {heroLayout.metadataGapRows > 0 && (
              <Box height={heroLayout.metadataGapRows} />
            )}
            {metadataColumn}
          </Box>
        )}

        {heroLayout.bottomMarginRows > 0 && (
          <Box height={heroLayout.bottomMarginRows} />
        )}
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
  if (headerConfig.showProvider && runtimeSummary?.providerLabel) {
    if (compactParts.length > 0) compactParts.push(<Text key="sep-provider" color={theme.DIM}>{"  ·  "}</Text>);
    compactParts.push(<Text key="provider" color={theme.TEXT} wrap="truncate">{runtimeSummary.providerLabel}</Text>);
  }
  if (headerConfig.showModel && modelLabel) {
    if (compactParts.length > 0) compactParts.push(<Text key="sep-model" color={theme.DIM}>{"  ·  "}</Text>);
    compactParts.push(<Text key="model" color={theme.MUTED} wrap="truncate">{truncateText(modelLabel, Math.max(10, cols - 40))}</Text>);
  }

  return (
    <Box flexDirection="column" paddingX={1} width="100%">
      {heroLayout.topMarginRows > 0 && (
        <Box height={heroLayout.topMarginRows} />
      )}
      <Box flexDirection="row" width="100%">
        {compactParts}
      </Box>
      {heroLayout.bottomMarginRows > 0 && (
        <Box height={heroLayout.bottomMarginRows} />
      )}
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
