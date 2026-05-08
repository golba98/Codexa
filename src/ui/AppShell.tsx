import React, { memo, useEffect, useMemo, useRef } from "react";
import { Box, Static } from "ink";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import type { Screen, TimelineEvent, UIState } from "../session/types.js";
import {
  getShellHeight,
  getShellWidth,
  resolveStartupHeaderMode,
  STARTUP_COMPACT_INTRO_ROWS,
  STARTUP_TINY_MESSAGE_ROWS,
  type Layout,
  type StartupHeaderMode,
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
import { buildStaticIntroRows, StaticIntroItem } from "./StaticIntroItem.js";

// Small fixed spacer used before the first user prompt so the composer sits
// close to the logo without a disproportionate blank gap on cold start.
const COLD_START_SPACER_ROWS = 3;

type AppShellLayout = Layout & { layoutEpoch?: number };
type NativeStaticItem =
  | { key: string; type: "session-intro" }
  | ({ type: "rows" } & NativeTranscriptRowItem);

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
}

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
  const showComposer = screen === "main";
  const showMainPanel = screen === "main" && mainPanel !== undefined && mainPanel !== null;
  const showMainPanelFullOutput = showMainPanel && mainPanelMode === "full-output";
  const showTimeline = screen === "main" && !showMainPanel;
  const showPanelStage = screen !== "main";
  const hasUserPrompt = useMemo(
    () => staticEvents.some((e) => e.type === "user") || activeEvents.some((e) => e.type === "user"),
    [staticEvents, activeEvents],
  );
  const isStartupFrame = screen === "main"
    && !showMainPanel
    && !hasUserPrompt;
  const previousMeasurements = useRef<{
    timelineRows: number;
    composerRows: number;
    shellHeight: number;
    shellWidth: number;
  } | null>(null);

  // Capture the very first render's props for the static intro.
  // Ink's <Static> will re-flush the item if the rendered output changes.
  // By freezing these props, we ensure the intro is truly session-static
  // and doesn't replay when authState or layout changes later.
  const initialIntroRef = useRef<{
    authState: CodexAuthState;
    workspaceLabel: string;
    layout: Layout;
    startupHeaderMode: StartupHeaderMode;
    verboseMode: boolean;
    workspaceRoot: string | null;
  } | null>(null);
  const provisionalFullIntroRows = useMemo(
    () => buildStaticIntroRows({
      authState,
      workspaceLabel,
      layout,
      startupHeaderMode: "large",
      verboseMode,
      workspaceRoot: workspaceRoot ?? null,
    }).length,
    [authState, layout, verboseMode, workspaceLabel, workspaceRoot],
  );
  const liveStartupHeaderMode = resolveStartupHeaderMode({
    cols: layout.cols,
    rows: layout.rows,
    introRows: provisionalFullIntroRows,
    composerRows,
  });
  if (!initialIntroRef.current) {
    initialIntroRef.current = {
      authState,
      workspaceLabel,
      layout,
      startupHeaderMode: liveStartupHeaderMode,
      verboseMode,
      workspaceRoot: workspaceRoot ?? null,
    };
  }

  // Compute the intro block's row count once, using the frozen startup layout.
  // This is used below to anchor the composer at the terminal bottom in native mode.
  const introRowCountRef = useRef<number | null>(null);
  if (introRowCountRef.current === null && !mouseCapture && initialIntroRef.current) {
    introRowCountRef.current = buildStaticIntroRows(initialIntroRef.current).length;
  }
  const frozenStartupHeaderMode = initialIntroRef.current?.startupHeaderMode ?? liveStartupHeaderMode;
  const startupHeaderMode = isStartupFrame ? liveStartupHeaderMode : frozenStartupHeaderMode;
  const isTinyStartup = isStartupFrame && startupHeaderMode === "tiny";
  const effectiveShowComposer = showComposer && !isTinyStartup;
  const effectiveComposerRows = effectiveShowComposer ? composerRows : 0;
  const panelHintRows = showPanelStage && panelHint ? 2 : 0;
  const introRowCount = isStartupFrame
    ? startupHeaderMode === "tiny"
      ? STARTUP_TINY_MESSAGE_ROWS
      : startupHeaderMode === "compact"
        ? STARTUP_COMPACT_INTRO_ROWS
        : provisionalFullIntroRows
    : introRowCountRef.current ?? provisionalFullIntroRows;

  // Timeline owns all vertical space above the fixed composer.
  const calculatedTimelineRowsRaw = shellHeight - effectiveComposerRows;
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
    // but hide the live rows. This ensures the static array length remains
    // stable in Ink's <Static> component, preventing re-renders.
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
      introRows: introRowCount,
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
  }, [mouseCapture, effectiveShowComposer, showMainPanel, finalShellHeight, introRowCount, effectiveComposerRows, nativeStaticTranscriptRows, nativeTranscriptParts.liveRows.length, hasUserPrompt]);
  // Reserve space for the panel relative to committed static content so the
  // panel body never overflows the available dynamic area.
  const nativePanelBodyRows = Math.max(
    1,
    finalShellHeight - introRowCount - panelHintRows - nativeStaticTranscriptRows,
  );

  // In native mode (no SGR capture), stable rows go into Ink's <Static> as soon as they
  // are no longer changing. Only the current live action/response remains dynamic.
  const nativeStaticAllItems = useMemo<NativeStaticItem[]>(
    () =>
      mouseCapture
        ? []
        : [
          { key: "session-intro", type: "session-intro" as const },
          ...nativeTranscriptParts.staticItems.map((item) => ({ ...item, type: "rows" as const })),
        ],
    [mouseCapture, nativeTranscriptParts.staticItems],
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
    startupHeaderMode,
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

  if (showMainPanelFullOutput) {
    return (
      <Box flexDirection="column" width="100%">
        <Box flexDirection="column" width={finalShellWidth}>
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
  // Static history is printed once, while live rows only cover the currently changing event.
  //
  // All native-mode layouts share one unified return so that Ink's <Static> is always the
  // first child at the same JSX position, regardless of whether the app is on the startup
  // frame, a panel screen, or the main transcript view.  Keeping <Static> at a stable tree
  // position means React never unmounts it across state transitions; the component therefore
  // preserves its internal renderedCount and never re-emits session-intro or previously-
  // committed transcript rows — which was the root cause of the scrollback logo duplication.
  if (!mouseCapture) {
    return (
      <Box flexDirection="column" width={finalShellWidth}>
        <Static items={nativeStaticAllItems}>
          {(item) => {
            if (item.type === "session-intro") {
              const intro = initialIntroRef.current!;
              return (
                <StaticIntroItem
                  key="session-intro"
                  authState={intro.authState}
                  workspaceLabel={intro.workspaceLabel}
                  layout={intro.layout}
                  startupHeaderMode={intro.startupHeaderMode}
                  verboseMode={intro.verboseMode}
                  workspaceRoot={intro.workspaceRoot}
                />
              );
            }

            return (
              <NativeRowsItem key={item.key} rows={item.rows} />
            );
          }}
        </Static>

        {showTimeline && nativeTranscriptParts.liveRows.length > 0 && (
          <NativeRowsItem rows={nativeTranscriptParts.liveRows} />
        )}

        {showMainPanel && (
          <Box flexDirection="column" paddingY={1} justifyContent="center">
            {mainPanel}
          </Box>
        )}

        {showPanelStage && (
          <Box
            flexDirection="column"
            height={!hasUserPrompt ? undefined : nativePanelBodyRows}
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
        {showTimeline && (
          <Box flexDirection="column" height={finalTimelineRows} overflow="hidden">
            <Timeline
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
            />
          </Box>
        )}

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
            {composer}
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
    panelPropsEqual
  );
});
