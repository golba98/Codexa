import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useStdin } from "ink";
import { useTheme } from "./theme.js";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { HEADER_CONFIG_DEFAULTS, type HeaderConfig } from "../config/settings.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import type { Screen, TimelineEvent, UIState } from "../session/types.js";
import { isBusy } from "../session/types.js";
import {
  getContentWidth,
  getShellHeight,
  getShellWidth,
  isCrampedTerminal,
  type Layout,
  type LayoutMode,
  MIN_TERMINAL_COLS,
  MIN_TERMINAL_ROWS,
  type TerminalViewport,
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
import { MemoizedTopHeader, measureTopHeaderRows, type UpdateAvailableInfo } from "./TopHeader.js";

const COMPACT_HEADER_TO_COMPOSER_GAP_ROWS = 1;
const MEDIUM_HEADER_TO_COMPOSER_GAP_ROWS = 1;
const TALL_HEADER_TO_COMPOSER_GAP_ROWS = 1;

// ─── Types & constants ────────────────────────────────────────────────────────

type AppShellLayout = TerminalViewport;
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
  runtimeStatusBar?: React.ReactNode;
  runtimeStatusRows?: number;
  composer: React.ReactNode;
  composerRows: number;
  panelHint?: React.ReactNode;
  verboseMode?: boolean;
  mouseCapture?: boolean;
  onMouseActivity?: () => void;
  selectionProfile?: TerminalSelectionProfile;
  clearCount?: number;
  headerConfig?: HeaderConfig;
  updateAvailable?: UpdateAvailableInfo | null;
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

function CrampedView({ layout }: { layout: Layout }) {
  const theme = useTheme();
  return (
    <Box
      flexDirection="column"
      width="100%"
      height={getShellHeight(layout.rows)}
      alignItems="center"
      justifyContent="center"
    >
      <Box borderStyle="round" borderColor={theme.error} paddingX={2} paddingY={1}>
        <Text color={theme.error} bold>
          Terminal too small — resize to at least {MIN_TERMINAL_COLS} x {MIN_TERMINAL_ROWS}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Current: {layout.cols} x {layout.rows}
        </Text>
      </Box>
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
  runtimeStatusBar,
  runtimeStatusRows = 0,
  composer,
  composerRows,
  panelHint,
  verboseMode = false,
  mouseCapture = false,
  onMouseActivity,
  selectionProfile,
  clearCount = 0,
  headerConfig = HEADER_CONFIG_DEFAULTS,
  updateAvailable = null,
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

  if (layout.isCramped && !mouseCapture) {
    return <CrampedView layout={layout} />;
  }

  const shellWidth = getShellWidth(layout.cols);
  const shellHeight = getShellHeight(layout.rows);
  const headerRows = measureTopHeaderRows(layout, headerConfig, !!updateAvailable);
  const headerToContentGapRows = calculateHeaderToContentGapRows(layout);
  const showComposer = true;
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
    nativePausedRef.current = nativePaused;
  }, [nativePaused]);

  useEffect(() => {
    const handleRawInput = (chunk: Buffer | string) => {
      if (!showTimeline || !isBusy(uiState)) return;
      const raw = typeof chunk === "string" ? chunk : chunk.toString();
      const actions = parseTimelineNavigationInput(raw);
      if (actions.length === 0) return;

      if (actions.some((action) => action === "pageUp" || action === "home" || action === "wheelUp")) {
        setNativePaused(true);
      } else if (actions.some((action) => action === "pageDown" || action === "end" || action === "wheelDown")) {
        setNativePaused(false);
      }
    };

    if (stdin.isTTY) {
      stdin.on("data", handleRawInput);
      return () => {
        stdin.off("data", handleRawInput);
      };
    }
  }, [stdin, uiState, showTimeline]);

  // Auto-unpause when busy state ends.
  useEffect(() => {
    if (!isBusy(uiState) && nativePaused) {
      setNativePaused(false);
    }
  }, [uiState, nativePaused]);

  // ── End native mode scroll-pause state ────────────────────────────────────

  const effectiveShowComposer = showComposer;
  const effectiveComposerRows = effectiveShowComposer ? composerRows : 0;
  const effectiveRuntimeStatusRows = runtimeStatusBar ? runtimeStatusRows : 0;
  const panelHintRows = showPanelStage && panelHint ? 2 : 0;
  const canUseColdStartGap = effectiveShowComposer && !hasUserPrompt && screen === "main" && !showMainPanel;

  // Timeline/panel owns all vertical space between the live header and fixed composer.
  const coldStartAvailableRows = Math.max(
    0,
    shellHeight - headerRows - headerToContentGapRows - effectiveRuntimeStatusRows - effectiveComposerRows - panelHintRows - 2,
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
    - effectiveRuntimeStatusRows
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

    if (!showTimeline) {
      return { ...parts, liveRows: [] };
    }

    return parts;
  }, [activeEvents, finalShellWidth, mouseCapture, showTimeline, staticEvents, uiState, verboseMode, workspaceRoot]);

  const nativeStaticTranscriptRows = useMemo(
    () => nativeTranscriptParts.staticItems.reduce((total, item) => total + item.rows.length, 0),
    [nativeTranscriptParts.staticItems],
  );
  const nativeSpacerRows = useMemo(() => {
    if (mouseCapture || !effectiveShowComposer || showMainPanel) return 0;
    const rows = calculateNativeSpacerRows({
      shellRows: finalShellHeight,
      introRows: headerRows + headerToContentGapRows,
      composerRows: effectiveComposerRows + effectiveRuntimeStatusRows,
      staticRows: nativeStaticTranscriptRows,
      liveRows: nativeTranscriptParts.liveRows.length,
    });
    if (!hasUserPrompt) {
      return calculateColdStartSpacerRows({
        shellRows: finalShellHeight,
        headerRows,
        composerRows: effectiveComposerRows + effectiveRuntimeStatusRows,
        layoutMode: layout.mode,
        availableRows: rows,
      });
    }
    return rows;
  }, [mouseCapture, effectiveShowComposer, showMainPanel, finalShellHeight, headerRows, headerToContentGapRows, effectiveComposerRows, effectiveRuntimeStatusRows, layout.mode, nativeStaticTranscriptRows, nativeTranscriptParts.liveRows.length, hasUserPrompt]);

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

      const allStaticRows = nativeStaticAllItems.flatMap((item) => item.rows);
      const maxStaticRows = finalShellHeight > 0 ? finalShellHeight * 2 : allStaticRows.length;
      const trimmedStaticRows = allStaticRows.slice(Math.max(0, allStaticRows.length - maxStaticRows));

      const liveRows = showTimeline ? nativeTranscriptParts.liveRows : [];

      if (nativePaused) {
        return frozenNativeRowsRef.current;
      }

      const rows = [
        ...trimmedStaticRows,
        ...liveRows,
      ];
      frozenLiveRowCountRef.current = liveRows.length;
      frozenNativeRowsRef.current = rows;
      return rows;
    },
    [mouseCapture, nativePaused, nativeStaticAllItems, nativeTranscriptParts.liveRows, showTimeline, finalShellHeight],
  );

  const nativeUnseenRows = nativePaused
    ? Math.max(0, (showTimeline ? nativeTranscriptParts.liveRows.length : 0) - frozenLiveRowCountRef.current)
    : 0;

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
  }, [calculatedTimelineRowsRaw, effectiveComposerRows, effectiveRuntimeStatusRows, finalShellHeight, finalShellWidth, showComposer, showMainPanelFullOutput, showTimeline, finalTimelineRows]);

  const clonedComposer = React.isValidElement(composer)
    ? React.cloneElement(composer as React.ReactElement<{ selectionProfile?: TerminalSelectionProfile }>, { selectionProfile })
    : composer;

  const contentWidth = layout.contentWidth;

  const mainContent = (
    <Box flexDirection="column" width={contentWidth} height="100%">
      <MemoizedTopHeader
        authState={authState}
        workspaceLabel={workspaceLabel}
        layout={layout}
        runtimeSummary={runtimeSummary}
        headerConfig={headerConfig}
        updateAvailable={updateAvailable}
      />

      {headerToContentGapRows > 0 && (
        <Box height={headerToContentGapRows} />
      )}

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

      {showPanelStage && panelHint}

      {runtimeStatusBar && (
        <Box flexDirection="column" flexShrink={0} height={effectiveRuntimeStatusRows}>
          {runtimeStatusBar}
        </Box>
      )}

      {effectiveShowComposer && (
        <Box flexDirection="column" flexShrink={0}>
          {nativePaused && (
            <NativePauseBar unseenRows={nativeUnseenRows} />
          )}
          {clonedComposer}
        </Box>
      )}
    </Box>
  );

  if (showMainPanelFullOutput) {
    const fullOutputContent = (
      <Box flexDirection="column" width={contentWidth}>
        <MemoizedTopHeader
          authState={authState}
          workspaceLabel={workspaceLabel}
          layout={layout}
          runtimeSummary={runtimeSummary}
          headerConfig={headerConfig}
          updateAvailable={updateAvailable}
        />

        {headerToContentGapRows > 0 && (
          <Box height={headerToContentGapRows} />
        )}

        {mainPanel}

        {runtimeStatusBar && (
          <Box flexDirection="column" flexShrink={0} height={effectiveRuntimeStatusRows}>
            {runtimeStatusBar}
          </Box>
        )}

        {showComposer && (
          <Box flexDirection="column" flexShrink={0}>
            {composer}
          </Box>
        )}
      </Box>
    );

    if (shellWidth > contentWidth) {
      return (
        <Box flexDirection="column" width="100%" alignItems="center">
          {fullOutputContent}
        </Box>
      );
    }
    return fullOutputContent;
  }

  if (shellWidth > contentWidth) {
    return (
      <Box flexDirection="column" width="100%" height={finalShellHeight} alignItems="center">
        {mainContent}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%" height={finalShellHeight}>
      {mainContent}
    </Box>
  );
}

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
    prev.runtimeStatusBar === next.runtimeStatusBar &&
    prev.runtimeStatusRows === next.runtimeStatusRows &&
    prev.composer        === next.composer        &&
    prev.mainPanel       === next.mainPanel       &&
    prev.mainPanelMode   === next.mainPanelMode   &&
    prev.verboseMode     === next.verboseMode     &&
    prev.mouseCapture    === next.mouseCapture    &&
    prev.onMouseActivity === next.onMouseActivity &&
    prev.clearCount      === next.clearCount      &&
    prev.updateAvailable === next.updateAvailable &&
    panelPropsEqual
  );
});
