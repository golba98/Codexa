import React, { memo, useEffect, useMemo, useRef } from "react";
import { Box, Static } from "ink";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import type { TimelineEvent, UIState } from "../session/types.js";
import {
  buildActiveRenderItems,
  buildIntroRenderItem,
  buildStaticRenderItems,
  buildTimelineItems,
  TimelineRowView,
  type TimelineItem,
} from "./Timeline.js";
import { getShellHeight, getShellWidth, resolveStartupHeaderMode, type TerminalViewport } from "./layout.js";
import {
  buildNativeTranscriptParts,
  type NativeTranscriptRowItem,
  type TimelineRow,
} from "./timelineMeasure.js";
import { LOGO_COMPACT, LOGO_LARGE, LOGO_MEDIUM, selectLogoVariant } from "./logoVariants.js";

type TranscriptStaticItem = NativeTranscriptRowItem & { type: "rows" };
type StaticRenderItem = TranscriptStaticItem;

export interface TranscriptShellProps {
  layout: TerminalViewport;
  authState: CodexAuthState;
  workspaceLabel: string;
  workspaceRoot?: string | null;
  runtimeSummary?: RuntimeSummary | null;
  staticEvents: TimelineEvent[];
  activeEvents: TimelineEvent[];
  uiState: UIState;
  composer: React.ReactNode;
  composerRows?: number;
  verboseMode?: boolean;
  clearCount?: number;
  /**
   * Bumped whenever a width-changing resize forces the terminal's app.tsx-owned
   * clear boundary to physically wipe the screen. Folded into <Static>'s key
   * (not the whole component's) so already-flushed content reprints at the
   * new width — without remounting the composer or anything else.
   */
  repaintGeneration?: number;
  visible?: boolean;
}

function RowsBlock({ rows }: { rows: TimelineRow[] }) {
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <TimelineRowView key={row.key} row={row} />
      ))}
    </Box>
  );
}

function isTranscriptEvent(event: TimelineEvent): boolean {
  return event.type === "user" || event.type === "assistant" || event.type === "run" || event.type === "shell";
}

export function isHomeScreenState({
  staticEvents,
  activeEvents,
  uiState,
}: {
  staticEvents: TimelineEvent[];
  activeEvents: TimelineEvent[];
  uiState: UIState;
}): boolean {
  return uiState.kind === "IDLE"
    && !staticEvents.some(isTranscriptEvent)
    && !activeEvents.some(isTranscriptEvent);
}

function getLogoVariantName(rows: readonly string[]): "large" | "medium" | "compact" | "wordmark" | "none" {
  if (rows.length === 0) return process.env["CODEXA_NO_ASCII_LOGO"] === "1" ? "none" : "wordmark";
  if (rows === LOGO_LARGE || rows.join("\n") === LOGO_LARGE.join("\n")) return "large";
  if (rows === LOGO_MEDIUM || rows.join("\n") === LOGO_MEDIUM.join("\n")) return "medium";
  if (rows === LOGO_COMPACT || rows.join("\n") === LOGO_COMPACT.join("\n")) return "compact";
  return "wordmark";
}

function getLogoHiddenReason({
  startupHeaderMode,
  logoVariant,
  width,
}: {
  startupHeaderMode: ReturnType<typeof resolveStartupHeaderMode>;
  logoVariant: ReturnType<typeof getLogoVariantName>;
  width: number;
}): string | null {
  if (startupHeaderMode === "tiny") return "terminal-too-small";
  if (process.env["CODEXA_NO_ASCII_LOGO"] === "1") return "CODEXA_NO_ASCII_LOGO";
  if (logoVariant === "wordmark") return `no-ascii-variant-fits-width-${width}`;
  if (logoVariant === "none") return `no-logo-variant-fits-width-${width}`;
  return null;
}

function buildTranscriptItems({
  layout,
  authState,
  workspaceLabel,
  workspaceRoot,
  runtimeSummary,
  staticEvents,
  activeEvents,
  uiState,
  composerRows,
  verboseMode,
}: Pick<
  TranscriptShellProps,
  | "layout"
  | "authState"
  | "workspaceLabel"
  | "workspaceRoot"
  | "runtimeSummary"
  | "staticEvents"
  | "activeEvents"
  | "uiState"
  | "composerRows"
  | "verboseMode"
>): { staticItems: TranscriptStaticItem[]; liveRows: TimelineRow[]; startupHeaderMode: ReturnType<typeof resolveStartupHeaderMode> } {
  const staticItems = buildTimelineItems(staticEvents);
  const activeItems = buildTimelineItems(activeEvents);
  const turnIds = [...staticItems, ...activeItems]
    .filter((item): item is Extract<TimelineItem, { type: "turn" }> => item.type === "turn")
    .map((item) => item.turnId);
  const startupHeaderMode = resolveStartupHeaderMode({
    cols: layout.cols,
    rows: layout.rows,
    introRows: 8,
    composerRows: composerRows ?? 5,
  });

  const parts = buildNativeTranscriptParts(
    [
      buildIntroRenderItem({
        authState,
        workspaceLabel,
        layout,
        providerLabel: runtimeSummary?.providerLabel ?? null,
        startupHeaderMode,
      }),
      ...buildStaticRenderItems(staticItems, turnIds, null, null, null),
      ...buildActiveRenderItems(activeItems, turnIds, uiState),
    ],
    {
      totalWidth: getShellWidth(layout.cols),
      verboseMode,
      debugLabel: "transcript-shell",
      workspaceRoot,
    },
  );

  return {
    staticItems: parts.staticItems.map((item) => ({ ...item, type: "rows" as const })),
    liveRows: parts.liveRows,
    startupHeaderMode,
  };
}

function TranscriptShellInner({
  layout,
  authState,
  workspaceLabel,
  workspaceRoot = null,
  runtimeSummary = null,
  staticEvents,
  activeEvents,
  uiState,
  composer,
  composerRows,
  verboseMode = false,
  clearCount = 0,
  visible = true,
}: TranscriptShellProps) {
  const { staticItems, liveRows, startupHeaderMode } = useMemo(
    () => buildTranscriptItems({
      layout,
      authState,
      workspaceLabel,
      workspaceRoot,
      runtimeSummary,
      staticEvents,
      activeEvents,
      uiState,
      composerRows,
      verboseMode,
    }),
    [activeEvents, authState, composerRows, layout, runtimeSummary, staticEvents, uiState, verboseMode, workspaceLabel, workspaceRoot],
  );
  const homeScreenActive = visible && isHomeScreenState({ staticEvents, activeEvents, uiState });
  const visibleStaticItemsRef = useRef(staticItems);

  useEffect(() => {
    if (visible) {
      visibleStaticItemsRef.current = staticItems;
    }
  }, [staticItems, visible]);

  const displayedStaticItems = visible ? staticItems : visibleStaticItemsRef.current;

  const staticRenderItems = useMemo<StaticRenderItem[]>(() => {
    return displayedStaticItems.map((item) => ({
      ...item,
      key: `clear-${clearCount}-${item.key}`,
    }));
  }, [clearCount, displayedStaticItems]);

  const displayedLiveRows = visible ? liveRows : [];
  const staticRowCount = useMemo(
    () => displayedStaticItems.reduce((rowCount, item) => rowCount + item.rows.length, 0),
    [displayedStaticItems],
  );
  const liveBottomSpacerRows = visible
    ? Math.max(0, getShellHeight(layout.rows) - staticRowCount - displayedLiveRows.length - (composerRows ?? 0))
    : 0;
  const spacerRows = useMemo<TimelineRow[]>(
    () => Array.from({ length: liveBottomSpacerRows }, (_, index) => ({
      key: `live-bottom-spacer-${clearCount}-${index}`,
      spans: [{ text: " ".repeat(getShellWidth(layout.cols)) }],
    })),
    [clearCount, layout.cols, liveBottomSpacerRows],
  );
  const shellWidth = getShellWidth(layout.cols);
  const introInnerWidth = Math.max(10, shellWidth - 2);
  const selectedLogoRows = startupHeaderMode === "tiny" ? [] : selectLogoVariant(introInnerWidth);
  const selectedLogoVariant = getLogoVariantName(selectedLogoRows);
  const logoHiddenReason = getLogoHiddenReason({
    startupHeaderMode,
    logoVariant: selectedLogoVariant,
    width: introInnerWidth,
  });
  const startupTraceKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const nextKey = [
      layout.cols,
      layout.rows,
      layout.mode,
      startupHeaderMode,
      homeScreenActive ? "home" : "transcript",
      staticEvents.length,
      activeEvents.length,
      uiState.kind,
      selectedLogoVariant,
      clearCount,
    ].join("|");
    if (startupTraceKeyRef.current === nextKey) return;
    startupTraceKeyRef.current = nextKey;
    renderDebug.traceEvent("startup", "homeRender", {
      cols: layout.cols,
      rows: layout.rows,
      layoutMode: layout.mode,
      activeRoot: "TranscriptShell",
      messageCount: [...staticEvents, ...activeEvents].filter(isTranscriptEvent).length,
      staticEventsLength: staticEvents.length,
      activeEventsLength: activeEvents.length,
      uiStateKind: uiState.kind,
      selectedLayoutMode: startupHeaderMode,
      selectedLogoVariant,
      logoBranchSelected: selectedLogoVariant !== "none" && selectedLogoVariant !== "wordmark",
      logoHiddenReason,
      composerCount: visible ? 1 : 0,
      footerCount: visible ? 1 : 0,
      homeScreenRendererUsed: homeScreenActive,
      staticItemCount: staticRenderItems.length,
      liveRowCount: displayedLiveRows.length,
      clearCount,
    });
  }, [
    activeEvents,
    clearCount,
    displayedLiveRows.length,
    homeScreenActive,
    layout.cols,
    layout.mode,
    layout.rows,
    logoHiddenReason,
    selectedLogoVariant,
    startupHeaderMode,
    staticEvents,
    staticRenderItems.length,
    uiState.kind,
    visible,
  ]);

  return (
    <Box flexDirection="column" width="100%" display={visible ? "flex" : "none"}>
      <Static key={`static-${clearCount}`} items={staticRenderItems}>
        {(item) => <RowsBlock key={item.key} rows={item.rows} />}
      </Static>

      {displayedLiveRows.length > 0 && <RowsBlock rows={displayedLiveRows} />}
      {spacerRows.length > 0 && <RowsBlock rows={spacerRows} />}

      {visible && composer}
    </Box>
  );
}

export const TranscriptShell = memo(function TranscriptShell(props: TranscriptShellProps) {
  // repaintGeneration is folded in here (not just <Static>'s own key) because
  // Ink only reliably re-flushes <Static> content on a genuine fresh mount of
  // the whole subtree — its "capture before delete" escape hatch
  // (reconciler.js's isStaticDirty/onImmediateRender) does not fire the same
  // way when only the inner <Static> node is keyed away and remounted on its
  // own. This does remount the composer too, but only on the (already
  // disruptive) event of a real terminal resize, not during normal typing.
  return (
    <TranscriptShellInner
      key={`clear-${props.clearCount ?? 0}-repaint-${props.repaintGeneration ?? 0}`}
      {...props}
    />
  );
});
