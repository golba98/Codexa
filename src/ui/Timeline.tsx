import React, { useEffect, useRef, useState } from "react";
import { Box, Text, measureElement } from "ink";
import { MAX_VISIBLE_EVENTS } from "../config/settings.js";
import type {
  AssistantEvent,
  ErrorEvent,
  RunEvent,
  ShellEvent,
  StagedRunEvent,
  SystemEvent,
  TimelineEvent,
  UIState,
  UserPromptEvent,
} from "../session/types.js";
import { TurnGroup, type TurnOpacity } from "./TurnGroup.js";
import { getUsableShellWidth, type Layout } from "./layout.js";
import { getTextWidth, wrapPlainText } from "./textLayout.js";
import { useTheme } from "./theme.js";
import { ScrollIndicator } from "./ScrollIndicator.js";

interface TimelineProps {
  events: TimelineEvent[];
  layout: Layout;
  uiState: UIState;
  scrollOffset: number;
  onMaxScrollChange?: (maxScroll: number) => void;
}

type StandaloneTimelineEvent = SystemEvent | ErrorEvent | ShellEvent;

interface TurnTimelineItem {
  type: "turn";
  turnId: number;
  turnIndex: number;
  user: UserPromptEvent | null;
  run: RunEvent | null;
  stagedRun: StagedRunEvent | null;
  assistant: AssistantEvent | null;
}

interface EventTimelineItem {
  type: "event";
  event: StandaloneTimelineEvent;
}

export type TimelineItem = TurnTimelineItem | EventTimelineItem;

const MAX_SHELL_FAILURE_EXCERPT_LINES = 3;

function isStandaloneEvent(event: TimelineEvent): event is StandaloneTimelineEvent {
  return event.type === "system" || event.type === "error" || event.type === "shell";
}

function isStagedRunEvent(event: TimelineEvent): event is StagedRunEvent {
  return event.type === "staged-run";
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
        stagedRun: null,
        assistant: null,
      };
      turns.set(turnId, turn);
      items.push(turn);
    }

    if (event.type === "user") {
      turn.user = event;
    } else if (event.type === "run") {
      turn.run = event;
    } else if (isStagedRunEvent(event)) {
      turn.stagedRun = event;
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
  const summary = event.summary?.trim().toLowerCase();
  return source
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => !(index === 0 && summary && line.toLowerCase() === summary))
    .slice(0, MAX_SHELL_FAILURE_EXCERPT_LINES);
}

function StandaloneEventLine({ event, width }: { event: StandaloneTimelineEvent; width: number }) {
  const theme = useTheme();

  if (event.type === "shell") {
    const marker = event.status === "failed" ? "✕ " : "✧ ";
    const verb = event.status === "running" ? "Executing shell"
      : event.status === "completed" ? "Executed shell"
      : "Shell failed";
    const statusBits = [
      event.exitCode !== null && event.status !== "running" ? `exit ${event.exitCode}` : null,
      event.durationMs !== null ? `${(event.durationMs / 1000).toFixed(2)}s` : null,
    ].filter(Boolean).join(" • ");
    const heading = `${verb}: ${event.command}${statusBits ? `  •  ${statusBits}` : ""}`;
    const summaryRows = event.summary && event.status !== "running"
      ? wrapPlainText(event.summary, Math.max(1, width - 2))
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
    const content = event.content.split("\n").find((line) => line.trim()) ?? "";
    return (
      <Box flexDirection="column" width="100%">
        <PrefixedRows
          marker="✕ "
          text={event.title}
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

  const firstLine = event.content.split("\n").find((line) => line.trim()) ?? "";
  return (
    <Box flexDirection="column" width="100%">
      <PrefixedRows
        marker="• "
        text={event.title}
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

export function Timeline({ events, layout, uiState, scrollOffset }: TimelineProps) {
  const items = buildTimelineItems(events);
  // Render ALL items - viewport clipping handles visibility
  const allItems = items;
  const allTurnIds = allItems
    .filter((item): item is TurnTimelineItem => item.type === "turn")
    .map((item) => item.turnId);
  const activeTurnId = getActiveTurnId(uiState);
  const standaloneWidth = Math.max(1, getUsableShellWidth(layout.cols, 2));
  const spacing = layout.cols <= 80 ? 0 : 1;

  const viewportRef = useRef<any>(null);
  const innerRef = useRef<any>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(Math.max(1, layout.contentHeight - 10));

  // Measure the viewport and content actual rendered height for scrollbar calculations
  useEffect(() => {
    if (!innerRef.current || !viewportRef.current) return;
    const interval = setInterval(() => {
      if (innerRef.current) {
        const { height } = measureElement(innerRef.current);
        if (height !== contentHeight) {
          setContentHeight(height);
        }
      }
      if (viewportRef.current) {
        const { height } = measureElement(viewportRef.current);
        if (height !== viewportHeight && height > 0) {
          setViewportHeight(height);
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, [contentHeight, viewportHeight]);

  if (allItems.length === 0) return null;

  // Calculate viewport boundaries using accurate viewportHeight
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const safeScrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));
  const hasScrollableContent = contentHeight > viewportHeight;

  return (
    <Box ref={viewportRef} flexDirection="column" paddingX={1} width="100%" justifyContent="flex-end" flexGrow={1} overflowY="hidden">
      <Box ref={innerRef} flexDirection="column" width="100%" paddingBottom={safeScrollOffset}>
        {allItems.map((item, index) => (
          <Box 
            key={item.type === "turn" ? `turn-${item.turnId}` : `event-${item.event.id}`} 
            marginBottom={index === allItems.length - 1 ? 0 : spacing} 
            width="100%"
          >
            {item.type === "turn" && item.user ? (
              <TurnGroup
                cols={layout.cols}
                turnIndex={item.turnIndex}
                user={item.user}
                run={item.run}
                stagedRun={item.stagedRun}
                assistant={item.assistant}
                uiState={uiState}
                opacity={resolveTurnOpacity(allTurnIds, item.turnId, activeTurnId)}
              />
            ) : item.type === "event" ? (
              <StandaloneEventLine event={item.event} width={standaloneWidth} />
            ) : null}
          </Box>
        ))}
      </Box>
      {/* Scroll indicator - rendered absolutely over the viewport */}
      {hasScrollableContent && (
        // @ts-expect-error - Ink's Box supports right/bottom via Yoga, but types may be incomplete
        <Box position="absolute" right={1} bottom={0}>
          <ScrollIndicator
            scrollOffset={safeScrollOffset}
            maxScroll={maxScroll}
            viewportHeight={viewportHeight}
            totalHeight={contentHeight}
            visible={hasScrollableContent}
          />
        </Box>
      )}
    </Box>
  );
}

export { Timeline as ActiveTimeline };
