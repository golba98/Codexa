import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import type {
  AssistantEvent,
  ErrorEvent,
  RunEvent,
  ShellEvent,
  SystemEvent,
  TimelineEvent,
  UIState,
  UserPromptEvent,
} from "../session/types.js";
import { getShellWidth, type Layout } from "./layout.js";
import type { TimelineRow, TimelineSnapshot, TimelineTone } from "./timelineMeasure.js";
import { buildTimelineSnapshot } from "./timelineMeasure.js";
import { resolveTurnRunPhase, type TurnOpacity, type TurnRunPhase } from "./TurnGroup.js";
import { useTheme } from "./theme.js";

interface TimelineProps {
  staticEvents: TimelineEvent[];
  activeEvents: TimelineEvent[];
  layout: Layout;
  uiState: UIState;
  viewportRows: number;
}

type StandaloneTimelineEvent = SystemEvent | ErrorEvent | ShellEvent;

interface TurnTimelineItem {
  type: "turn";
  turnId: number;
  turnIndex: number;
  user: UserPromptEvent | null;
  run: RunEvent | null;
  assistant: AssistantEvent | null;
}

interface EventTimelineItem {
  type: "event";
  event: StandaloneTimelineEvent;
}

export type TimelineItem = TurnTimelineItem | EventTimelineItem;

export interface TurnRenderState {
  opacity: TurnOpacity;
  question: string | null;
  runPhase: TurnRunPhase;
}

interface TurnRenderTimelineItem {
  key: string;
  type: "turn";
  padded: boolean;
  item: TurnTimelineItem;
  renderState: TurnRenderState;
}

interface EventRenderTimelineItem {
  key: string;
  type: "event";
  padded: boolean;
  event: StandaloneTimelineEvent;
}

export type RenderTimelineItem = TurnRenderTimelineItem | EventRenderTimelineItem;

const WHEEL_SCROLL_STEP = 3;
const HOME_KEY_INPUTS = new Set(["\u001b[H", "\u001b[1~", "\u001bOH"]);
const END_KEY_INPUTS = new Set(["\u001b[F", "\u001b[4~", "\u001bOF"]);
const SGR_WHEEL_EVENT_PATTERN = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/g;

export interface TimelineViewportState {
  anchorRow: number;
  followTail: boolean;
  unseenItems: number;
  unseenRows: number;
  frozenSnapshot: TimelineSnapshot | null;
}

function isStandaloneEvent(event: TimelineEvent): event is StandaloneTimelineEvent {
  return event.type === "system" || event.type === "error" || event.type === "shell";
}

function getActiveTurnId(uiState: UIState): number | null {
  return uiState.kind === "THINKING"
    || uiState.kind === "RESPONDING"
    || uiState.kind === "AWAITING_USER_ACTION"
    || uiState.kind === "ERROR"
    ? uiState.turnId
    : null;
}

function isHomeInput(input: string): boolean {
  return HOME_KEY_INPUTS.has(input);
}

function isEndInput(input: string): boolean {
  return END_KEY_INPUTS.has(input);
}

function clampAnchorRow(anchorRow: number, totalRows: number): number {
  if (totalRows <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(anchorRow, totalRows - 1));
}

function getFirstPageAnchor(totalRows: number, viewportRows: number): number {
  if (totalRows <= 0) {
    return 0;
  }
  return Math.min(totalRows - 1, Math.max(0, viewportRows - 1));
}

export function buildTimelineItems(events: TimelineEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const turns = new Map<number, TurnTimelineItem>();
  let nextTurnIndex = 1;

  for (const event of events) {
    if (isStandaloneEvent(event)) {
      items.push({ type: "event", event });
      continue;
    }

    const turnId = event.turnId;
    let turn = turns.get(turnId);
    if (!turn) {
      turn = {
        type: "turn",
        turnId,
        turnIndex: nextTurnIndex++,
        user: null,
        run: null,
        assistant: null,
      };
      turns.set(turnId, turn);
      items.push(turn);
    }

    if (event.type === "user") {
      turn.user = event;
    } else if (event.type === "run") {
      turn.run = event;
    } else if (event.type === "assistant") {
      turn.assistant = event;
    }
  }

  return items.filter((item) => item.type === "event" || item.user !== null);
}

export function resolveTurnOpacity(turnIds: number[], turnId: number, activeTurnId: number | null): TurnOpacity {
  if (turnIds.length === 0) return "dim";

  if (activeTurnId === null) {
    return turnId === turnIds[turnIds.length - 1] ? "recent" : "dim";
  }

  const activeIndex = turnIds.indexOf(activeTurnId);
  const currentIndex = turnIds.indexOf(turnId);
  if (currentIndex === activeIndex) return "active";
  if (currentIndex === activeIndex - 1) return "recent";
  return "dim";
}

export function createFollowTailViewport(totalRows: number): TimelineViewportState {
  return {
    anchorRow: Math.max(0, totalRows - 1),
    followTail: true,
    unseenItems: 0,
    unseenRows: 0,
    frozenSnapshot: null,
  };
}

function getFrozenSnapshot(
  viewport: TimelineViewportState,
  liveSnapshot: TimelineSnapshot,
): TimelineSnapshot {
  return viewport.followTail || viewport.frozenSnapshot === null
    ? liveSnapshot
    : viewport.frozenSnapshot;
}

export function syncTimelineViewport(
  viewport: TimelineViewportState,
  liveSnapshot: TimelineSnapshot,
): TimelineViewportState {
  if (liveSnapshot.totalRows === 0) {
    return createFollowTailViewport(0);
  }

  if (viewport.followTail) {
    const nextAnchor = liveSnapshot.totalRows - 1;
    if (
      viewport.anchorRow === nextAnchor
      && viewport.unseenItems === 0
      && viewport.unseenRows === 0
      && viewport.frozenSnapshot === null
    ) {
      return viewport;
    }
    return createFollowTailViewport(liveSnapshot.totalRows);
  }

  const frozenSnapshot = viewport.frozenSnapshot ?? liveSnapshot;
  const anchorRow = clampAnchorRow(viewport.anchorRow, frozenSnapshot.totalRows);
  const unseenItems = Math.max(0, liveSnapshot.itemCount - frozenSnapshot.itemCount);
  const unseenRows = Math.max(0, liveSnapshot.totalRows - frozenSnapshot.totalRows);

  if (
    viewport.anchorRow === anchorRow
    && viewport.unseenItems === unseenItems
    && viewport.unseenRows === unseenRows
    && viewport.frozenSnapshot === frozenSnapshot
  ) {
    return viewport;
  }

  return {
    anchorRow,
    followTail: false,
    unseenItems,
    unseenRows,
    frozenSnapshot,
  };
}

export function pageUpTimelineViewport(
  viewport: TimelineViewportState,
  liveSnapshot: TimelineSnapshot,
  viewportRows: number,
): TimelineViewportState {
  if (liveSnapshot.totalRows === 0) {
    return createFollowTailViewport(0);
  }

  const frozenSnapshot = getFrozenSnapshot(viewport, liveSnapshot);
  const tailRow = Math.max(0, frozenSnapshot.totalRows - 1);
  const currentAnchor = viewport.followTail
    ? tailRow
    : clampAnchorRow(viewport.anchorRow, frozenSnapshot.totalRows);
  const nextAnchor = Math.max(getFirstPageAnchor(frozenSnapshot.totalRows, viewportRows), currentAnchor - Math.max(1, viewportRows));

  return {
    anchorRow: nextAnchor,
    followTail: false,
    unseenItems: Math.max(0, liveSnapshot.itemCount - frozenSnapshot.itemCount),
    unseenRows: Math.max(0, liveSnapshot.totalRows - frozenSnapshot.totalRows),
    frozenSnapshot,
  };
}

export function pageDownTimelineViewport(
  viewport: TimelineViewportState,
  liveSnapshot: TimelineSnapshot,
  viewportRows: number,
): TimelineViewportState {
  if (liveSnapshot.totalRows === 0 || viewport.followTail) {
    return viewport;
  }

  const frozenSnapshot = viewport.frozenSnapshot ?? liveSnapshot;
  const tailRow = Math.max(0, frozenSnapshot.totalRows - 1);
  const currentAnchor = clampAnchorRow(viewport.anchorRow, frozenSnapshot.totalRows);
  if (currentAnchor >= tailRow) {
    return createFollowTailViewport(liveSnapshot.totalRows);
  }

  const nextAnchor = Math.min(tailRow, currentAnchor + Math.max(1, viewportRows));
  if (nextAnchor >= tailRow) {
    return createFollowTailViewport(liveSnapshot.totalRows);
  }

  return {
    anchorRow: nextAnchor,
    followTail: false,
    unseenItems: Math.max(0, liveSnapshot.itemCount - frozenSnapshot.itemCount),
    unseenRows: Math.max(0, liveSnapshot.totalRows - frozenSnapshot.totalRows),
    frozenSnapshot,
  };
}

export function stepUpTimelineViewport(
  viewport: TimelineViewportState,
  liveSnapshot: TimelineSnapshot,
  viewportRows: number,
): TimelineViewportState {
  if (liveSnapshot.totalRows === 0) {
    return createFollowTailViewport(0);
  }

  const frozenSnapshot = getFrozenSnapshot(viewport, liveSnapshot);
  const tailRow = Math.max(0, frozenSnapshot.totalRows - 1);
  const currentAnchor = viewport.followTail
    ? tailRow
    : clampAnchorRow(viewport.anchorRow, frozenSnapshot.totalRows);
  const floor = getFirstPageAnchor(frozenSnapshot.totalRows, viewportRows);

  return {
    anchorRow: Math.max(floor, currentAnchor - 1),
    followTail: false,
    unseenItems: Math.max(0, liveSnapshot.itemCount - frozenSnapshot.itemCount),
    unseenRows: Math.max(0, liveSnapshot.totalRows - frozenSnapshot.totalRows),
    frozenSnapshot,
  };
}

export function stepDownTimelineViewport(
  viewport: TimelineViewportState,
  liveSnapshot: TimelineSnapshot,
  _viewportRows?: number,
): TimelineViewportState {
  if (liveSnapshot.totalRows === 0 || viewport.followTail) {
    return viewport;
  }

  const frozenSnapshot = viewport.frozenSnapshot ?? liveSnapshot;
  const tailRow = Math.max(0, frozenSnapshot.totalRows - 1);
  const currentAnchor = clampAnchorRow(viewport.anchorRow, frozenSnapshot.totalRows);
  if (currentAnchor >= tailRow) {
    return createFollowTailViewport(liveSnapshot.totalRows);
  }

  const nextAnchor = Math.min(tailRow, currentAnchor + 1);
  if (nextAnchor >= tailRow) {
    return createFollowTailViewport(liveSnapshot.totalRows);
  }

  return {
    anchorRow: nextAnchor,
    followTail: false,
    unseenItems: Math.max(0, liveSnapshot.itemCount - frozenSnapshot.itemCount),
    unseenRows: Math.max(0, liveSnapshot.totalRows - frozenSnapshot.totalRows),
    frozenSnapshot,
  };
}

export function homeTimelineViewport(
  viewport: TimelineViewportState,
  liveSnapshot: TimelineSnapshot,
  viewportRows: number,
): TimelineViewportState {
  if (liveSnapshot.totalRows === 0) {
    return createFollowTailViewport(0);
  }

  const frozenSnapshot = getFrozenSnapshot(viewport, liveSnapshot);
  return {
    anchorRow: getFirstPageAnchor(frozenSnapshot.totalRows, viewportRows),
    followTail: false,
    unseenItems: Math.max(0, liveSnapshot.itemCount - frozenSnapshot.itemCount),
    unseenRows: Math.max(0, liveSnapshot.totalRows - frozenSnapshot.totalRows),
    frozenSnapshot,
  };
}

export function endTimelineViewport(totalRows: number): TimelineViewportState {
  return createFollowTailViewport(totalRows);
}

export function parseWheelScrollDirections(raw: string): Array<"up" | "down"> {
  const directions: Array<"up" | "down"> = [];

  for (const match of raw.matchAll(SGR_WHEEL_EVENT_PATTERN)) {
    const code = Number.parseInt(match[1] ?? "", 10);
    const terminator = match[4];
    if (terminator !== "M" || Number.isNaN(code) || (code & 64) !== 64) {
      continue;
    }

    directions.push((code & 1) === 0 ? "up" : "down");
  }

  return directions;
}

export function selectTimelineRows(
  liveSnapshot: TimelineSnapshot,
  viewport: TimelineViewportState,
  viewportRows: number,
): {
  sourceSnapshot: TimelineSnapshot;
  visibleRows: TimelineRow[];
  window: {
    startRow: number;
    endRow: number;
    anchorRow: number;
  };
} {
  const sourceSnapshot = viewport.followTail || viewport.frozenSnapshot === null
    ? liveSnapshot
    : viewport.frozenSnapshot;
  const safeViewportRows = Math.max(1, viewportRows);

  if (sourceSnapshot.totalRows === 0) {
    return {
      sourceSnapshot,
      visibleRows: [],
      window: { startRow: 0, endRow: 0, anchorRow: 0 },
    };
  }

  const anchorRow = viewport.followTail
    ? sourceSnapshot.totalRows - 1
    : clampAnchorRow(viewport.anchorRow, sourceSnapshot.totalRows);
  const endRow = anchorRow + 1;
  const startRow = Math.max(0, endRow - safeViewportRows);

  return {
    sourceSnapshot,
    visibleRows: sourceSnapshot.rows.slice(startRow, endRow),
    window: {
      startRow,
      endRow,
      anchorRow,
    },
  };
}

export function buildStaticRenderItems(
  items: TimelineItem[],
  turnIds: number[],
  activeTurnId: number | null,
  questionTurnId: number | null,
  question: string | null,
): RenderTimelineItem[] {
  return items.map((item) => {
    if (item.type === "event") {
      return {
        key: `event-${item.event.id}`,
        type: "event",
        padded: false,
        event: item.event,
      };
    }

    return {
      key: `turn-${item.turnId}`,
      type: "turn",
      padded: false,
      item,
      renderState: {
        opacity: resolveTurnOpacity(turnIds, item.turnId, activeTurnId),
        question: questionTurnId === item.turnId ? question : null,
        runPhase: resolveTurnRunPhase(item.run, item.assistant, { kind: "IDLE" }, item.turnId),
      },
    };
  });
}

export function buildActiveRenderItems(
  items: TimelineItem[],
  turnIds: number[],
  uiState: UIState,
): RenderTimelineItem[] {
  const activeTurnId = getActiveTurnId(uiState);
  const questionTurnId = uiState.kind === "AWAITING_USER_ACTION" ? uiState.turnId : null;
  const question = uiState.kind === "AWAITING_USER_ACTION" ? uiState.question : null;

  return items.map((item) => {
    if (item.type === "event") {
      return {
        key: `event-${item.event.id}`,
        type: "event",
        padded: true,
        event: item.event,
      };
    }

    return {
      key: `turn-${item.turnId}`,
      type: "turn",
      padded: true,
      item,
      renderState: {
        opacity: resolveTurnOpacity(turnIds, item.turnId, activeTurnId),
        question: questionTurnId === item.turnId ? question : null,
        runPhase: resolveTurnRunPhase(item.run, item.assistant, uiState, item.turnId),
      },
    };
  });
}

function getToneColor(theme: ReturnType<typeof useTheme>, tone: TimelineTone | undefined): string | undefined {
  switch (tone) {
    case "text": return theme.TEXT;
    case "dim": return theme.DIM;
    case "muted": return theme.MUTED;
    case "accent": return theme.ACCENT;
    case "info": return theme.INFO;
    case "error": return theme.ERROR;
    case "warning": return theme.WARNING;
    case "success": return theme.SUCCESS;
    case "borderSubtle": return theme.BORDER_SUBTLE;
    case "borderActive": return theme.BORDER_ACTIVE;
    case "panel": return theme.PANEL;
    case "star": return theme.STAR;
    default: return undefined;
  }
}

function TimelineRowView({ row }: { row: TimelineRow }) {
  const theme = useTheme();

  return (
    <Box width="100%" overflow="hidden">
      <Text>
        {row.spans.map((span, index) => (
          <Text
            key={index}
            color={getToneColor(theme, span.tone)}
            backgroundColor={getToneColor(theme, span.backgroundTone)}
            bold={span.bold}
          >
            {span.text}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

export function Timeline({ staticEvents, activeEvents, layout, uiState, viewportRows }: TimelineProps) {
  const { stdin } = useStdin();
  const staticItems = useMemo(() => buildTimelineItems(staticEvents), [staticEvents]);
  const activeItems = useMemo(() => buildTimelineItems(activeEvents), [activeEvents]);
  const activeTurnId = getActiveTurnId(uiState);
  const questionTurnId = uiState.kind === "AWAITING_USER_ACTION" ? uiState.turnId : null;
  const question = uiState.kind === "AWAITING_USER_ACTION" ? uiState.question : null;
  const staticTurnIds = useMemo(
    () => staticItems.filter((item): item is TurnTimelineItem => item.type === "turn").map((item) => item.turnId),
    [staticItems],
  );
  const activeTurnIds = useMemo(
    () => activeItems.filter((item): item is TurnTimelineItem => item.type === "turn").map((item) => item.turnId),
    [activeItems],
  );
  const allTurnIds = useMemo(
    () => [...staticTurnIds, ...activeTurnIds],
    [activeTurnIds, staticTurnIds],
  );
  const staticRenderItems = useMemo(
    () => buildStaticRenderItems(staticItems, allTurnIds, activeTurnId, questionTurnId, question),
    [activeTurnId, allTurnIds, question, questionTurnId, staticItems],
  );
  const activeRenderItems = useMemo(
    () => buildActiveRenderItems(activeItems, allTurnIds, uiState),
    [activeItems, allTurnIds, uiState],
  );
  const liveRenderItems = useMemo(
    () => [...staticRenderItems, ...activeRenderItems],
    [activeRenderItems, staticRenderItems],
  );
  const liveSnapshot = useMemo(
    () => buildTimelineSnapshot(liveRenderItems, { totalWidth: getShellWidth(layout.cols) }),
    [layout.cols, liveRenderItems],
  );
  const [viewport, setViewport] = useState<TimelineViewportState>(() => createFollowTailViewport(liveSnapshot.totalRows));
  const liveSnapshotRef = useRef(liveSnapshot);

  useEffect(() => {
    liveSnapshotRef.current = liveSnapshot;
  }, [liveSnapshot]);

  useEffect(() => {
    setViewport((current) => syncTimelineViewport(current, liveSnapshot));
  }, [liveSnapshot]);

  useEffect(() => {
    const handleRawInput = (chunk: Buffer | string) => {
      const raw = typeof chunk === "string" ? chunk : chunk.toString();
      const directions = parseWheelScrollDirections(raw);
      if (directions.length === 0) {
        return;
      }

      const currentSnapshot = liveSnapshotRef.current;
      if (currentSnapshot.totalRows === 0) {
        return;
      }

      setViewport((current) => {
        let next = current;
        for (const direction of directions) {
          for (let i = 0; i < WHEEL_SCROLL_STEP; i++) {
            next = direction === "up"
              ? stepUpTimelineViewport(next, currentSnapshot, viewportRows)
              : stepDownTimelineViewport(next, currentSnapshot, viewportRows);
          }
        }
        return next;
      });
    };

    stdin.on("data", handleRawInput);
    return () => {
      stdin.off("data", handleRawInput);
    };
  }, [stdin, viewportRows]);

  useInput((input, key) => {
    if (liveSnapshot.totalRows === 0) return;

    if (key.pageUp) {
      setViewport((current) => pageUpTimelineViewport(current, liveSnapshot, viewportRows));
      return;
    }

    if (key.pageDown) {
      setViewport((current) => pageDownTimelineViewport(current, liveSnapshot, viewportRows));
      return;
    }

    if (isHomeInput(input)) {
      setViewport((current) => homeTimelineViewport(current, liveSnapshot, viewportRows));
      return;
    }

    if (isEndInput(input)) {
      setViewport(endTimelineViewport(liveSnapshot.totalRows));
    }
  });

  const { visibleRows } = useMemo(
    () => selectTimelineRows(liveSnapshot, viewport, viewportRows),
    [liveSnapshot, viewport, viewportRows],
  );

  if (visibleRows.length === 0) {
    return <Box flexDirection="column" width="100%" height={Math.max(1, viewportRows)} />;
  }

  return (
    <Box flexDirection="column" width="100%" height={Math.max(1, viewportRows)} overflow="hidden">
      {visibleRows.map((row) => (
        <TimelineRowView key={row.key} row={row} />
      ))}
    </Box>
  );
}

export { Timeline as ActiveTimeline };
