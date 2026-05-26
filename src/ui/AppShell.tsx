import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useStdin } from "ink";
import { useTheme } from "./theme.js";
import type { UpdateCheckResult } from "../core/updateCheck.js";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { HEADER_CONFIG_DEFAULTS, type HeaderConfig } from "../config/settings.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import type { Screen, TimelineEvent, UIState } from "../session/types.js";
import { isBusy } from "../session/types.js";
import {
  getShellHeight,
  getShellWidth,
  type Layout,
  type LayoutMode,
} from "./layout.js";
import {
  buildActiveRenderItems,
  buildStaticRenderItems,
  buildTimelineItems,
  parseTimelineNavigationInput,
  Timeline,
  TimelineRowView,
  type TimelineItem,
} from "./Timeline.js";
import { buildNativeTranscriptParts, type NativeTranscriptRowItem, type TimelineRow } from "./timelineMeasure.js";
import type { TerminalSelectionProfile } from "../core/terminal/terminalSelection.js";
import { MemoizedTopHeader, measureTopHeaderRows } from "./TopHeader.js";

const COMPACT_HEADER_TO_COMPOSER_GAP_ROWS = 2;
const MEDIUM_HEADER_TO_COMPOSER_GAP_ROWS = 4;
const TALL_HEADER_TO_COMPOSER_GAP_ROWS = 6;

// ─── Types & constants ────────────────────────────────────────────────────────

type AppShellLayout = Layout & { layoutEpoch?: number };
type NativeStaticItem =
  { type: "rows" } & NativeTranscriptRowItem;

export interface AppShellProps {
  layout: AppShellLayout;
  screen: Screen;
  authState: CodexAuthState;
  workspaceLabel: string;
  workspaceRoot?: string | null;
  runtimeSummary?: RuntimeSummary | null;
  staticEvents: TimelineEvent[];
  activeEvents: TimelineEvent[];
  uiState: UIState;
  panel: React.ReactNode;
  mainPanel?: React.ReactNode;
  mainPanelMode?: "viewport" | "full-output";
  composer: React.ReactNode;
  composerRows: number;
  panelHint?: React.ReactNode;
  verboseMode?: boolean;
  mouseCapture?: boolean;
  onMouseActivity?: () => void;
  selectionProfile?: TerminalSelectionProfile;
  clearCount?: number;
  headerConfig?: HeaderConfig;
  updateCheckResult?: UpdateCheckResult | null;
}

// ─── Helpers & subcomponents ─────────────────────────────────────────────────

export function isCrampedViewport(rows: number | undefined): boolean {
  return (rows ?? 24) <= 24;
}

export function calculateNativeSpacerRows({
  shellRows,
  introRows,
  composerRows,
  staticRows,
  liveRows,
}: {
  shellRows: number;
  introRows: number;
  composerRows: number;
  staticRows: number;
  liveRows: number;
}): number {
  const availableBodyRows = Math.max(0, shellRows - introRows - composerRows);
  const visibleBodyContentRows = Math.max(0, staticRows) + Math.max(0, liveRows);
  return Math.max(0, availableBodyRows - visibleBodyContentRows);
}

export function calculateColdStartSpacerRows({
  shellRows,
  headerRows,
  composerRows,
  layoutMode,
  availableRows,
}: {
  shellRows: number;
  headerRows: number;
  composerRows: number;
  layoutMode: LayoutMode;
  availableRows: number;
}): number {
  if (availableRows <= 0) return 0;

  const rowsAfterHeaderAndComposer = Math.max(0, shellRows - headerRows - composerRows);
  const preferredRows = layoutMode === "micro" || shellRows <= 18
    ? 1
    : shellRows >= 36
      ? TALL_HEADER_TO_COMPOSER_GAP_ROWS
      : shellRows >= 28
        ? MEDIUM_HEADER_TO_COMPOSER_GAP_ROWS
        : COMPACT_HEADER_TO_COMPOSER_GAP_ROWS;

  return Math.max(0, Math.min(availableRows, rowsAfterHeaderAndComposer, preferredRows));
}

export function calculateHeaderToContentGapRows(layout: Layout): number {
  if (layout.mode === "micro" || layout.rows <= 18) return 0;
  return 1;
}

function NativeRowsItem({ rows }: { rows: TimelineRow[] }) {
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <TimelineRowView key={row.key} row={row} />
      ))}
    </Box>
  );
}

function NativePauseBar({ unseenRows }: { unseenRows: number }) {
  return (
    <Box width="100%" paddingX={1}>
      <Text dimColor>
        {unseenRows > 0
          ? `↓  ${unseenRows} new rows · End to follow`
          : "↓  New output · End to follow"}
      </Text>
    </Box>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

function AppShellInner({
  layout,
  screen,
  authState,
  workspaceLabel,
  workspaceRoot = null,
  runtimeSummary = null,
  staticEvents,
  activeEvents,
  uiState,
  panel,
  mainPanel,
  mainPanelMode = "viewport",
  composer,
  composerRows,
  panelHint,
  verboseMode = false,
  mouseCapture = false,
  onMouseActivity,
  selectionProfile,
  clearCount = 0,
  headerConfig = HEADER_CONFIG_DEFAULTS,
  updateCheckResult = null,
}: AppShellProps) {
  const theme = useTheme();
  renderDebug.useRenderDebug("AppShell", {
    cols: layout.cols,
    rows: layout.rows,
    mode: layout.mode,
    layoutEpoch: layout.layoutEpoch,
    screen,
    authState,
    workspaceLabel,
    workspaceRoot,
    runtimeSummary,
    staticEvents,
    activeEvents,
    uiState,
    composer,
    composerRows,
    verboseMode,
  });
  renderDebug.useLifecycleDebug("AppShell", {
    screen,
    cols: layout.cols,
    rows: layout.rows,
    mode: layout.mode,
  });

  const shellWidth = getShellWidth(layout.cols);
  const shellHeight = getShellHeight(layout.rows);
  const headerRows = measureTopHeaderRows(layout, headerConfig);
  const headerToContentGapRows = calculateHeaderToContentGapRows(layout);
  const showComposer = screen === "main";
  const showMainPanel = screen === "main" && mainPanel !== undefined && mainPanel !== null;
  const showMainPanelFullOutput = showMainPanel && mainPanelMode === "full-output";
  const showTimeline = screen === "main" && !showMainPanel;
  const showPanelStage = screen !== "main";
  const hasUserPrompt = useMemo(
    () => staticEvents.some((e) => e.type === "user") || activeEvents.some((e) => e.type === "user"),
    [staticEvents, activeEvents],
  );
  const previousMeasurements = useRef<{
    timelineRows: number;
    composerRows: number;
    shellHeight: number;
    shellWidth: number;
  } | null>(null);

  // ── Native mode scroll-pause state ────────────────────────────────────────
  // When the user presses Page Up or Home during streaming, we freeze nativeAllRows
  // so Ink's lastOutputHeight stays constant and the terminal stops auto-scrolling.
  const [nativePaused, setNativePaused] = useState(false);
  const nativePausedRef = useRef(false);
  const frozenNativeRowsRef = useRef<TimelineRow[]>([]);
  const frozenLiveRowCountRef = useRef(0);
  const { stdin } = useStdin();

  useEffect(() => {
    if (mouseCapture) return;
    if (!isBusy(uiState) && nativePausedRef.current) {
      setNativePaused(false);
      nativePausedRef.current = false;
    }
  }, [mouseCapture, uiState]);

  useEffect(() => {
    if (mouseCapture || !stdin) return;

    function handleScrollKeys(chunk: Buffer | string) {
      const raw = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const actions = parseTimelineNavigationInput(raw);
      if (actions.length === 0) return;

      const wantsUp = actions.includes("pageUp") || actions.includes("home");
      const wantsDown = actions.includes("pageDown") || actions.includes("end");

      if (wantsDown && nativePausedRef.current) {
        setNativePaused(false);
        nativePausedRef.current = false;
      } else if (wantsUp && !nativePausedRef.current && isBusy(uiState)) {
        setNativePaused(true);
        nativePausedRef.current = true;
      }
    }

    stdin.on("data", handleScrollKeys);
    return () => { stdin.off("data", handleScrollKeys); };
  }, [mouseCapture, stdin, uiState]);
  // ── End native mode scroll-pause state ────────────────────────────────────

  const effectiveShowComposer = showComposer;
  const effectiveComposerRows = effectiveShowComposer ? composerRows : 0;
  const panelHintRows = showPanelStage && panelHint ? 2 : 0;
  const canUseColdStartGap = effectiveShowComposer && !hasUserPrompt && screen === "main" && !showMainPanel;

  // Timeline/panel owns all vertical space between the live header and fixed composer.
  const coldStartAvailableRows = Math.max(
    0,
    shellHeight - headerRows - headerToContentGapRows - effectiveComposerRows - panelHintRows - 2,
  );
  const coldStartComposerGapRows = canUseColdStartGap
    ? calculateColdStartSpacerRows({
      shellRows: shellHeight,
      headerRows,
      composerRows: effectiveComposerRows,
      layoutMode: layout.mode,
      availableRows: coldStartAvailableRows,
    })
    : 0;
  const fixedComposerLeadGapRows = mouseCapture ? coldStartComposerGapRows : 0;
  const calculatedTimelineRowsRaw = shellHeight
    - headerRows
    - headerToContentGapRows
    - effectiveComposerRows
    - panelHintRows
    - fixedComposerLeadGapRows;
  const calculatedTimelineRows = Math.max(2, calculatedTimelineRowsRaw);

  const { finalShellHeight, finalShellWidth, finalTimelineRows } = useMemo(() => {
    const prev = previousMeasurements.current;
    const isValid = shellHeight > 0
      && shellWidth > 0
      && Number.isFinite(shellHeight)
      && Number.isFinite(shellWidth)
      && Number.isFinite(calculatedTimelineRowsRaw)
      && calculatedTimelineRowsRaw >= 2;

    if (!isValid && prev) {
      renderDebug.traceEvent("layout", "measurementFallback", {
        reason: "invalid-shell-or-timeline-rows",
        shellHeight,
        shellWidth,
        calculatedTimelineRowsRaw,
        previousTimelineRows: prev.timelineRows,
      });
      return {
        finalShellHeight: prev.shellHeight,
        finalShellWidth: prev.shellWidth,
        finalTimelineRows: prev.timelineRows,
      };
    }

    if (!isValid) {
      renderDebug.traceEvent("layout", "measurementFallback", {
        reason: "invalid-initial-shell-or-timeline-rows",
        shellHeight,
        shellWidth,
        calculatedTimelineRowsRaw,
        clampedTimelineRows: calculatedTimelineRows,
      });
    }

    return {
      finalShellHeight: shellHeight,
      finalShellWidth: shellWidth,
      finalTimelineRows: Math.max(2, calculatedTimelineRows),
    };
  }, [shellHeight, shellWidth, calculatedTimelineRows, calculatedTimelineRowsRaw]);

  const nativeTranscriptParts = useMemo(() => {
    if (mouseCapture) {
      return { staticItems: [], liveRows: [] };
    }

    const staticItems = buildTimelineItems(staticEvents);
    const activeItems = buildTimelineItems(activeEvents);
    const turnIds = [...staticItems, ...activeItems]
      .filter((item): item is Extract<TimelineItem, { type: "turn" }> => item.type === "turn")
      .map((item) => item.turnId);

    const parts = buildNativeTranscriptParts(
      [
        ...buildStaticRenderItems(staticItems, turnIds, null, null, null),
        ...buildActiveRenderItems(activeItems, turnIds, uiState),
      ],
      {
        totalWidth: finalShellWidth,
        verboseMode,
        debugLabel: "app-shell-native",
        workspaceRoot,
      },
    );

    // If we're not supposed to show the timeline yet (e.g. during early mount
    // or when in a full-panel mode), we still calculate the static parts
    // but hide the live rows. This keeps the committed row array stable,
    // preventing unnecessary re-renders.
    if (!showTimeline) {
      return { ...parts, liveRows: [] };
    }

    return parts;
  }, [activeEvents, finalShellWidth, mouseCapture, showTimeline, staticEvents, uiState, verboseMode, workspaceRoot]);

  // In native mode the root box is content-sized (no fixed height), so without an
  // explicit spacer the composer appears immediately after the intro instead of being
  // anchored near the terminal bottom.  The spacer fills the gap between whatever
  // live content exists and where the composer should sit.
  const nativeStaticTranscriptRows = useMemo(
    () => nativeTranscriptParts.staticItems.reduce((total, item) => total + item.rows.length, 0),
    [nativeTranscriptParts.staticItems],
  );
  const nativeSpacerRows = useMemo(() => {
    if (mouseCapture || !effectiveShowComposer || showMainPanel) return 0;
    const rows = calculateNativeSpacerRows({
      shellRows: finalShellHeight,
      introRows: headerRows + headerToContentGapRows,
      composerRows: effectiveComposerRows,
      staticRows: nativeStaticTranscriptRows,
      liveRows: nativeTranscriptParts.liveRows.length,
    });
    // Before the user sends their first prompt, keep a small fixed gap so the
    // composer sits near the logo without a large blank area in between.
    // This cap persists across model/auth system events so the layout stays
    // stable after config changes on cold start.
    if (!hasUserPrompt) {
      return calculateColdStartSpacerRows({
        shellRows: finalShellHeight,
        headerRows,
        composerRows: effectiveComposerRows,
        layoutMode: layout.mode,
        availableRows: rows,
      });
    }
    return rows;
  }, [mouseCapture, effectiveShowComposer, showMainPanel, finalShellHeight, headerRows, headerToContentGapRows, effectiveComposerRows, layout.mode, nativeStaticTranscriptRows, nativeTranscriptParts.liveRows.length, hasUserPrompt]);

  // In native mode (no SGR capture), committed rows still render inside the
  // body below the live header. Do not use Ink's static output component here
  // because it permanently prepends static output above live output, which
  // would place transcript content before the header regardless of JSX order.
  const nativeStaticAllItems = useMemo<NativeStaticItem[]>(
    () => {
      if (mouseCapture) return [];
      return nativeTranscriptParts.staticItems.map((item) => ({ ...item, type: "rows" as const }));
    },
    [mouseCapture, clearCount, nativeTranscriptParts.staticItems],
  );
  const nativeAllRows = useMemo<TimelineRow[]>(
    () => {
      if (mouseCapture) return [];

      // When the user has paused auto-follow (pressed Page Up while busy),
      // return the frozen snapshot so Ink's lastOutputHeight stays constant
      // and the terminal stops auto-scrolling to the cursor on each frame.
      if (nativePaused) {
        return frozenNativeRowsRef.current;
      }

      const allStaticRows = nativeStaticAllItems.flatMap((item) => item.rows);
      // Trim old static rows so lastOutputHeight stays bounded to ~2 terminal heights.
      // Rows that fall off the top are already in terminal scrollback.
      const maxStaticRows = finalShellHeight > 0 ? finalShellHeight * 2 : allStaticRows.length;
      const trimmedStaticRows = allStaticRows.slice(Math.max(0, allStaticRows.length - maxStaticRows));

      const rows = [
        ...trimmedStaticRows,
        ...(showTimeline ? nativeTranscriptParts.liveRows : []),
      ];
      frozenLiveRowCountRef.current = showTimeline ? nativeTranscriptParts.liveRows.length : 0;
      frozenNativeRowsRef.current = rows;
      return rows;
    },
    [mouseCapture, nativePaused, nativeStaticAllItems, nativeTranscriptParts.liveRows, showTimeline, finalShellHeight],
  );

  // When paused, count how many live rows have arrived since the freeze point.
  const nativeUnseenRows = nativePaused
    ? Math.max(0, (showTimeline ? nativeTranscriptParts.liveRows.length : 0) - frozenLiveRowCountRef.current)
    : 0;

  renderDebug.traceEvent("layout", "nativeTranscript", {
    nativeMode: !mouseCapture,
    mouseCapture,
    showTimeline,
    activeEvents: activeEvents.length,
    staticEvents: staticEvents.length,
    staticItems: nativeStaticAllItems.length,
    liveRows: nativeTranscriptParts.liveRows.length,
    contentSized: true,
    finalTimelineRows,
    composerRows: effectiveComposerRows,
    headerRows,
  });

  renderDebug.traceLayoutValidity("AppShell", {
    cols: layout.cols,
    rows: layout.rows,
    shellWidth,
    shellHeight,
    timelineRows: finalTimelineRows,
    calculatedTimelineRowsRaw,
    composerRows: effectiveComposerRows,
  });
  if (!Number.isFinite(calculatedTimelineRowsRaw) || calculatedTimelineRowsRaw <= 0) {
    renderDebug.traceBlankFrame("AppShell", {
      reason: "invalid-available-timeline-rows",
      availableTimelineRows: calculatedTimelineRowsRaw,
      finalTimelineRows,
      composerRows: effectiveComposerRows,
      shellHeight: finalShellHeight,
      screen,
      uiStateKind: uiState.kind,
    });
  }

  useEffect(() => {
    const previous = previousMeasurements.current;
    const changed: string[] = [];
    if (!previous) {
      changed.push("mount");
    } else {
      if (previous.timelineRows !== finalTimelineRows) changed.push("availableTimelineRows");
      if (previous.composerRows !== effectiveComposerRows) changed.push("composerRows");
      if (previous.shellHeight !== finalShellHeight) changed.push("height");
    }

    if (changed.length > 0) {
      renderDebug.traceEvent("layout", "measurementUpdate", {
        reason: changed.join(","),
        availableTimelineRows: finalTimelineRows,
        rawAvailableTimelineRows: calculatedTimelineRowsRaw,
        composerRows: effectiveComposerRows,
        shellHeight: finalShellHeight,
        showComposer,
        showTimeline,
        showMainPanelFullOutput,
      });
    }

    previousMeasurements.current = {
      timelineRows: finalTimelineRows,
      composerRows: effectiveComposerRows,
      shellHeight: finalShellHeight,
      shellWidth: finalShellWidth,
    };
  }, [calculatedTimelineRowsRaw, effectiveComposerRows, finalShellHeight, finalShellWidth, showComposer, showMainPanelFullOutput, showTimeline, finalTimelineRows]);

  const clonedComposer = React.isValidElement(composer)
    ? React.cloneElement(composer as React.ReactElement<{ selectionProfile?: TerminalSelectionProfile }>, { selectionProfile })
    : composer;

  const updateNotice = updateCheckResult?.status === "update-available" ? (
    <Box paddingX={1}>
      <Text color={theme.WARNING}>
        {"Update available: origin/main has newer Codexa changes. Run /update for instructions."}
      </Text>
    </Box>
  ) : null;

  if (showMainPanelFullOutput) {
    return (
      <Box flexDirection="column" width="100%">
        <Box flexDirection="column" width={finalShellWidth}>
          <MemoizedTopHeader
            authState={authState}
            workspaceLabel={workspaceLabel}
            layout={layout}
            runtimeSummary={runtimeSummary}
            headerConfig={headerConfig}
          />

          {updateNotice}

          {headerToContentGapRows > 0 && (
            <Box height={headerToContentGapRows} />
          )}

          {mainPanel}

          {showComposer && (
            <Box flexDirection="column" flexShrink={0}>
              {composer}
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // Native mode: no fixed shell height — content-sized so Ink's lastOutputHeight stays small.
  // All visible content remains in one live tree so the header is always the
  // first physical output region.
  if (!mouseCapture) {
    return (
      <Box flexDirection="column" width={finalShellWidth}>
        <MemoizedTopHeader
          authState={authState}
          workspaceLabel={workspaceLabel}
          layout={layout}
          runtimeSummary={runtimeSummary}
          headerConfig={headerConfig}
        />

        {updateNotice}

        {headerToContentGapRows > 0 && (
          <Box height={headerToContentGapRows} />
        )}

        {nativeAllRows.length > 0 && (
          <NativeRowsItem rows={nativeAllRows} />
        )}

        {nativePaused && isBusy(uiState) && (
          <NativePauseBar unseenRows={nativeUnseenRows} />
        )}

        {showMainPanel && (
          <Box flexDirection="column" paddingY={1} justifyContent="center">
            {mainPanel}
          </Box>
        )}

        {showPanelStage && (
          <Box
            flexDirection="column"
            overflow="hidden"
            paddingY={1}
          >
            {panel}
          </Box>
        )}

        {nativeSpacerRows > 0 && (
          <Box height={nativeSpacerRows} />
        )}

        {effectiveShowComposer && (
          <Box flexDirection="column" flexShrink={0}>
            {composer}
          </Box>
        )}

        {showPanelStage && panelHint}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%" height={finalShellHeight}>
      <Box flexDirection="column" width={finalShellWidth}>
        <MemoizedTopHeader
          authState={authState}
          workspaceLabel={workspaceLabel}
          layout={layout}
          runtimeSummary={runtimeSummary}
          headerConfig={headerConfig}
        />

        {updateNotice}

        {headerToContentGapRows > 0 && (
          <Box height={headerToContentGapRows} />
        )}

        {/* Keep Timeline always mounted so its viewport scroll state survives panel open/close.
            display="none" removes it from yoga layout (0 height) without unmounting. */}
        <Box
          flexDirection="column"
          height={finalTimelineRows}
          overflow="hidden"
          display={showTimeline ? "flex" : "none"}
        >
          <Timeline
            key={`timeline-${clearCount}`}
            staticEvents={staticEvents}
            activeEvents={activeEvents}
            layout={layout}
            uiState={uiState}
            viewportRows={finalTimelineRows}
            verboseMode={verboseMode}
            authState={authState}
            workspaceLabel={workspaceLabel}
            workspaceRoot={workspaceRoot}
            mouseCapture={mouseCapture}
            onMouseActivity={onMouseActivity}
            contentSized
          />
        </Box>

        {showMainPanel && (
          <Box flexDirection="column" height={finalTimelineRows} overflow="hidden" justifyContent="center">
            {mainPanel}
          </Box>
        )}

        {showPanelStage && (
          <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingY={1}>
            {panel}
          </Box>
        )}

        {fixedComposerLeadGapRows > 0 && (
          <Box height={fixedComposerLeadGapRows} />
        )}

        {effectiveShowComposer && (
          <Box flexDirection="column" flexShrink={0}>
            {clonedComposer}
          </Box>
        )}

        {showPanelStage && panelHint}
      </Box>
    </Box>
  );
}

/**
 * Memoized AppShell — prevents re-renders when irrelevant App state changes.
 *
 * The App component re-renders on every streaming delta (via dispatchSession),
 * cursor move, and conversationChars update.  AppShell itself only needs to
 * re-render when the layout, screen, event lists, uiState, or composer
 * layout rows actually change.
 *
 * `composer` must remain in the comparator because MemoizedBottomComposer
 * receives value/cursor updates through this prop; without it the composer
 * would display stale input. Non-main panels are compared so picker content can
 * refresh while the active screen stays unchanged, such as model discovery
 * replacing the loading model picker with the interactive picker.
 */
export const AppShell = memo(AppShellInner, (prev, next) => {
  const panelPropsEqual = next.screen === "main"
    ? prev.mainPanel === next.mainPanel
    : (prev.panel === next.panel && prev.panelHint === next.panelHint);

  return (
    prev.layout.cols     === next.layout.cols     &&
    prev.layout.rows     === next.layout.rows     &&
    prev.layout.mode     === next.layout.mode     &&
    prev.layout.layoutEpoch === next.layout.layoutEpoch &&
    prev.screen          === next.screen          &&
    prev.authState       === next.authState       &&
    prev.workspaceLabel  === next.workspaceLabel  &&
    prev.workspaceRoot   === next.workspaceRoot   &&
    prev.runtimeSummary  === next.runtimeSummary  &&
    prev.staticEvents    === next.staticEvents    &&
    prev.activeEvents    === next.activeEvents    &&
    prev.uiState         === next.uiState         &&
    prev.composerRows    === next.composerRows    &&
    prev.composer        === next.composer        &&
    prev.mainPanel       === next.mainPanel       &&
    prev.mainPanelMode   === next.mainPanelMode   &&
    prev.verboseMode     === next.verboseMode     &&
    prev.mouseCapture    === next.mouseCapture    &&
    prev.onMouseActivity === next.onMouseActivity &&
    prev.clearCount         === next.clearCount         &&
    prev.updateCheckResult  === next.updateCheckResult  &&
    panelPropsEqual
  );
});
