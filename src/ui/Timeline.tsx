import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
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
import { MemoizedTurnGroup, type TurnOpacity } from "./TurnGroup.js";
import { getUsableShellWidth, type Layout } from "./layout.js";
import { getTextWidth, wrapPlainText } from "./textLayout.js";
import { useTheme } from "./theme.js";
import { sanitizeTerminalLines, sanitizeTerminalOutput } from "../core/terminalSanitize.js";

interface TimelineProps {
  events: TimelineEvent[];
  layout: Layout;
  uiState: UIState;
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
export interface TimelineViewportState {
  anchorIndex: number;
  followTail: boolean;
  unseenItems: number;
}

const MAX_SHELL_FAILURE_EXCERPT_LINES = 3;
const MIN_TIMELINE_PAGE_SIZE = 3;
const DEFAULT_TIMELINE_ROWS = 24;

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

export function getTimelinePageSize(layoutMode: Layout["mode"], rows = DEFAULT_TIMELINE_ROWS): number {
  const base = layoutMode === "micro" ? 4 : layoutMode === "compact" ? 5 : 6;
  const delta = rows >= DEFAULT_TIMELINE_ROWS
    ? Math.floor((rows - DEFAULT_TIMELINE_ROWS) / 8)
    : -Math.ceil((DEFAULT_TIMELINE_ROWS - rows) / 6);
  return Math.max(MIN_TIMELINE_PAGE_SIZE, base + delta);
}

export function buildTimelineWindow(totalItems: number, pageSize: number, anchorIndex: number): {
  startIndex: number;
  endIndex: number;
  anchorIndex: number;
} {
  if (totalItems <= 0) {
    return { startIndex: 0, endIndex: 0, anchorIndex: 0 };
  }

  const safePageSize = Math.max(MIN_TIMELINE_PAGE_SIZE, pageSize);
  const normalizedAnchor = Math.max(0, Math.min(anchorIndex, totalItems - 1));
  const endIndex = normalizedAnchor + 1;
  const startIndex = Math.max(0, endIndex - safePageSize);

  return {
    startIndex,
    endIndex,
    anchorIndex: normalizedAnchor,
  };
}

function findPreviousTurnBoundaryIndex(items: TimelineItem[], fromIndex: number): number | null {
  for (let index = Math.min(items.length - 1, fromIndex); index >= 0; index -= 1) {
    if (items[index]?.type === "turn") return index;
  }
  return null;
}

function findNextTurnBoundaryIndex(items: TimelineItem[], fromIndex: number): number | null {
  for (let index = Math.max(0, fromIndex); index < items.length; index += 1) {
    if (items[index]?.type === "turn") return index;
  }
  return null;
}

function PrefixedRows({
  marker,
  text,
  width,
  markerColor,
  textColor,
}: {
  marker: string;
  text: string;
  width: number;
  markerColor: string;
  textColor: string;
}) {
  const rows = wrapPlainText(text, Math.max(1, width - getTextWidth(marker)));
  return (
    <Box flexDirection="column" width="100%">
      {rows.map((row, index) => (
        <Box key={index} width="100%">
          <Text color={markerColor}>{index === 0 ? marker : "  "}</Text>
          <Text color={textColor}>{row || " "}</Text>
        </Box>
      ))}
    </Box>
  );
}

function getShellFailureExcerpt(event: ShellEvent): string[] {
  const source = event.stderrLines.length > 0 ? event.stderrLines : event.lines;
  const summary = sanitizeTerminalOutput(event.summary ?? "").trim().toLowerCase();
  return sanitizeTerminalLines(source)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => !(index === 0 && summary && line.toLowerCase() === summary))
    .slice(0, MAX_SHELL_FAILURE_EXCERPT_LINES);
}

function StandaloneEventLine({ event, width }: { event: StandaloneTimelineEvent; width: number }) {
  const theme = useTheme();

  if (event.type === "shell") {
    const command = sanitizeTerminalOutput(event.command);
    const summary = sanitizeTerminalOutput(event.summary ?? "");
    const marker = event.status === "failed" ? "✕ " : "✧ ";
    const verb = event.status === "running" ? "Executing shell"
      : event.status === "completed" ? "Executed shell"
      : "Shell failed";
    const statusBits = [
      event.exitCode !== null && event.status !== "running" ? `exit ${event.exitCode}` : null,
      event.durationMs !== null ? `${(event.durationMs / 1000).toFixed(2)}s` : null,
    ].filter(Boolean).join(" • ");
    const heading = `${verb}: ${command}${statusBits ? `  •  ${statusBits}` : ""}`;
    const summaryRows = summary && event.status !== "running"
      ? wrapPlainText(summary, Math.max(1, width - 2))
      : [];
    const failureExcerpt = event.status === "failed"
      ? getShellFailureExcerpt(event)
      : [];

    return (
      <Box flexDirection="column" width="100%">
        <PrefixedRows
          marker={marker}
          text={heading}
          width={width}
          markerColor={event.status === "failed" ? theme.ERROR : theme.ACCENT}
          textColor={theme.TEXT}
        />
        {summaryRows.length > 0 && (
          <Box flexDirection="column" paddingLeft={2} marginTop={1} width="100%">
            {summaryRows.map((row, index) => (
              <Text key={index} color={event.status === "failed" ? theme.ERROR : theme.MUTED}>{row || " "}</Text>
            ))}
          </Box>
        )}
        {failureExcerpt.length > 0 && (
          <Box flexDirection="column" paddingLeft={2} marginTop={summaryRows.length > 0 ? 0 : 1} width="100%">
            {failureExcerpt.map((line, index) => (
              <Text key={index} color={theme.ERROR}>{line}</Text>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  if (event.type === "error") {
    const content = sanitizeTerminalOutput(event.content).split("\n").find((line) => line.trim()) ?? "";
    return (
      <Box flexDirection="column" width="100%">
        <PrefixedRows
          marker="✕ "
          text={sanitizeTerminalOutput(event.title)}
          width={width}
          markerColor={theme.ERROR}
          textColor={theme.ERROR}
        />
        {content && (
          <Box flexDirection="column" paddingLeft={2} marginTop={1} width="100%">
            {wrapPlainText(content, Math.max(1, width - 2)).map((row, index) => (
              <Text key={index} color={theme.MUTED}>{row || " "}</Text>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  const firstLine = sanitizeTerminalOutput(event.content).split("\n").find((line) => line.trim()) ?? "";
  return (
    <Box flexDirection="column" width="100%">
      <PrefixedRows
        marker="• "
        text={sanitizeTerminalOutput(event.title)}
        width={width}
        markerColor={theme.INFO}
        textColor={theme.TEXT}
      />
      {firstLine && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1} width="100%">
          {wrapPlainText(firstLine, Math.max(1, width - 2)).map((row, index) => (
            <Text key={index} color={theme.DIM}>{row || " "}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

export function Timeline({ events, layout, uiState }: TimelineProps) {
  const theme = useTheme();
  const items = useMemo(() => buildTimelineItems(events), [events]);
  const pageSize = useMemo(
    () => Math.max(MIN_TIMELINE_PAGE_SIZE, getTimelinePageSize(layout.mode, layout.rows)),
    [layout.mode, layout.rows],
  );
  const lastIndex = items.length - 1;
  const [viewport, setViewport] = useState<TimelineViewportState>({
    anchorIndex: Math.max(0, lastIndex),
    followTail: true,
    unseenItems: 0,
  });

  useEffect(() => {
    setViewport((prev) => {
      if (items.length === 0) {
        return { anchorIndex: 0, followTail: true, unseenItems: 0 };
      }

      const normalizedAnchor = Math.max(0, Math.min(prev.anchorIndex, items.length - 1));
      if (prev.followTail) {
        if (normalizedAnchor === items.length - 1 && prev.unseenItems === 0) {
          return prev;
        }
        return { anchorIndex: items.length - 1, followTail: true, unseenItems: 0 };
      }

      if (normalizedAnchor !== prev.anchorIndex) {
        return { ...prev, anchorIndex: normalizedAnchor };
      }

      const unseenItems = Math.max(0, (items.length - 1) - normalizedAnchor);
      if (unseenItems !== prev.unseenItems) {
        return { ...prev, unseenItems };
      }

      return prev;
    });
  }, [items.length]);

  useInput((_input, key) => {
    if (items.length === 0) return;

    if (key.pageUp) {
      setViewport((prev) => ({
        anchorIndex: Math.max(pageSize - 1, prev.anchorIndex - pageSize),
        followTail: false,
        unseenItems: Math.max(0, lastIndex - Math.max(pageSize - 1, prev.anchorIndex - pageSize)),
      }));
      return;
    }

    if (key.pageDown) {
      setViewport((prev) => {
        const nextAnchor = Math.min(lastIndex, prev.anchorIndex + pageSize);
        const followTail = nextAnchor >= lastIndex;
        return {
          anchorIndex: nextAnchor,
          followTail,
          unseenItems: followTail ? 0 : Math.max(0, lastIndex - nextAnchor),
        };
      });
      return;
    }

    if (_input === "[") {
      setViewport((prev) => {
        const target = findPreviousTurnBoundaryIndex(items, prev.anchorIndex - 1);
        if (target === null) return prev;
        return {
          anchorIndex: target,
          followTail: false,
          unseenItems: Math.max(0, lastIndex - target),
        };
      });
      return;
    }

    if (_input === "]") {
      setViewport((prev) => {
        const target = findNextTurnBoundaryIndex(items, prev.anchorIndex + 1);
        if (target === null) return prev;
        const followTail = target >= lastIndex;
        return {
          anchorIndex: target,
          followTail,
          unseenItems: followTail ? 0 : Math.max(0, lastIndex - target),
        };
      });
      return;
    }

    if (key.ctrl && _input === "a") {
      const headAnchor = Math.min(lastIndex, pageSize - 1);
      setViewport({
        anchorIndex: headAnchor,
        followTail: false,
        unseenItems: Math.max(0, lastIndex - headAnchor),
      });
      return;
    }

    if (key.ctrl && _input === "e") {
      setViewport({
        anchorIndex: lastIndex,
        followTail: true,
        unseenItems: 0,
      });
    }
  });

  const windowState = buildTimelineWindow(items.length, pageSize, viewport.followTail ? lastIndex : viewport.anchorIndex);
  const visibleItems = items.slice(windowState.startIndex, windowState.endIndex);
  const visibleTurnIds = visibleItems
    .filter((item): item is TurnTimelineItem => item.type === "turn")
    .map((item) => item.turnId);
  const activeTurnId = getActiveTurnId(uiState);
  const standaloneWidth = Math.max(1, getUsableShellWidth(layout.cols, 2));
  const streamPreviewRows = layout.mode === "micro" ? 5 : layout.mode === "compact" ? 8 : 12;

  if (visibleItems.length === 0) return null;

  return (
    <Box flexDirection="column" overflow="hidden" flexGrow={1} justifyContent="flex-start" width="100%">
      <Box paddingX={1} marginBottom={1} width="100%" justifyContent="space-between" flexDirection="row">
        <Text color={theme.DIM}>
          {`showing ${windowState.startIndex + 1}-${windowState.endIndex} of ${items.length}`}
        </Text>
        <Text color={viewport.followTail ? theme.DIM : theme.INFO}>
          {viewport.followTail
            ? "PgUp browse  [ ] turns  Ctrl+A/Ctrl+E"
            : `${viewport.unseenItems} newer • PgDn/Ctrl+E to follow`}
        </Text>
      </Box>
      <Box flexShrink={0} flexDirection="column" paddingX={1} width="100%">
        {visibleItems.map((item, index) => (
          <Box key={item.type === "turn" ? `turn-${item.turnId}` : `event-${item.event.id}`} marginBottom={index === visibleItems.length - 1 ? 0 : 1} width="100%" flexShrink={0}>
            {item.type === "turn" && item.user ? (
              <MemoizedTurnGroup
                cols={layout.cols}
                turnIndex={item.turnIndex}
                user={item.user}
                run={item.run}
                assistant={item.assistant}
                uiState={uiState}
                opacity={resolveTurnOpacity(visibleTurnIds, item.turnId, activeTurnId)}
                streamPreviewRows={streamPreviewRows}
                streamMode="assistant-first"
              />
            ) : item.type === "event" ? (
              <StandaloneEventLine event={item.event} width={standaloneWidth} />
            ) : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export { Timeline as ActiveTimeline };
