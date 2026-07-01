import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { useTheme } from "./theme.js";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { HEADER_CONFIG_DEFAULTS, type HeaderConfig } from "../config/settings.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import type { Screen, TimelineEvent, UIState } from "../session/types.js";
import { isBusy } from "../session/types.js";
import {
  ActivePanelLayoutContext,
  type ActivePanelLayout,
  AppLayoutBudgetContext,
  computeAppLayoutBudget,
  getContentWidth,
  getShellHeight,
  getShellWidth,
  isCrampedTerminal,
  PanelAvailableRowsContext,
  type Layout,
  type LayoutMode,
  type PanelLayout,
  PanelLayoutContext,
  MIN_TERMINAL_COLS,
  MIN_TERMINAL_ROWS,
  type TerminalViewport,
} from "./layout.js";
import {
  buildActiveRenderItems,
  buildIntroRenderItem,
  buildStaticRenderItems,
  buildTimelineItems,
  createFollowTailViewport,
  endTimelineViewport,
  halfPageDownTimelineViewport,
  halfPageUpTimelineViewport,
  homeTimelineViewport,
  pageDownTimelineViewport,
  pageUpTimelineViewport,
  parseTimelineNavigationInput,
  reflowTimelineViewport,
  scrollTimelineViewport,
  selectTimelineRows,
  stepDownTimelineViewport,
  stepUpTimelineViewport,
  Timeline,
  TimelineRowView,
  type TimelineItem,
  type TimelineViewportState,
} from "./Timeline.js";
import { buildNativeTranscriptParts, type NativeTranscriptRowItem, type TimelineRow, type TimelineSnapshot } from "./timelineMeasure.js";
import type { TerminalSelectionProfile } from "../core/terminal/terminalSelection.js";
import { MemoizedTopHeader, measureTopHeaderRows, type UpdateAvailableInfo } from "./TopHeader.js";

const COMPACT_HEADER_TO_COMPOSER_GAP_ROWS = 1;
const MEDIUM_HEADER_TO_COMPOSER_GAP_ROWS = 1;
const TALL_HEADER_TO_COMPOSER_GAP_ROWS = 1;
const WHEEL_SCROLL_STEP = 3;
const MOUSE_CLICK_EVENT_PATTERN = /\u001b\[<(\d+);(\d+);(\d+)(?:;(\d+))?([Mm])/g;
const HOME_KEY_INPUTS = new Set(["\u001b[H", "\u001b[1~", "\u001bOH", "\u001b[1;5H", "\u001b[1;2H"]);
const END_KEY_INPUTS = new Set(["\u001b[F", "\u001b[4~", "\u001bOF", "\u001b[1;5F", "\u001b[1;2F"]);

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
  const preferredRows = layoutMode === "compact" || shellRows <= 18
    ? 1
    : shellRows >= 36
      ? TALL_HEADER_TO_COMPOSER_GAP_ROWS
      : shellRows >= 28
        ? MEDIUM_HEADER_TO_COMPOSER_GAP_ROWS
        : COMPACT_HEADER_TO_COMPOSER_GAP_ROWS;

  return Math.max(0, Math.min(availableRows, rowsAfterHeaderAndComposer, preferredRows));
}

export function calculateHeaderToContentGapRows(layout: Layout): number {
  if (layout.mode === "compact" || layout.rows <= 18) return 0;
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

function BackToBottomBar({ unseenRows }: { unseenRows: number }) {
  const theme = useTheme();
  return (
    <Box width="100%" paddingX={1}>
      <Text color={theme.info}>
        {unseenRows > 0
          ? `↓  Back to bottom (${unseenRows} new rows) · End`
          : "↓  Back to bottom · End"}
      </Text>
    </Box>
  );
}

function rowItemsToSnapshot(items: NativeStaticItem[], liveRows: TimelineRow[]): TimelineSnapshot {
  const itemRows = items.map((item) => item.rows);
  const rows = [...itemRows.flat(), ...liveRows];
  return {
    items: [
      ...items.map((item) => ({
        key: item.key,
        rows: item.rows,
        rowCount: item.rows.length,
      })),
      ...(liveRows.length > 0 ? [{
        key: "live",
        rows: liveRows,
        rowCount: liveRows.length,
      }] : []),
    ],
    rows,
    totalRows: rows.length,
    itemCount: items.length + (liveRows.length > 0 ? 1 : 0),
  };
}

function hasBackToBottomClick(raw: string, viewportRows: number): boolean {
  for (const match of raw.matchAll(MOUSE_CLICK_EVENT_PATTERN)) {
    const code = Number.parseInt(match[1] ?? "", 10);
    const y = Number.parseInt(match[3] ?? "", 10);
    const terminator = match[5];
    if (terminator !== "M" || Number.isNaN(code) || Number.isNaN(y)) {
      continue;
    }
    const isWheel = (code & 64) === 64;
    const isRelease = (code & 3) === 3;
    if (!isWheel && !isRelease && y >= Math.max(1, viewportRows)) {
      return true;
    }
  }
  return false;
}

function isHomeInput(input: string): boolean {
  return HOME_KEY_INPUTS.has(input);
}

function isEndInput(input: string): boolean {
  return END_KEY_INPUTS.has(input);
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

function injectPanelLayout(
  element: React.ReactNode,
  availableRows: number,
  activePanelLayout: ActivePanelLayout,
  panelLayout: PanelLayout
): React.ReactNode {
  if (!React.isValidElement(element)) {
    return element;
  }
  if (element.type === React.Fragment) {
    const fragment = element as React.ReactElement<{ children?: React.ReactNode }>;
    return React.cloneElement(
      fragment,
      fragment.props,
      React.Children.map(fragment.props.children, (child) =>
        injectPanelLayout(child, availableRows, activePanelLayout, panelLayout)
      )
    );
  }
  return React.cloneElement(
    element as React.ReactElement<{
      availableRows?: number;
      activePanelLayout?: ActivePanelLayout;
      panelLayout?: PanelLayout;
    }>,
    { availableRows, activePanelLayout, panelLayout }
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

  // ── Main-chat scrollback state ────────────────────────────────────────────
  // The main chat has two modes:
  // - follow-tail: live bottom chrome is visible and focused.
  // - detached: the transcript viewport owns the screen; only Back to bottom stays visible.
  const [scrollbackViewport, setScrollbackViewport] = useState<TimelineViewportState>(() => createFollowTailViewport(0));
  const scrollbackSnapshotRef = useRef<TimelineSnapshot>({ items: [], rows: [], totalRows: 0, itemCount: 0 });
  const scrollbackRowsRef = useRef(1);
  const snapshotWidthRef = useRef(shellWidth);
  const { stdin } = useStdin();

  useEffect(() => {
    const handleRawInput = (chunk: Buffer | string) => {
      if (!showTimeline) return;
      const raw = typeof chunk === "string" ? chunk : chunk.toString();
      const actions = parseTimelineNavigationInput(raw);
      const snapshot = scrollbackSnapshotRef.current;
      if (snapshot.totalRows === 0) return;

      if (hasBackToBottomClick(raw, scrollbackRowsRef.current) || actions.includes("end")) {
        setScrollbackViewport(endTimelineViewport(snapshot.totalRows));
        return;
      }

      if (actions.length === 0) {
        return;
      }

      setScrollbackViewport((current) => {
        let next = current;
        for (const action of actions) {
          if (action === "pageUp") {
            next = pageUpTimelineViewport(next, snapshot, scrollbackRowsRef.current);
          } else if (action === "pageDown") {
            next = pageDownTimelineViewport(next, snapshot, scrollbackRowsRef.current);
          } else if (action === "home") {
            next = homeTimelineViewport(next, snapshot, scrollbackRowsRef.current);
          } else if (action === "wheelUp") {
            next = scrollTimelineViewport(next, snapshot, scrollbackRowsRef.current, -WHEEL_SCROLL_STEP);
          } else if (action === "wheelDown") {
            next = scrollTimelineViewport(next, snapshot, scrollbackRowsRef.current, WHEEL_SCROLL_STEP);
          }
        }
        return next;
      });
    };

    if (stdin.isTTY) {
      stdin.on("data", handleRawInput);
      return () => {
        stdin.off("data", handleRawInput);
      };
    }
  }, [stdin, showTimeline]);

  useInput((input, key) => {
    if (!showTimeline) return;
    const snapshot = scrollbackSnapshotRef.current;
    if (snapshot.totalRows === 0) return;

    if (key.end || isEndInput(input)) {
      setScrollbackViewport(endTimelineViewport(snapshot.totalRows));
      return;
    }

    if (key.pageUp) {
      setScrollbackViewport((current) => pageUpTimelineViewport(current, snapshot, scrollbackRowsRef.current));
      return;
    }

    if (key.pageDown) {
      setScrollbackViewport((current) => pageDownTimelineViewport(current, snapshot, scrollbackRowsRef.current));
      return;
    }

    if (key.ctrl && input === "u") {
      setScrollbackViewport((current) => halfPageUpTimelineViewport(current, snapshot, scrollbackRowsRef.current));
      return;
    }

    if (key.ctrl && input === "d") {
      setScrollbackViewport((current) => halfPageDownTimelineViewport(current, snapshot, scrollbackRowsRef.current));
      return;
    }

    if ((key.meta && key.upArrow) || input === "\u001b\u001b[A" || input === "\u001b[1;3A") {
      setScrollbackViewport((current) => stepUpTimelineViewport(current, snapshot, scrollbackRowsRef.current));
      return;
    }

    if ((key.meta && key.downArrow) || input === "\u001b\u001b[B" || input === "\u001b[1;3B") {
      setScrollbackViewport((current) => stepDownTimelineViewport(current, snapshot, scrollbackRowsRef.current));
      return;
    }

    if (key.home || isHomeInput(input)) {
      setScrollbackViewport((current) => homeTimelineViewport(current, snapshot, scrollbackRowsRef.current));
    }
  });

  // ── End main-chat scrollback state ────────────────────────────────────────

  const effectiveShowComposer = showComposer;
  const panelHintRows = showPanelStage && panelHint ? 2 : 0;

  // ─── App Layout Budget ────────────────────────────────────────────────────

  const appLayoutBudget = computeAppLayoutBudget({
    cols: layout.cols,
    rows: layout.rows,
    composerRows,
    panelHintRows,
    headerRows,
  });

  const headerToContentGapRows = appLayoutBudget.headerGapRows;
  const effectiveComposerRows = appLayoutBudget.composerRows;
  const bottomChromeRows = appLayoutBudget.bottomChromeBudget.totalRows;

  const finalTimelineRows = appLayoutBudget.transcriptRows;
  const finalShellHeight = shellHeight;
  const finalShellWidth = shellWidth;

  const { finalTimelineRows: resolvedTimelineRows } = useMemo(() => {
    const prev = previousMeasurements.current;
    const isValid = shellHeight > 0
      && shellWidth > 0
      && Number.isFinite(shellHeight)
      && Number.isFinite(shellWidth)
      && Number.isFinite(finalTimelineRows)
      && finalTimelineRows >= 2;

    if (!isValid && prev) {
      return {
        finalTimelineRows: prev.timelineRows,
      };
    }

    return {
      finalTimelineRows: Math.max(2, finalTimelineRows),
    };
  }, [shellHeight, shellWidth, finalTimelineRows]);

  // ─── Main-chat scrollback transcript ─────────────────────────────────────

  const nativeTranscriptParts = useMemo(() => {
    const staticItems = buildTimelineItems(staticEvents);
    const activeItems = buildTimelineItems(activeEvents);
    const turnIds = [...staticItems, ...activeItems]
      .filter((item): item is Extract<TimelineItem, { type: "turn" }> => item.type === "turn")
      .map((item) => item.turnId);

    const parts = buildNativeTranscriptParts(
      [
        buildIntroRenderItem({ authState, workspaceLabel, layout }),
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
  }, [activeEvents, authState, finalShellWidth, layout, showTimeline, staticEvents, uiState, verboseMode, workspaceLabel, workspaceRoot]);

  // ─── Spacer logic for native mode ─────────────────────────────────────────

  const nativeStaticTranscriptRows = useMemo(
    () => nativeTranscriptParts.staticItems.reduce((total, item) => total + item.rows.length, 0),
    [nativeTranscriptParts.staticItems],
  );

  const nativeSpacerRows = useMemo(() => {
    if (!effectiveShowComposer || showMainPanel) return 0;
    const rows = calculateNativeSpacerRows({
      shellRows: finalShellHeight,
      introRows: headerRows + headerToContentGapRows,
      composerRows: bottomChromeRows,
      staticRows: nativeStaticTranscriptRows,
      liveRows: nativeTranscriptParts.liveRows.length,
    });
    if (!hasUserPrompt) {
      return calculateColdStartSpacerRows({
        shellRows: finalShellHeight,
        headerRows,
        composerRows: bottomChromeRows,
        layoutMode: layout.mode,
        availableRows: rows,
      });
    }
    return rows;
  }, [effectiveShowComposer, showMainPanel, finalShellHeight, headerRows, headerToContentGapRows, bottomChromeRows, layout.mode, nativeStaticTranscriptRows, nativeTranscriptParts.liveRows.length, hasUserPrompt]);

  const nativeStaticAllItems = useMemo<NativeStaticItem[]>(
    () => {
      return nativeTranscriptParts.staticItems.map((item) => ({ ...item, type: "rows" as const }));
    },
    [nativeTranscriptParts.staticItems],
  );

  const nativeAllRows = useMemo<TimelineRow[]>(
    () => {
      const allStaticRows = nativeStaticAllItems.flatMap((item) => item.rows);
      const liveRows = showTimeline ? nativeTranscriptParts.liveRows : [];
      const rows = [
        ...allStaticRows,
        ...liveRows,
      ];
      return rows;
    },
    [nativeStaticAllItems, nativeTranscriptParts.liveRows, showTimeline],
  );

  const scrollbackSnapshot = useMemo(
    () => rowItemsToSnapshot(nativeStaticAllItems, showTimeline ? nativeTranscriptParts.liveRows : []),
    [nativeStaticAllItems, nativeTranscriptParts.liveRows, showTimeline],
  );
  const scrollbackViewportRows = Math.max(1, finalShellHeight - 1);

  useEffect(() => {
    scrollbackSnapshotRef.current = scrollbackSnapshot;
  }, [scrollbackSnapshot]);

  useEffect(() => {
    scrollbackRowsRef.current = scrollbackViewportRows;
  }, [scrollbackViewportRows]);

  useEffect(() => {
    setScrollbackViewport(createFollowTailViewport(scrollbackSnapshot.totalRows));
  }, [clearCount, scrollbackSnapshot.totalRows]);

  useEffect(() => {
    const widthChanged = snapshotWidthRef.current !== finalShellWidth;
    snapshotWidthRef.current = finalShellWidth;
    setScrollbackViewport((current) => {
      if (widthChanged && !current.followTail) {
        return reflowTimelineViewport(current, scrollbackSnapshot);
      }
      return current.followTail
        ? createFollowTailViewport(scrollbackSnapshot.totalRows)
        : current;
    });
  }, [finalShellWidth, scrollbackSnapshot]);

  const { visibleRows: scrollbackVisibleRows, sourceSnapshot: scrollbackSourceSnapshot } = useMemo(
    () => selectTimelineRows(scrollbackSnapshot, scrollbackViewport, scrollbackViewportRows),
    [scrollbackSnapshot, scrollbackViewport, scrollbackViewportRows],
  );

  const isAtBottom = scrollbackViewport.followTail;
  const showScrollbackMode = showTimeline && !isAtBottom;
  const nativeUnseenRows = showScrollbackMode
    ? Math.max(0, scrollbackSnapshot.totalRows - scrollbackSourceSnapshot.totalRows)
    : 0;

  useEffect(() => {
    previousMeasurements.current = {
      timelineRows: resolvedTimelineRows,
      composerRows: bottomChromeRows,
      shellHeight: finalShellHeight,
      shellWidth: finalShellWidth,
    };
  }, [resolvedTimelineRows, bottomChromeRows, finalShellHeight, finalShellWidth]);

  const clonedComposer = React.isValidElement(composer)
    ? React.cloneElement(
      composer as React.ReactElement<{ selectionProfile?: TerminalSelectionProfile }>,
      { selectionProfile },
    )
    : composer;

  const contentWidth = getContentWidth(layout.cols);
  const panelStagePaddingY = appLayoutBudget.panelStagePaddingY;

  const panelAvailableRows = appLayoutBudget.panelRows;

  const activePanelLayout = useMemo<ActivePanelLayout>(() => {
    const panelBoxHeight = Math.max(3, resolvedTimelineRows - 2 * panelStagePaddingY);
    const showBorder = panelBoxHeight >= 7;
    const borderRows = showBorder ? 2 : 0;
    const borderCols = showBorder ? 4 : 0;
    const panelTitleRows = showBorder ? 1 : 0;
    const panelHeaderRows = panelBoxHeight >= 9 ? 1 : 0;
    const panelChromeRows = borderRows + panelTitleRows + panelHeaderRows;

    const availableRows = Math.max(1, panelBoxHeight - panelChromeRows);
    const availableCols = Math.max(20, contentWidth - borderCols);

    return {
      width: contentWidth,
      height: panelBoxHeight,
      availableRows,
      availableCols,
    };
  }, [resolvedTimelineRows, panelStagePaddingY, contentWidth]);

  const panelLayout = useMemo<PanelLayout>(() => {
    return {
      mode: appLayoutBudget.mode,
      availableRows: appLayoutBudget.activePanelRows,
      availableCols: appLayoutBudget.activePanelCols,
    };
  }, [appLayoutBudget.mode, appLayoutBudget.activePanelRows, appLayoutBudget.activePanelCols]);

  if (showScrollbackMode) {
    const rowsForDisplay = scrollbackVisibleRows.slice(0, Math.max(0, scrollbackViewportRows - 1));
    const scrollbackContent = (
      <Box flexDirection="column" width={contentWidth} height={finalShellHeight}>
        <Box flexDirection="column" height={Math.max(1, finalShellHeight - 1)} overflow="hidden">
          <NativeRowsItem rows={rowsForDisplay} />
        </Box>
        <BackToBottomBar unseenRows={nativeUnseenRows} />
      </Box>
    );

    if (shellWidth > contentWidth) {
      return (
        <Box flexDirection="column" width="100%" height={finalShellHeight} alignItems="center">
          {scrollbackContent}
        </Box>
      );
    }

    return (
      <Box flexDirection="column" width="100%" height={finalShellHeight}>
        {scrollbackContent}
      </Box>
    );
  }

  const mainContent = (
    <AppLayoutBudgetContext.Provider value={appLayoutBudget}>
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
        height={resolvedTimelineRows}
        overflow="hidden"
        display={showTimeline ? "flex" : "none"}
      >
        <Timeline
          key={`timeline-${clearCount}`}
          staticEvents={staticEvents}
          activeEvents={activeEvents}
          layout={layout}
          uiState={uiState}
          viewportRows={resolvedTimelineRows}
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
        <Box flexDirection="column" height={resolvedTimelineRows} overflow="hidden" justifyContent="center">
          {mainPanel}
        </Box>
      )}

      {showPanelStage && (
        <Box flexDirection="column" height={resolvedTimelineRows} overflow="hidden" paddingY={panelStagePaddingY}>
          <PanelAvailableRowsContext.Provider value={panelAvailableRows}>
            <ActivePanelLayoutContext.Provider value={activePanelLayout}>
              <PanelLayoutContext.Provider value={panelLayout}>
                {process.env.CODEXA_DEBUG_LAYOUT === "1" && (
                  <Box>
                    <Text color="red">
                      DEBUG layout: rows={layout.rows} cols={layout.cols} mode={layout.mode} headerRows={headerRows} panelRows={panelAvailableRows} bottomChromeRows={appLayoutBudget.bottomChromeBudget.totalRows}
                    </Text>
                  </Box>
                )}
                {injectPanelLayout(panel, panelAvailableRows, activePanelLayout, panelLayout)}
              </PanelLayoutContext.Provider>
            </ActivePanelLayoutContext.Provider>
          </PanelAvailableRowsContext.Provider>
        </Box>
      )}

      {showPanelStage && panelHint}

      {effectiveShowComposer && (
        <Box flexDirection="column" flexShrink={0}>
          {clonedComposer}
        </Box>
      )}
    </Box>
    </AppLayoutBudgetContext.Provider>
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
