import React, { memo, useEffect, useState, useDeferredValue, useMemo } from "react";
import { Box, Text } from "ink";
import type {
  AssistantEvent,
  RunEvent,
  RunProgressBlock,
  RunResponseSegment,
  RunStreamItem,
  RunToolActivity,
  UIState,
  UserPromptEvent,
} from "../session/types.js";
import { getAssistantContent, getResponseSegmentText } from "../session/types.js";
import { formatTerminalAnswerInline } from "./terminalAnswerFormat.js";
import { ActionRequiredBlock } from "./ActionRequiredBlock.js";
import { DashCard } from "./DashCard.js";
import { useTheme } from "./theme.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { wrapPlainText } from "./textLayout.js";
import { selectVisibleRunActivity } from "./runActivityView.js";
import type { RunFileActivity } from "../core/workspaceActivity.js";
import { RUN_OUTPUT_TRUNCATION_NOTICE } from "../session/chatLifecycle.js";
import { formatProgressBlockBodyLines } from "./progressEntries.js";
import { getUsableShellWidth } from "./layout.js";
import { MemoizedRenderMessage } from "./Markdown.js";
import {
  sanitizeOutput,
  sanitizeStreamChunk,
  normalizeOutput,
  classifyOutput,
  formatForBox,
} from "./outputPipeline.js";
import { normalizeCommand, getFriendlyActionLabel } from "./commandNormalize.js";

export type TurnOpacity = "active" | "recent" | "dim";

interface TurnGroupProps {
  cols: number;
  turnIndex: number;
  user: UserPromptEvent;
  run: RunEvent | null;
  assistant: AssistantEvent | null;
  opacity: TurnOpacity;
  question: string | null;
  runPhase: TurnRunPhase;
  streamPreviewRows: number;
  streamMode: "assistant-first";
  verboseMode?: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── User Input Card ─────────────────────────────────────────────────────────
// User prompt wrapped in a rounded DashCard border.

function UserInputCard({
  prompt,
  cols,
  dim,
}: {
  prompt: string;
  cols: number;
  dim: boolean;
}) {
  const theme = useTheme();
  const borderColor = dim ? theme.BORDER_SUBTLE : theme.BORDER_SUBTLE;
  const contentWidth = Math.max(1, cols - 7);
  const lines = wrapPlainText(sanitizeTerminalOutput(prompt), contentWidth);

  return (
    <DashCard cols={cols} title="PROMPT" borderColor={borderColor}>
      {lines.map((line, i) => (
        <Text key={i} color={dim ? theme.DIM : theme.TEXT}>
          {i === 0 ? "❯ " : "  "}{line}
        </Text>
      ))}
    </DashCard>
  );
}

const MemoizedUserInputCard = memo(UserInputCard, (prev, next) => (
  prev.prompt === next.prompt
  && prev.cols === next.cols
  && prev.dim === next.dim
));

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

// ─── Impact Summary ──────────────────────────────────────────────────────────
// Compact file-change summary replacing FileScanCard + ActivityCard

function ImpactSummary({
  run,
  cols,
}: {
  run: RunEvent;
  cols: number;
}) {
  const theme = useTheme();
  const summary = run.activitySummary;
  const hasFiles = run.touchedFileCount > 0;
  const hasTools = run.toolActivities.length > 0;

  if (!hasFiles && !hasTools) return null;

  const contentWidth = Math.max(1, cols - 6);
  const recentFiles = summary?.recent ?? run.activity.slice(-6);
  const hasDeletes = (summary?.deleted ?? 0) > 0;

  const opLabel = (op: string) => {
    switch (op) {
      case "created": return "CREATED ";
      case "modified": return "MODIFIED";
      case "deleted": return "DELETED ";
      default: return op.toUpperCase().padEnd(8);
    }
  };

  const opColor = (op: string) => {
    switch (op) {
      case "created": return theme.SUCCESS;
      case "deleted": return theme.ERROR;
      default: return theme.INFO;
    }
  };

  return (
    <Box flexDirection="column" width="100%" paddingX={1} marginTop={0}>
      {hasDeletes && (
        <Text color={theme.WARNING}>{"⚠ Destructive changes detected:"}</Text>
      )}
      {hasFiles && (
        <>
          <Text color={theme.DIM}>{"  Changes:"}</Text>
          {recentFiles.map((file: RunFileActivity, i: number) => {
            const diffInfo = file.addedLines != null || file.removedLines != null
              ? ` (+${file.addedLines ?? 0} -${file.removedLines ?? 0})`
              : "";
            return (
              <Text key={i}>
                <Text color={theme.DIM}>{"    "}</Text>
                <Text color={opColor(file.operation)}>{opLabel(file.operation)}</Text>
                <Text color={theme.TEXT}>{" "}{file.path}</Text>
                <Text color={theme.DIM}>{diffInfo}</Text>
              </Text>
            );
          })}
        </>
      )}
      {/* Summary footer */}
      <Text color={theme.DIM}>
        {"  "}
        <Text color={theme.SUCCESS}>{"✔ "}</Text>
        {run.touchedFileCount > 0 && `${run.touchedFileCount} file${run.touchedFileCount === 1 ? "" : "s"}`}
        {hasTools && `${hasFiles ? " • " : ""}${run.toolActivities.length} action${run.toolActivities.length === 1 ? "" : "s"}`}
        {run.durationMs != null && ` • ${formatDuration(run.durationMs)}`}
      </Text>
    </Box>
  );
}

// ─── Verbose Cards (only shown in verbose mode) ──────────────────────────────

function FileScanCard({ run, cols }: { run: RunEvent; cols: number }) {
  const theme = useTheme();
  const { visible, hiddenCount } = selectVisibleRunActivity(run);
  const badge = `${run.touchedFileCount} file${run.touchedFileCount === 1 ? "" : "s"}`;

  return (
    <DashCard cols={cols} title="Scanning workspace ..." rightBadge={badge}>
      {hiddenCount > 0 && (
        <Text color={theme.DIM}>{`... ${hiddenCount} more`}</Text>
      )}
      {visible.map((file, i) => (
        <Text key={i} color={theme.SUCCESS}>
          {"● "}<Text color={theme.TEXT}>{file.path}</Text>
        </Text>
      ))}
    </DashCard>
  );
}

const COMPACT_PROCESSING_BODY_LINE_CAP = 4;
const COMPACT_STREAMING_TAIL_CAP = 6;
const VISIBLE_THINKING_SOURCES = new Set(["reasoning", "todo"]);

// ─── Unified Event Stream Card ───────────────────────────────────────────────

type ResolvedStreamEvent =
  | { kind: "thinking"; streamSeq: number; block: RunProgressBlock }
  | { kind: "action"; streamSeq: number; tool: RunToolActivity }
  | { kind: "response"; streamSeq: number; segment: RunResponseSegment };

function resolveStreamEvents(
  run: RunEvent,
  assistant: AssistantEvent | null,
  streaming: boolean,
): ResolvedStreamEvent[] {
  const blocksById = new Map<string, RunProgressBlock>();
  for (const entry of run.progressEntries ?? []) {
    for (const block of entry.blocks) blocksById.set(block.id, block);
  }
  const toolsById = new Map(run.toolActivities.map((tool) => [tool.id, tool] as const));
  const segmentsById = new Map((run.responseSegments ?? []).map((seg) => [seg.id, seg] as const));

  const items = (run.streamItems ?? []).slice().sort((a, b) => a.streamSeq - b.streamSeq);
  const resolved: ResolvedStreamEvent[] = [];
  for (const item of items) {
    if (item.kind === "thinking") {
      const block = blocksById.get(item.refId);
      if (block && block.text.trim().length > 0) {
        resolved.push({ kind: "thinking", streamSeq: item.streamSeq, block });
      }
    } else if (item.kind === "action") {
      const tool = toolsById.get(item.refId);
      if (tool) resolved.push({ kind: "action", streamSeq: item.streamSeq, tool });
    } else if (item.kind === "response") {
      const segment = segmentsById.get(item.refId);
      if (segment) resolved.push({ kind: "response", streamSeq: item.streamSeq, segment });
    }
  }

  // Backward-compat fallback for older session data that predates streamItems.
  // New runs always use the streamItems path above.
  if (resolved.length === 0 && items.length === 0) {
    let legacySeq = 0;
    for (const entry of run.progressEntries ?? []) {
      if (!VISIBLE_THINKING_SOURCES.has(entry.source)) continue;
      for (const block of entry.blocks) {
        if (!block.text.trim()) continue;
        legacySeq += 1;
        resolved.push({ kind: "thinking", streamSeq: legacySeq, block });
      }
    }

    for (const tool of run.toolActivities ?? []) {
      legacySeq += 1;
      resolved.push({ kind: "action", streamSeq: legacySeq, tool });
    }

    for (const segment of run.responseSegments ?? []) {
      if (!getResponseSegmentText(segment).trim() && !streaming) continue;
      legacySeq += 1;
      resolved.push({ kind: "response", streamSeq: legacySeq, segment });
    }
  }

  // First-render fallback: the assistant may have produced text before the
  // run has received a stream item, especially with older persisted data.
  if (resolved.length === 0 && (getAssistantContent(assistant).length > 0 || streaming)) {
    const content = getAssistantContent(assistant);
    resolved.push({
      kind: "response",
      streamSeq: 1,
      segment: {
        id: `synthetic-${run.id}`,
        streamSeq: 1,
        chunks: [content],
        status: streaming ? "active" : "completed",
        startedAt: run.startedAt,
      },
    });
  }

  return resolved;
}

function ActionEventCard({
  cols,
  tool,
  opacity,
  isLiveCursorTarget,
}: {
  cols: number;
  tool: RunToolActivity;
  opacity: TurnOpacity;
  isLiveCursorTarget: boolean;
}) {
  const theme = useTheme();
  const dim = opacity !== "active";
  const actionNormalized = normalizeCommand(tool.command);
  const actionLabel = getFriendlyActionLabel(actionNormalized);
  const borderColor = dim ? theme.BORDER_SUBTLE : tool.status === "running" ? theme.BORDER_ACTIVE : theme.BORDER_SUBTLE;

  return (
    <DashCard cols={cols} title="action" borderColor={borderColor}>
      <Box>
        <Text color={tool.status === "failed" ? theme.ERROR : tool.status === "completed" ? theme.SUCCESS : theme.INFO}>
          {`${tool.status === "failed" ? "✕" : tool.status === "completed" ? "✓" : "•"} `}
        </Text>
        <Text color={dim ? theme.DIM : theme.TEXT}>{actionLabel ?? actionNormalized}</Text>
        {tool.completedAt && (
          <Text color={theme.DIM}>  {formatDuration(tool.completedAt - tool.startedAt)}</Text>
        )}
      </Box>
      {actionLabel && (
        <Text color={theme.MUTED} wrap="wrap">  {actionNormalized}</Text>
      )}
      {isLiveCursorTarget && tool.status === "running" && (
        <Text color={theme.ACCENT}>  ▌</Text>
      )}
    </DashCard>
  );
}

function CodexThinkingBlock({
  block,
  cols,
  isLiveCursorTarget,
  verboseMode,
}: {
  block: RunProgressBlock;
  cols: number;
  isLiveCursorTarget: boolean;
  verboseMode: boolean;
}) {
  const theme = useTheme();
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 0));

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      <Text color={theme.MUTED} bold>Codex</Text>
      {formatProgressBlockBodyLines(block.text, contentWidth)
        .slice(0, verboseMode ? undefined : COMPACT_PROCESSING_BODY_LINE_CAP)
        .map((line, i) => (
          <Text key={i} color={theme.DIM}>{line || " "}</Text>
        ))}
      {isLiveCursorTarget && block.status === "active" && (
        <Text color={theme.ACCENT}>▌</Text>
      )}
    </Box>
  );
}

function CodexResponseBlock({
  run,
  segment,
  cols,
  streaming,
  isLast,
  isLiveCursorTarget,
  verboseMode,
}: {
  run: RunEvent;
  segment: RunResponseSegment;
  cols: number;
  streaming: boolean;
  isLast: boolean;
  isLiveCursorTarget: boolean;
  verboseMode: boolean;
}) {
  const theme = useTheme();
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 0));

  const formatted = useMemo(() => {
    const raw = formatTerminalAnswerInline(getResponseSegmentText(segment));
    const sanitized = segment.status === "active"
      ? sanitizeStreamChunk(raw)
      : sanitizeOutput(raw);
    const normalized = normalizeOutput(sanitized);
    const classified = classifyOutput(normalized);
    return formatForBox(classified, contentWidth);
  }, [contentWidth, segment]);

  const segmentStreaming = segment.status === "active";
  const showTail = !segmentStreaming && !verboseMode && formatted.length > COMPACT_STREAMING_TAIL_CAP;

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      <Text color={theme.MUTED} bold>Codex</Text>
      {run.status === "failed" && !streaming && isLast && (
        <Box flexDirection="column">
          {wrapPlainText(sanitizeTerminalOutput(run.errorMessage ?? run.summary), contentWidth).map((row, i) => (
            <Text key={i} color={theme.ERROR}>{i === 0 ? `✕ ${row}` : `  ${row}`}</Text>
          ))}
        </Box>
      )}
      <MemoizedRenderMessage
        segments={showTail ? formatted.slice(-COMPACT_STREAMING_TAIL_CAP) : formatted}
        width={contentWidth}
      />
      {isLiveCursorTarget && segmentStreaming && (
        <Text color={theme.ACCENT}>▌</Text>
      )}
    </Box>
  );
}

function CodexStatusBlock({ text, showCursor }: { text: string; showCursor: boolean }) {
  const theme = useTheme();

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      <Text color={theme.MUTED} bold>Codex</Text>
      <Text color={theme.DIM}>{text}</Text>
      {showCursor && <Text color={theme.ACCENT}>▌</Text>}
    </Box>
  );
}

function StreamEventList({
  cols,
  run,
  assistant,
  runPhase,
  opacity,
  verboseMode,
}: {
  cols: number;
  run: RunEvent;
  assistant: AssistantEvent | null;
  runPhase: TurnRunPhase;
  opacity: TurnOpacity;
  verboseMode: boolean;
}) {
  const streaming = runPhase === "streaming";
  const events = useMemo(
    () => resolveStreamEvents(run, assistant, streaming),
    [run, assistant, streaming],
  );

  return (
    <Box flexDirection="column" width="100%">
      {events.length === 0 && run.status === "running" && (
        <CodexStatusBlock text="Codex is working..." showCursor />
      )}

      {events.map((event, index) => {
        const isLast = index === events.length - 1;
        const isLiveCursorTarget = run.status === "running" && isLast;

        return (
          <Box key={`${event.kind}-${event.streamSeq}`} flexDirection="column" marginTop={index > 0 ? 1 : 0}>
            {event.kind === "thinking" && (
              <CodexThinkingBlock
                block={event.block}
                cols={cols}
                isLiveCursorTarget={isLiveCursorTarget}
                verboseMode={verboseMode}
              />
            )}
            {event.kind === "action" && (
              <ActionEventCard
                cols={cols}
                tool={event.tool}
                opacity={opacity}
                isLiveCursorTarget={isLiveCursorTarget}
              />
            )}
            {event.kind === "response" && (
              <CodexResponseBlock
                run={run}
                segment={event.segment}
                cols={cols}
                streaming={streaming}
                isLast={isLast}
                isLiveCursorTarget={isLiveCursorTarget}
                verboseMode={verboseMode}
              />
            )}
          </Box>
        );
      })}

      {run.status !== "running" && !verboseMode && (
        <Box marginTop={1}>
          <ImpactSummary run={run} cols={cols} />
        </Box>
      )}
    </Box>
  );
}

// ─── TurnGroup ───────────────────────────────────────────────────────────────

export function TurnGroup({
  cols,
  turnIndex,
  user,
  run,
  assistant,
  opacity,
  question,
  runPhase,
  verboseMode = false,
}: TurnGroupProps) {
  return (
    <Box flexDirection="column" width="100%">
      <MemoizedUserInputCard
        prompt={user.prompt}
        cols={cols}
        dim={opacity === "dim"}
      />

      {run && (
        <StreamEventList
          cols={cols}
          run={run}
          assistant={assistant}
          runPhase={runPhase}
          opacity={opacity}
          verboseMode={verboseMode}
        />
      )}

      {run && run.status !== "running" && verboseMode && (
        <>
          {run.touchedFileCount > 0 && <FileScanCard run={run} cols={cols} />}
          {/* ActivityCard is skipped because actions are now in the unified stream */}
        </>
      )}

      {question && <ActionRequiredBlock cols={cols} turnIndex={turnIndex} question={question} />}
    </Box>
  );
}

// Memoized wrapper to prevent re-renders of finalized turns
export const MemoizedTurnGroup = memo(TurnGroup, (prev, next) => {
  return (
    prev.cols === next.cols &&
    prev.turnIndex === next.turnIndex &&
    prev.opacity === next.opacity &&
    prev.question === next.question &&
    prev.runPhase === next.runPhase &&
    prev.streamPreviewRows === next.streamPreviewRows &&
    prev.streamMode === next.streamMode &&
    prev.verboseMode === next.verboseMode &&
    prev.user === next.user &&
    prev.run === next.run &&
    prev.assistant === next.assistant
  );
});

export type TurnRunPhase = "none" | "thinking" | "streaming" | "final";

export function resolveTurnRunPhase(
  run: RunEvent | null,
  assistant: AssistantEvent | null,
  uiState: UIState,
  turnId: number,
): TurnRunPhase {
  if (!run) return "none";
  if (run.status !== "running") return "final";

  if (uiState.kind === "RESPONDING" && uiState.turnId === turnId) {
    return "streaming";
  }

  if (uiState.kind === "THINKING" && uiState.turnId === turnId) {
    return "thinking";
  }

  // Defensive fallback to prevent blank/stale turn cards during rapid state churn.
  if (getAssistantContent(assistant).trim()) {
    return "streaming";
  }

  return "thinking";
}
