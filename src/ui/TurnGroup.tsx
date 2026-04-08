import React, { memo, useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { AssistantEvent, RunEvent, RunToolActivity, UIState, UserPromptEvent } from "../session/types.js";
import { AgentBlock } from "./AgentBlock.js";
import { ActionRequiredBlock } from "./ActionRequiredBlock.js";
import { ThinkingBlock, SPINNER_FRAMES } from "./ThinkingBlock.js";
import { DashCard } from "./DashCard.js";
import { useTheme } from "./theme.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { wrapPlainText } from "./textLayout.js";
import { selectVisibleRunActivity } from "./runActivityView.js";

export type TurnOpacity = "active" | "recent" | "dim";

interface TurnGroupProps {
  cols: number;
  turnIndex: number;
  user: UserPromptEvent;
  run: RunEvent | null;
  assistant: AssistantEvent | null;
  uiState: UIState;
  opacity: TurnOpacity;
  streamPreviewRows: number;
  streamMode: "assistant-first";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── User Input Card ─────────────────────────────────────────────────────────

function UserInputCard({
  prompt,
  run,
  cols,
  dim,
}: {
  prompt: string;
  run: RunEvent | null;
  cols: number;
  dim: boolean;
}) {
  const theme = useTheme();

  const statusBadge = run
    ? run.status === "running"
      ? "active"
      : run.status === "completed"
        ? "done"
        : run.status
    : "queued";

  const borderColor = dim ? theme.BORDER_SUBTLE : (run?.status === "running" ? theme.BORDER_ACTIVE : theme.BORDER_SUBTLE);
  const contentWidth = Math.max(1, cols - 7); // DashCard side borders (│ + space each side = 4) + cols-3 adjustment
  const lines = wrapPlainText(sanitizeTerminalOutput(prompt), contentWidth);

  return (
    <DashCard cols={cols} title="USER INPUT" rightBadge={statusBadge} borderColor={borderColor}>
      {lines.map((line, i) => (
        <Text key={i} color={dim ? theme.DIM : theme.TEXT}>
          {i === 0 ? "> " : "  "}{line}
        </Text>
      ))}
    </DashCard>
  );
}

// ─── Task Status Line ────────────────────────────────────────────────────────

function TaskStatusLine({
  run,
  uiState,
  turnId,
  cols,
}: {
  run: RunEvent;
  uiState: UIState;
  turnId: number;
  cols: number;
}) {
  const theme = useTheme();
  const [frameIndex, setFrameIndex] = useState(0);

  const isActive = run.status === "running";

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setFrameIndex((current) => (current + 1) % SPINNER_FRAMES.length);
    }, 90);
    return () => clearInterval(timer);
  }, [isActive]);

  let phaseText: string;
  let badge: string;

  if (run.status !== "running") {
    phaseText = "Complete";
    badge = run.status === "failed" ? "failed" : "done";
  } else if (uiState.kind === "RESPONDING" && uiState.turnId === turnId) {
    phaseText = "Streaming response ...";
    badge = "active";
  } else {
    phaseText = "Receiving response ...";
    badge = "active";
  }

  const spinner = isActive ? SPINNER_FRAMES[frameIndex] + " " : "";
  const durationText = run.durationMs != null ? ` ${formatDuration(run.durationMs)}` : "";
  const rightText = `${badge}${durationText}`;
  const padding = Math.max(1, cols - 4 - spinner.length - phaseText.length - rightText.length - 2);

  return (
    <Box width="100%" paddingX={1}>
      <Text>
        <Text color={theme.STAR}>{"✧ "}</Text>
        {isActive && <Text color={theme.INFO}>{spinner}</Text>}
        <Text color={theme.TEXT}>{"Task: "}{phaseText}</Text>
        <Text color={theme.DIM}>{" ".repeat(padding)}{rightText}</Text>
      </Text>
    </Box>
  );
}

// ─── File Scan Card ──────────────────────────────────────────────────────────

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

// ─── Activity Card ───────────────────────────────────────────────────────────

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
  uiState,
  opacity,
  streamPreviewRows,
  streamMode,
}: TurnGroupProps) {
  const runPhase = resolveTurnRunPhase(run, assistant, uiState, user.turnId);
  const isThinking = runPhase === "thinking";
  const isStreaming = runPhase === "streaming";
  const agentRunPhase = runPhase === "streaming" ? "streaming" : "final";
  const question = uiState.kind === "AWAITING_USER_ACTION" && uiState.turnId === user.turnId
    ? uiState.question
    : null;
  const dim = opacity !== "active";
  const shouldShowAgentBlock = run !== null && (runPhase !== "thinking");
  const isFinished = run !== null && run.status !== "running";

  return (
    <Box flexDirection="column" width="100%">
      <UserInputCard
        prompt={user.prompt}
        run={run}
        cols={cols}
        dim={opacity === "dim"}
      />

      {run && (
        <>
          <TaskStatusLine run={run} uiState={uiState} turnId={user.turnId} cols={cols} />

          <Box key={`run-phase-${user.turnId}-${runPhase}`} width="100%">
            {isThinking ? (
              <ThinkingBlock cols={cols} run={run} turnIndex={turnIndex} />
            ) : shouldShowAgentBlock ? (
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
            ) : null}
          </Box>

          {isFinished && run.touchedFileCount > 0 && (
            <FileScanCard run={run} cols={cols} />
          )}

          {isFinished && run.toolActivities.length > 0 && (
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
  // Always re-render if the run is still active or changing
  const prevPhase = resolveTurnRunPhase(prev.run, prev.assistant, prev.uiState, prev.user.turnId);
  const nextPhase = resolveTurnRunPhase(next.run, next.assistant, next.uiState, next.user.turnId);

  // If either is actively running, allow normal React comparison
  if (prevPhase !== "final" || nextPhase !== "final") {
    return false; // Don't skip, allow re-render
  }

  // For finalized turns, skip re-render if key props are equal
  return (
    prev.cols === next.cols &&
    prev.turnIndex === next.turnIndex &&
    prev.opacity === next.opacity &&
    prev.user.id === next.user.id &&
    prev.run?.id === next.run?.id &&
    prev.run?.status === next.run?.status &&
    prev.assistant?.id === next.assistant?.id &&
    prev.assistant?.content === next.assistant?.content
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
  if (assistant?.content?.trim()) {
    return "streaming";
  }

  return "thinking";
}
