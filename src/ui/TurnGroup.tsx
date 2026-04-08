import React, { memo } from "react";
import { Box, Text } from "ink";
import type { AssistantEvent, RunEvent, UIState, UserPromptEvent } from "../session/types.js";
import { AgentBlock } from "./AgentBlock.js";
import { ActionRequiredBlock } from "./ActionRequiredBlock.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { useTheme } from "./theme.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";

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

function formatTime(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function UserSummary({
  prompt,
  createdAt,
  turnIndex,
  dim,
  run,
  cols,
}: {
  prompt: string;
  createdAt: number;
  turnIndex: number;
  dim: boolean;
  run: RunEvent | null;
  cols: number;
}) {
  const theme = useTheme();
  const metaColor = dim ? theme.DIM : theme.MUTED;
  const textColor = dim ? theme.DIM : theme.TEXT;

  const statusText = run
    ? run.status === "running"
      ? "running"
      : run.status === "completed"
        ? "complete"
        : run.status
    : "queued";
  const durationText = run?.durationMs != null && run.status !== "running"
    ? formatDuration(run.durationMs)
    : null;
  const rightMeta = durationText ? `${statusText} • ${durationText}` : statusText;

  return (
    <Box flexDirection="column" marginBottom={0} width="100%" paddingLeft={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={dim ? theme.DIM : theme.ACCENT} bold>{"❯ "}</Text>
        <Text color={textColor} bold wrap="wrap">
          {sanitizeTerminalOutput(prompt)}
        </Text>
        <Text color={theme.DIM}>{rightMeta}</Text>
      </Box>
    </Box>
  );
}

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

  return (
    <Box flexDirection="column" width="100%">
      <UserSummary
        prompt={user.prompt}
        createdAt={user.createdAt}
        turnIndex={turnIndex}
        dim={opacity === "dim"}
        run={run}
        cols={cols}
      />

      {run && (
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
