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

function UnifiedStreamCard({
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
  const theme = useTheme();
  const streaming = runPhase === "streaming";
  const dim = opacity !== "active";
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 4));

  const events = useMemo(
    () => resolveStreamEvents(run, assistant, streaming),
    [run, assistant, streaming],
  );

  // Pre-format response segment text through the terminal-answer formatter
  // (collapses local Markdown links and absolute paths). Done per-segment.
  const formattedSegmentBySeg = useMemo(() => {
    const map = new Map<string, ReturnType<typeof formatForBox>>();
    for (const event of events) {
      if (event.kind !== "response") continue;
      const raw = formatTerminalAnswerInline(getResponseSegmentText(event.segment));
      const sanitized = event.segment.status === "active"
        ? sanitizeStreamChunk(raw)
        : sanitizeOutput(raw);
      const normalized = normalizeOutput(sanitized);
      const classified = classifyOutput(normalized);
      map.set(event.segment.id, formatForBox(classified, contentWidth));
    }
    return map;
  }, [events, contentWidth]);

  const heading = run.runtime.model ? run.runtime.model.toUpperCase().replace(/-/g, " ") : "AGENT RESPONSE";
  const runStatus = streaming
    ? "streaming"
    : run.status === "completed"
      ? "complete"
      : run.status ?? "running";
  
  const rightBadge = run.durationMs != null && !streaming
    ? `${runStatus} • ${formatDuration(run.durationMs)}`
    : runStatus;

  const borderColor = dim ? theme.BORDER_SUBTLE : (streaming ? theme.BORDER_ACTIVE : theme.BORDER_SUBTLE);

  return (
    <DashCard cols={cols} title={heading} rightBadge={rightBadge} borderColor={borderColor}>
      {events.map((event, index) => {
        const isLast = index === events.length - 1;
        const isLiveCursorTarget = run.status === "running" && isLast;
        const actionNormalized = event.kind === "action" ? normalizeCommand(event.tool.command) : "";
        const actionLabel = event.kind === "action" ? getFriendlyActionLabel(actionNormalized) : null;

        return (
          <Box key={`${event.kind}-${event.streamSeq}`} flexDirection="column" marginTop={index > 0 ? 1 : 0}>
            {event.kind === "thinking" && (
              <>
                <Text color={theme.DIM}>  thinking</Text>
                {formatProgressBlockBodyLines(event.block.text, contentWidth - 4)
                  .slice(0, verboseMode ? undefined : COMPACT_PROCESSING_BODY_LINE_CAP)
                  .map((line, i) => (
                    <Text key={i} color={theme.DIM}>    {line || " "}</Text>
                  ))}
                {isLiveCursorTarget && event.block.status === "active" && (
                  <Text color={theme.ACCENT}>    ▌</Text>
                )}
              </>
            )}

            {event.kind === "action" && (
              <>
                <Text color={theme.DIM}>  action</Text>
                <Box>
                  <Text color={event.tool.status === "failed" ? theme.ERROR : event.tool.status === "completed" ? theme.SUCCESS : theme.INFO}>
                    {`  ${event.tool.status === "failed" ? "✕" : event.tool.status === "completed" ? "✓" : "•"} `}
                  </Text>
                  <Text color={dim ? theme.DIM : theme.TEXT}>{actionLabel ?? actionNormalized}</Text>
                  {event.tool.completedAt && (
                    <Text color={theme.DIM}>  {formatDuration(event.tool.completedAt - event.tool.startedAt)}</Text>
                  )}
                </Box>
                {actionLabel && (
                  <Text color={theme.MUTED} wrap="wrap">    {actionNormalized}</Text>
                )}
                {isLiveCursorTarget && event.tool.status === "running" && (
                  <Text color={theme.ACCENT}>    ▌</Text>
                )}
              </>
            )}

            {event.kind === "response" && (() => {
              const formatted = formattedSegmentBySeg.get(event.segment.id) ?? [];
              const segmentStreaming = event.segment.status === "active";
              const showTail = !segmentStreaming && !verboseMode && formatted.length > COMPACT_STREAMING_TAIL_CAP;
              return (
                <>
                  <Text color={theme.DIM}>  response</Text>
                  {run.status === "failed" && !streaming && isLast && (
                    <Box flexDirection="column">
                      {wrapPlainText(sanitizeTerminalOutput(run.errorMessage ?? run.summary), contentWidth - 2).map((row, i) => (
                        <Text key={i} color={theme.ERROR}>{i === 0 ? `  ✕ ${row}` : `    ${row}`}</Text>
                      ))}
                    </Box>
                  )}
                  <Box paddingLeft={2} flexDirection="column">
                    <MemoizedRenderMessage
                      segments={showTail ? formatted.slice(-COMPACT_STREAMING_TAIL_CAP) : formatted}
                      width={contentWidth - 2}
                    />
                  </Box>
                  {isLiveCursorTarget && segmentStreaming && (
                    <Text color={theme.ACCENT}>    ▌</Text>
                  )}
                </>
              );
            })()}
          </Box>
        );
      })}

      {run.status !== "running" && !verboseMode && (
        <Box marginTop={1} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={theme.BORDER_SUBTLE} paddingTop={0}>
          <ImpactSummary run={run} cols={cols} />
        </Box>
      )}
    </DashCard>
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
        <UnifiedStreamCard
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
