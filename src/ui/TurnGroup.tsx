import React from "react";
import { Box, Text } from "ink";
import type { AssistantEvent, RunEvent, UIState, UserPromptEvent } from "../session/types.js";
import { AgentBlock } from "./AgentBlock.js";
import { ActionRequiredBlock } from "./ActionRequiredBlock.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { useTheme } from "./theme.js";
import { getUsableShellWidth } from "./layout.js";

import { Panel } from "./Panel.js";

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
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Panel
        cols={Math.max(1, getUsableShellWidth(cols, 2))}
        title="USER INPUT"
        rightTitle={rightMeta}
        borderColor={dim ? theme.BORDER_SUBTLE : theme.BORDER_ACTIVE}
        titleColor={metaColor}
      >
        <Text color={textColor} bold wrap="wrap">
          {`> ${prompt}`}
        </Text>
      </Panel>
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
