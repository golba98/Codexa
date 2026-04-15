import React, { memo, useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { AssistantEvent, RunEvent, RunToolActivity, UIState, UserPromptEvent } from "../session/types.js";
import { getAssistantContent } from "../session/types.js";
import { AgentBlock } from "./AgentBlock.js";
import { ActionRequiredBlock } from "./ActionRequiredBlock.js";
import { ThinkingBlock, SPINNER_FRAMES } from "./ThinkingBlock.js";
import { DashCard } from "./DashCard.js";
import { useTheme } from "./theme.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { wrapPlainText } from "./textLayout.js";
import { selectVisibleRunActivity } from "./runActivityView.js";
import type { RunFileActivity } from "../core/workspaceActivity.js";
import type { RunActivitySummary } from "../core/workspaceActivity.js";

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

// ─── Status Line ─────────────────────────────────────────────────────────────
// Single line: "⠋ CODEXA is working..." or "✔ Complete • 2.1s"

function StatusLine({
  status,
  durationMs,
  runPhase,
  cols,
}: {
  status: RunEvent["status"];
  durationMs: number | null;
  runPhase: TurnRunPhase;
  cols: number;
}) {
  const theme = useTheme();
  const [frameIndex, setFrameIndex] = useState(0);

  const isActive = status === "running";

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setFrameIndex((current) => (current + 1) % SPINNER_FRAMES.length);
    }, 90);
    return () => clearInterval(timer);
  }, [isActive]);

  if (status !== "running") {
    // Completed state — clean summary line
    const icon = status === "failed" ? "✕" : "✔";
    const iconColor = status === "failed" ? theme.ERROR : theme.SUCCESS;
    const label = status === "failed" ? "Failed" : status === "canceled" ? "Canceled" : "Complete";
    const duration = durationMs != null ? ` • ${formatDuration(durationMs)}` : "";

    return (
      <Box width="100%" paddingX={1}>
        <Text>
          <Text color={iconColor}>{icon} </Text>
          <Text color={theme.DIM}>{label}{duration}</Text>
        </Text>
      </Box>
    );
  }

  // Active state — spinner + concise status
  const spinner = SPINNER_FRAMES[frameIndex];
  const statusText = runPhase === "streaming"
    ? "Streaming response..."
    : "CODEXA is working...";

  return (
    <Box width="100%" paddingX={1}>
      <Text>
        <Text color={theme.INFO}>{spinner} </Text>
        <Text color={theme.MUTED}>{statusText}</Text>
      </Text>
    </Box>
  );
}

const MemoizedStatusLine = memo(StatusLine, (prev, next) => (
  prev.status === next.status
  && prev.durationMs === next.durationMs
  && prev.runPhase === next.runPhase
  && prev.cols === next.cols
));

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

function ActivityCard({ run, cols }: { run: RunEvent; cols: number }) {
  const theme = useTheme();

  return (
    <DashCard cols={cols} title="Activity" rightBadge="done">
      {run.toolActivities.map((tool: RunToolActivity, i: number) => {
        const duration = tool.completedAt && tool.startedAt
          ? formatDuration(tool.completedAt - tool.startedAt)
          : null;
        const icon = tool.status === "failed" ? "✕" : "✓";
        const iconColor = tool.status === "failed" ? theme.ERROR : theme.SUCCESS;

        return (
          <Box key={tool.id || i} flexDirection="column">
            <Text>
              <Text color={iconColor}>{icon} </Text>
              <Text color={theme.TEXT}>{tool.command}</Text>
              {duration && <Text color={theme.DIM}>{" • "}{duration}</Text>}
            </Text>
            {tool.summary && (
              <Text color={theme.MUTED}>{"  "}{tool.summary}</Text>
            )}
          </Box>
        );
      })}
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
  streamPreviewRows,
  streamMode,
  verboseMode = false,
}: TurnGroupProps) {
  const isThinking = runPhase === "thinking";
  const isStreaming = runPhase === "streaming";
  const agentRunPhase = runPhase === "streaming" ? "streaming" : "final";
  const dim = opacity !== "active";
  const shouldShowAgentBlock = run !== null && (runPhase !== "thinking");
  const isFinished = run !== null && run.status !== "running";

  return (
    <Box flexDirection="column" width="100%">
      <MemoizedUserInputCard
        prompt={user.prompt}
        cols={cols}
        dim={opacity === "dim"}
      />

      {run && (
        <>
          <MemoizedStatusLine status={run.status} durationMs={run.durationMs} runPhase={runPhase} cols={cols} />

          {isThinking && !verboseMode && (
            /* Default: no ThinkingBlock card, just the spinner line above */
            null
          )}

          {isThinking && verboseMode && (
            <ThinkingBlock cols={cols} run={run} turnIndex={turnIndex} />
          )}

          {shouldShowAgentBlock && (
            <AgentBlock
              cols={cols}
              assistant={assistant}
              run={run}
              streaming={isStreaming}
              turnIndex={turnIndex}
              dim={dim}
              runPhase={agentRunPhase}
              streamingPreviewRows={streamPreviewRows}
              streamingMode={streamMode}
            />
          )}

          {isFinished && !verboseMode && (
            <ImpactSummary run={run} cols={cols} />
          )}

          {isFinished && verboseMode && run.touchedFileCount > 0 && (
            <FileScanCard run={run} cols={cols} />
          )}

          {isFinished && verboseMode && run.toolActivities.length > 0 && (
            <ActivityCard run={run} cols={cols} />
          )}
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
