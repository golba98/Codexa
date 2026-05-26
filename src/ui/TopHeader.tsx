import React, { memo } from "react";
import { Box, Text } from "ink";
import { APP_VERSION, HEADER_CONFIG_DEFAULTS, type HeaderConfig } from "../config/settings.js";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { getAuthStateLabel } from "../core/auth/codexAuth.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import { useTheme } from "./theme.js";
import { clampVisualText, type Layout } from "./layout.js";
import { getTextWidth } from "./textLayout.js";

export const HEADER_WORDMARK_LINES = [
  " ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗ █████╗ ",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝██╔══██╗",
  "██║     ██║   ██║██║  ██║█████╗   ╚███╔╝ ███████║",
  "██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗ ██╔══██║",
  "╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗██║  ██║",
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
];

const HEADER_PADDING_COLUMNS = 2;
const SHELL_GUTTER_COLUMNS = 1;
const WIDE_HEADER_MIN_COLUMNS = 120;
const MEDIUM_HEADER_MIN_COLUMNS = 80;
const MIN_SIDE_BY_SIDE_METADATA_WIDTH = 18;
const STACKED_METADATA_GAP_ROWS = 1;
const MIN_LOGO_TERMINAL_WIDTH = getWordmarkWidth() + 2;
const MIN_LOGO_TERMINAL_ROWS = 24;

export type HeaderHeroMode = "wide" | "medium" | "narrow" | "compact";

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

function getHeaderContentWidth(cols: number): number {
  return Math.max(1, cols - SHELL_GUTTER_COLUMNS - HEADER_PADDING_COLUMNS);
}

function getMetadataRowCount(headerConfig: HeaderConfig): number {
  return [
    headerConfig.showBrand,
    headerConfig.showAuthStatus,
    headerConfig.showWorkspace,
    headerConfig.showProvider,
    headerConfig.showContext,
  ].filter(Boolean).length;
}

function getHeaderVerticalMargins(layout: Layout): { topMarginRows: number; bottomMarginRows: number } {
  if (layout.mode !== "full") {
    return {
      topMarginRows: 0,
      bottomMarginRows: 0,
    };
  }

  if (layout.rows <= 24) {
    return { topMarginRows: 0, bottomMarginRows: 0 };
  }

  return {
    topMarginRows: 1,
    bottomMarginRows: 0,
  };
}

export function getHeaderHeroLayout(
  layout: Layout,
  headerConfig: HeaderConfig = HEADER_CONFIG_DEFAULTS,
): HeaderHeroLayout {
  const { topMarginRows, bottomMarginRows } = getHeaderVerticalMargins(layout);
  const metadataRows = getMetadataRowCount(headerConfig);
  const contentWidth = getHeaderContentWidth(layout.cols);
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
  const metadataGapColumns = layout.cols >= WIDE_HEADER_MIN_COLUMNS ? 4 : 2;
  const metadataColumnWidth = contentWidth - getWordmarkWidth() - metadataGapColumns;
  const canUseSideBySide = metadataRows === 0
    || metadataColumnWidth >= MIN_SIDE_BY_SIDE_METADATA_WIDTH;
  const mode: HeaderHeroMode = canUseSideBySide && layout.cols >= WIDE_HEADER_MIN_COLUMNS
    ? "wide"
    : canUseSideBySide && layout.cols >= MEDIUM_HEADER_MIN_COLUMNS
      ? "medium"
      : "narrow";
  const metadataGapRows = mode === "narrow" && metadataRows > 0 ? STACKED_METADATA_GAP_ROWS : 0;
  const contentRows = mode === "wide" || mode === "medium"
    ? logoRows
    : logoRows + metadataGapRows + metadataRows;

  return {
    mode,
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

function takeVisualSuffix(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  let output = "";

  for (const char of Array.from(text).reverse()) {
    if (getTextWidth(char + output) > maxWidth) break;
    output = char + output;
  }

  return output;
}

export function shortenHeaderWorkspaceLabel(workspaceLabel: string, maxWidth: number): string {
  const trimmed = workspaceLabel.trim();
  if (!trimmed || maxWidth <= 0) return "";
  if (getTextWidth(trimmed) <= maxWidth) return trimmed;
  if (maxWidth <= 1) return "…";

  const normalized = trimmed.replace(/[\\/]+$/, "");
  const separatorMatch = normalized.match(/[\\/]/g);
  const separator = normalized.includes("\\") && (!separatorMatch || normalized.lastIndexOf("\\") >= normalized.lastIndexOf("/"))
    ? "\\"
    : "/";
  const lastSlash = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  const leaf = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const prefix = lastSlash >= 0 ? `…${separator}` : "…";
  const leafWidth = Math.max(1, maxWidth - getTextWidth(prefix));

  return prefix + takeVisualSuffix(leaf, leafWidth);
}

function clampMetadataText(text: string, maxWidth: number): string {
  return clampVisualText(text, Math.max(1, maxWidth));
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

  const theme = useTheme();

  const authLabelRaw = getAuthStateLabel(authState);
  const authLabel = authLabelRaw.length > 0
    ? authLabelRaw[0]!.toUpperCase() + authLabelRaw.slice(1)
    : authLabelRaw;

  const heroLayout = getHeaderHeroLayout(layout, headerConfig);
  const contentWidth = getHeaderContentWidth(layout.cols);
  const sideBySideMetadataWidth = Math.max(1, contentWidth - getWordmarkWidth() - heroLayout.metadataGapColumns);
  const metadataWidth = heroLayout.mode === "wide" || heroLayout.mode === "medium"
    ? sideBySideMetadataWidth
    : contentWidth;
  const workspaceValueWidth = Math.max(1, metadataWidth - getTextWidth("Workspace: "));
  const wsDisplay = shortenHeaderWorkspaceLabel(workspaceLabel, workspaceValueWidth);
  const metadataLinesRaw = [
    headerConfig.showBrand ? { key: "brand", text: `Codexa v${APP_VERSION}`, color: theme.TEXT, bold: true } : null,
    headerConfig.showAuthStatus ? { key: "auth", text: `Auth: ${authLabel}`, color: theme.TEXT, bold: false } : null,
    headerConfig.showWorkspace ? { key: "workspace", text: `Workspace: ${wsDisplay}`, color: theme.MUTED, bold: false } : null,
    headerConfig.showProvider && runtimeSummary?.providerLabel
      ? { key: "provider", text: `Provider: ${runtimeSummary.providerLabel}`, color: theme.TEXT, bold: false }
      : null,
    headerConfig.showContext
      ? { key: "context", text: `Context: ${runtimeSummary?.contextLabel ?? "Unknown"}`, color: theme.MUTED, bold: false }
      : null,
  ].filter((line): line is HeaderMetadataLine => Boolean(line));
  const metadataLines = metadataLinesRaw.map((line) => ({
    ...line,
    text: clampMetadataText(line.text, metadataWidth),
  }));

  // Add a 1-row gap between the version line and workspace line in wide mode
  // so the two pieces of metadata have breathing room beside the logo.
  const hasMetadataGap = heroLayout.mode === "wide"
    && metadataLines.length <= 3
    && metadataLines.some((l) => l.key === "brand")
    && metadataLines.some((l) => l.key === "workspace");
  const metadataVisualRows = metadataLines.length + (hasMetadataGap ? 1 : 0);

  const metadataColumn = (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} width={metadataWidth}>
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
    const isSideBySide = heroLayout.mode === "wide" || heroLayout.mode === "medium";

    return (
      <Box flexDirection="column" paddingX={1} width="100%">
        {heroLayout.topMarginRows > 0 && (
          <Box height={heroLayout.topMarginRows} />
        )}

        {isSideBySide ? (
          <Box flexDirection="row" width="100%" alignItems="flex-start">
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

  // Compact / micro / activity-collapsed: single-line header.
  const compactMetadataWidth = contentWidth;
  const compactWorkspaceValueWidth = Math.max(1, compactMetadataWidth - getTextWidth("Workspace: "));
  const compactWorkspaceDisplay = shortenHeaderWorkspaceLabel(workspaceLabel, compactWorkspaceValueWidth);
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
    compactParts.push(<Text key="ws" color={theme.MUTED} wrap="truncate">{`Workspace: ${compactWorkspaceDisplay}`}</Text>);
  }
  if (headerConfig.showProvider && runtimeSummary?.providerLabel) {
    if (compactParts.length > 0) compactParts.push(<Text key="sep-provider" color={theme.DIM}>{"  ·  "}</Text>);
    compactParts.push(<Text key="provider" color={theme.TEXT} wrap="truncate">{`Provider: ${runtimeSummary.providerLabel}`}</Text>);
  }
  if (headerConfig.showContext) {
    if (compactParts.length > 0) compactParts.push(<Text key="sep-context" color={theme.DIM}>{"  ·  "}</Text>);
    compactParts.push(<Text key="context" color={theme.MUTED} wrap="truncate">{`Context: ${runtimeSummary?.contextLabel ?? "Unknown"}`}</Text>);
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
