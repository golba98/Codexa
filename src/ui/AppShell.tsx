import React, { memo, useEffect, useMemo, useRef } from "react";
import { Box } from "ink";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import type { Screen, TimelineEvent, UIState } from "../session/types.js";
import {
  getShellHeight,
  getShellWidth,
  type Layout,
} from "./layout.js";
import {
  buildActiveRenderItems,
  buildStaticRenderItems,
  buildTimelineItems,
  Timeline,
  TimelineRowView,
  type TimelineItem,
} from "./Timeline.js";
import { buildNativeTranscriptParts, type NativeTranscriptRowItem, type TimelineRow } from "./timelineMeasure.js";
import type { TerminalSelectionProfile } from "../core/terminal/terminalSelection.js";
import { MemoizedTopHeader, measureTopHeaderRows } from "./TopHeader.js";

// Small fixed spacer used before the first user prompt so the composer sits
// close to the logo without a disproportionate blank gap on cold start.
const COLD_START_SPACER_ROWS = 3;

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

function NativeRowsItem({ rows }: { rows: TimelineRow[] }) {
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <TimelineRowView key={row.key} row={row} />
      ))}
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
}: AppShellProps) {
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
  const headerRows = measureTopHeaderRows(layout);
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

  const effectiveShowComposer = showComposer;
  const effectiveComposerRows = effectiveShowComposer ? composerRows : 0;
  const panelHintRows = showPanelStage && panelHint ? 2 : 0;

  // Timeline/panel owns all vertical space between the live header and fixed composer.
  const calculatedTimelineRowsRaw = shellHeight - headerRows - effectiveComposerRows - panelHintRows;
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
      introRows: headerRows,
      composerRows: effectiveComposerRows,
      staticRows: nativeStaticTranscriptRows,
      liveRows: nativeTranscriptParts.liveRows.length,
    });
    // Before the user sends their first prompt, keep a small fixed gap so the
    // composer sits near the logo without a large blank area in between.
    // This cap persists across model/auth system events so the layout stays
    // stable after config changes on cold start.
    if (!hasUserPrompt) {
      return Math.min(rows, COLD_START_SPACER_ROWS);
    }
    return rows;
  }, [mouseCapture, effectiveShowComposer, showMainPanel, finalShellHeight, headerRows, effectiveComposerRows, nativeStaticTranscriptRows, nativeTranscriptParts.liveRows.length, hasUserPrompt]);

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
      return [
        ...nativeStaticAllItems.flatMap((item) => item.rows),
        ...(showTimeline ? nativeTranscriptParts.liveRows : []),
      ];
    },
    [mouseCapture, nativeStaticAllItems, nativeTranscriptParts.liveRows, showTimeline],
  );

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

  if (showMainPanelFullOutput) {
    return (
      <Box flexDirection="column" width="100%">
        <Box flexDirection="column" width={finalShellWidth}>
          <MemoizedTopHeader
            authState={authState}
            workspaceLabel={workspaceLabel}
            layout={layout}
            runtimeSummary={runtimeSummary}
          />

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
        />

        {nativeAllRows.length > 0 && (
          <NativeRowsItem rows={nativeAllRows} />
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
        />

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
    prev.clearCount      === next.clearCount      &&
    panelPropsEqual
  );
});
