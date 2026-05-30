import React, { memo } from "react";
import { Box, Text } from "ink";
import { HEADER_CONFIG_DEFAULTS, type HeaderConfig } from "../config/settings.js";
import { formatCodexaBrandLabel } from "../core/channel.js";
import { formatVersionLabel } from "../core/updateCheck.js";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { getAuthStateLabel } from "../core/auth/codexAuth.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import { useTheme } from "./theme.js";
import { clampVisualText, type Layout } from "./layout.js";
import { getTextWidth } from "./textLayout.js";
import { UPDATE_CARD_ROWS, UpdateAvailableCard } from "./UpdateAvailableCard.js";
import {
  LOGO_LARGE,
  LOGO_COMPACT_MIN_COLS,
  LOGO_LARGE_MIN_COLS,
  LOGO_LARGE_MIN_ROWS,
  LOGO_MEDIUM_MIN_COLS,
  selectLogoVariantForViewport,
  getLogoWidth,
} from "./logoVariants.js";

// Re-exported for backward compatibility with existing tests.
export const HEADER_WORDMARK_LINES = LOGO_LARGE;

const HEADER_PADDING_COLUMNS = 2;
const SHELL_GUTTER_COLUMNS = 1;
// Require 130+ cols for wide side-by-side so the UpdateAvailableCard has room.
const WIDE_HEADER_MIN_COLUMNS = 130;
// Require 72+ cols (= LOGO_MEDIUM_MIN_COLS) for medium side-by-side — both
// LOGO_LARGE (≥100) and LOGO_MEDIUM (72–99) fit cleanly in side-by-side layout.
const MEDIUM_HEADER_MIN_COLUMNS = LOGO_MEDIUM_MIN_COLS; // 72
const MIN_SIDE_BY_SIDE_METADATA_WIDTH = 18;
const STACKED_METADATA_GAP_ROWS = 1;
// Gap row between the UpdateAvailableCard and the metadata lines.
const UPDATE_CARD_GAP_ROWS = 1;
// Recommended terminal size shown in the compact-mode hint when the viewport is
// too small to render any logo art.
const RECOMMENDED_FULL_HEADER_HINT = `Resize to ≥${LOGO_LARGE_MIN_COLS}×${LOGO_LARGE_MIN_ROWS} for the full Codexa header`;

export type HeaderHeroMode = "wide" | "medium" | "narrow" | "compact";

export interface HeaderHeroLayout {
  mode: HeaderHeroMode;
  topMarginRows: number;
  bottomMarginRows: number;
  metadataGapColumns: number;
  metadataGapRows: number;
  logoRows: number;
  metadataRows: number;
  // Extra rows used by the compact-mode recommended-size hint (0 in non-compact
  // modes). Threaded through so measureTopHeaderRows matches what renders.
  compactHintRows: number;
  totalRows: number;
}

type HeaderMetadataLine = { key: string; text: string; color: string; bold: boolean };

export interface UpdateAvailableInfo {
  latestVersion: string;
  currentVersion: string;
}

interface TopHeaderProps {
  authState: CodexAuthState;
  workspaceLabel: string;
  layout: Layout;
  runtimeSummary?: RuntimeSummary | null;
  headerConfig?: HeaderConfig;
  updateAvailable?: UpdateAvailableInfo | null;
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
  hasUpdate = false,
): HeaderHeroLayout {
  const { topMarginRows, bottomMarginRows } = getHeaderVerticalMargins(layout);
  const metadataRows = getMetadataRowCount(headerConfig);
  const contentWidth = getHeaderContentWidth(layout.cols);

  // Pick the largest logo that fits both the columns AND the rows. This degrades
  // large → medium → compact on a short terminal instead of collapsing straight
  // to the flat text-only header.
  const logo = selectLogoVariantForViewport(layout.cols, layout.rows);
  const logoWidth = logo.length > 0 ? getLogoWidth(logo) : 0;
  const canRenderLogo = logo.length > 0;

  if (!canRenderLogo) {
    // Compact / text-only header. Show a recommended-size hint when the logo was
    // dropped purely for size (not because the user disabled ASCII art).
    const sizeHintRows = process.env["CODEXA_NO_ASCII_LOGO"] === "1" ? 0 : 1;
    return {
      mode: "compact",
      topMarginRows,
      bottomMarginRows,
      metadataGapColumns: 0,
      metadataGapRows: 0,
      logoRows: 1,
      metadataRows: 0,
      compactHintRows: sizeHintRows,
      totalRows: topMarginRows + 1 + sizeHintRows + bottomMarginRows,
    };
  }

  const logoRowCount = logo.length;
  const metadataGapColumns = layout.cols >= WIDE_HEADER_MIN_COLUMNS ? 4 : 2;
  const metadataColumnWidth = contentWidth - logoWidth - metadataGapColumns;
  const canUseSideBySide = metadataRows === 0
    || metadataColumnWidth >= MIN_SIDE_BY_SIDE_METADATA_WIDTH;
  const mode: HeaderHeroMode = canUseSideBySide && layout.cols >= WIDE_HEADER_MIN_COLUMNS
    ? "wide"
    : canUseSideBySide && layout.cols >= MEDIUM_HEADER_MIN_COLUMNS
      ? "medium"
      : "narrow";
  const metadataGapRows = mode === "narrow" && metadataRows > 0 ? STACKED_METADATA_GAP_ROWS : 0;

  const isSideBySide = mode === "wide" || mode === "medium";

  // In side-by-side mode the right column grows to: update card + gap + metadata.
  // In narrow/stacked mode, the update card is a single extra line below metadata.
  const rightColRows = isSideBySide
    ? (hasUpdate ? UPDATE_CARD_ROWS + UPDATE_CARD_GAP_ROWS : 0) + metadataRows
    : 0;

  const contentRows = isSideBySide
    ? Math.max(logoRowCount, rightColRows)
    : logoRowCount + metadataGapRows + metadataRows + (hasUpdate ? STACKED_METADATA_GAP_ROWS + 1 : 0);

  return {
    mode,
    topMarginRows,
    bottomMarginRows,
    metadataGapColumns,
    metadataGapRows,
    logoRows: logoRowCount,
    metadataRows,
    compactHintRows: 0,
    totalRows: topMarginRows + contentRows + bottomMarginRows,
  };
}

export function measureTopHeaderRows(
  layout: Layout,
  headerConfig: HeaderConfig = HEADER_CONFIG_DEFAULTS,
  hasUpdate = false,
): number {
  return getHeaderHeroLayout(layout, headerConfig, hasUpdate).totalRows;
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
  updateAvailable = null,
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

  const heroLayout = getHeaderHeroLayout(layout, headerConfig, !!updateAvailable);
  const selectedLogo = selectLogoVariantForViewport(layout.cols, layout.rows);
  const selectedLogoWidth = selectedLogo.length > 0 ? getLogoWidth(selectedLogo) : 0;

  const contentWidth = getHeaderContentWidth(layout.cols);
  const sideBySideMetadataWidth = Math.max(1, contentWidth - selectedLogoWidth - heroLayout.metadataGapColumns);
  const metadataWidth = heroLayout.mode === "wide" || heroLayout.mode === "medium"
    ? sideBySideMetadataWidth
    : contentWidth;
  const workspaceValueWidth = Math.max(1, metadataWidth - getTextWidth("Workspace: "));
  const wsDisplay = shortenHeaderWorkspaceLabel(workspaceLabel, workspaceValueWidth);
  const brandLabel = formatCodexaBrandLabel();
  const metadataLinesRaw = [
    headerConfig.showBrand ? { key: "brand", text: brandLabel, color: theme.text, bold: true } : null,
    headerConfig.showAuthStatus ? { key: "auth", text: `Auth: ${authLabel}`, color: theme.text, bold: false } : null,
    headerConfig.showWorkspace ? { key: "workspace", text: `Workspace: ${wsDisplay}`, color: theme.textMuted, bold: false } : null,
    headerConfig.showProvider && runtimeSummary?.providerLabel
      ? { key: "provider", text: `Provider: ${runtimeSummary.providerLabel}`, color: theme.text, bold: false }
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

  // Canonical CODEXA wordmark — uses per-line LOGO palette defined in each theme.
  // No `bold`: bold on Unicode block/box-drawing characters causes per-glyph
  // spacing artifacts in common terminal fonts (Ptyxis, GNOME Terminal).
  // wrap="truncate" keeps each row on exactly one terminal line.
  const logoColumn = (
    <Box flexDirection="column" flexShrink={0}>
      {selectedLogo.map((line, i) => {
        let lineColor = theme.logoPrimary;
        if (selectedLogo.length === 6) {
          if (i === 2 || i === 3) lineColor = theme.logoSecondary;
          else if (i === 4 || i === 5) lineColor = theme.logoShadow;
        }
        return (
          <Text key={i} color={lineColor} wrap="truncate">{line}</Text>
        );
      })}
    </Box>
  );

  if (heroLayout.mode !== "compact") {
    const isSideBySide = heroLayout.mode === "wide" || heroLayout.mode === "medium";
    const metadataTopOffset = 0;

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
              {updateAvailable && (
                <>
                  <UpdateAvailableCard
                    latestVersion={updateAvailable.latestVersion}
                    currentVersion={updateAvailable.currentVersion}
                    width={metadataWidth}
                  />
                  <Box height={UPDATE_CARD_GAP_ROWS} />
                </>
              )}
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
            {updateAvailable && (
              <Text color={theme.warning} wrap="truncate">{`Update available: Codexa ${formatVersionLabel(updateAvailable.latestVersion)} — Run: npm install -g @golba98/codexa@latest`}</Text>
            )}
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
  // A leading ✦ accent makes the single-line header read as a deliberate
  // compact Codexa header rather than a broken fallback.
  const compactParts: React.ReactNode[] = [
    <Text key="accent" color={theme.accent} bold>{"✦ "}</Text>,
  ];
  if (headerConfig.showBrand) {
    compactParts.push(
      <Text key="brand" color={theme.text} bold>{brandLabel}</Text>,
    );
  }
  if (headerConfig.showAuthStatus) {
    if (compactParts.length > 0) compactParts.push(<Text key="sep-auth" color={theme.textDim}>{"  ·  "}</Text>);
    compactParts.push(<Text key="auth" color={theme.text}>{authLabel}</Text>);
  }
  if (headerConfig.showWorkspace) {
    if (compactParts.length > 0) compactParts.push(<Text key="sep-ws" color={theme.textDim}>{"  ·  "}</Text>);
    compactParts.push(<Text key="ws" color={theme.textMuted} wrap="truncate">{`Workspace: ${compactWorkspaceDisplay}`}</Text>);
  }
  if (headerConfig.showProvider && runtimeSummary?.providerLabel) {
    if (compactParts.length > 0) compactParts.push(<Text key="sep-provider" color={theme.textDim}>{"  ·  "}</Text>);
    compactParts.push(<Text key="provider" color={theme.text} wrap="truncate">{`Provider: ${runtimeSummary.providerLabel}`}</Text>);
  }

  return (
    <Box flexDirection="column" paddingX={1} width="100%">
      {heroLayout.topMarginRows > 0 && (
        <Box height={heroLayout.topMarginRows} />
      )}
      <Box flexDirection="row" width="100%">
        {compactParts}
      </Box>
      {heroLayout.compactHintRows > 0 && (
        <Text color={theme.textDim} wrap="truncate">{clampMetadataText(RECOMMENDED_FULL_HEADER_HINT, compactMetadataWidth)}</Text>
      )}
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
    prev.headerConfig === next.headerConfig &&
    prev.updateAvailable === next.updateAvailable
  );
});

// Minimum terminal cols to render any logo art (the compact 1-row variant).
export const MIN_LOGO_TERMINAL_WIDTH = LOGO_COMPACT_MIN_COLS;

// Re-export for consumers that reference these constants directly.
export { LOGO_LARGE_MIN_COLS, LOGO_MEDIUM_MIN_COLS, LOGO_COMPACT_MIN_COLS };
