import React from "react";
import { Box, Text } from "ink";
import type { AssistantEvent, RunEvent, StagedRunEvent, UIState, UserPromptEvent } from "../session/types.js";
import { AgentBlock } from "./AgentBlock.js";
import { ActionRequiredBlock } from "./ActionRequiredBlock.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { StagedRunView } from "./StagedRunView.js";
import { useTheme } from "./theme.js";
import { getUsableShellWidth } from "./layout.js";
import { wrapPlainText } from "./textLayout.js";

export type TurnOpacity = "active" | "recent" | "dim";

interface TurnGroupProps {
  cols: number;
  turnIndex: number;
  user: UserPromptEvent;
  run: RunEvent | null;
  stagedRun: StagedRunEvent | null;
  assistant: AssistantEvent | null;
  uiState: UIState;
  opacity: TurnOpacity;
}

function EventCard({
  title,
  metadata,
  children,
  borderColor,
  opacity,
}: {
  title: string;
  metadata?: string;
  children: React.ReactNode;
  borderColor: string;
  opacity: TurnOpacity;
}) {
  const theme = useTheme();
  const isDim = opacity === "dim";
  
  return (
    <Box 
      flexDirection="column" 
      width="100%" 
      borderStyle="round" 
      borderColor={isDim ? theme.BORDER_SUBTLE : borderColor}
      paddingX={1}
      marginBottom={1}
    >
      <Box flexDirection="row" justifyContent="space-between" width="100%" marginBottom={1}>
        <Text color={isDim ? theme.DIM : theme.TEXT} bold>{title}</Text>
        {metadata && <Text color={theme.DIM}>{metadata}</Text>}
      </Box>
      <Box flexDirection="column" width="100%">
        {children}
      </Box>
    </Box>
  );
}

export function TurnGroup({ cols, turnIndex, user, run, stagedRun, assistant, uiState, opacity }: TurnGroupProps) {
  const theme = useTheme();
  const isThinking = run !== null && run.status === "running" && uiState.kind === "THINKING" && uiState.turnId === user.turnId;
  const isStreaming = uiState.kind === "RESPONDING" && uiState.turnId === user.turnId;
  const question = uiState.kind === "AWAITING_USER_ACTION" && uiState.turnId === user.turnId
    ? uiState.question
    : null;
  const dim = opacity !== "active";
  const hasStagedRun = stagedRun !== null;

  const timestamp = new Date(user.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const turnTitle = `Turn [${turnIndex}] USER INPUT`;
  
  return (
    <Box flexDirection="column" width="100%">
      <EventCard 
        title={turnTitle} 
        metadata={timestamp} 
        borderColor={theme.BORDER_ACTIVE} 
        opacity={opacity}
      >
        <Text color={opacity === "dim" ? theme.DIM : theme.TEXT}>{user.prompt}</Text>
      </EventCard>

      {/* Staged run view (new pipeline) */}
      {hasStagedRun && (
        <StagedRunView
          cols={cols}
          state={stagedRun.panelState}
          model={stagedRun.model}
        />
      )}

      {/* Legacy: ThinkingBlock for old runs */}
      {!hasStagedRun && run && isThinking && (
        <ThinkingBlock cols={cols} run={run} turnIndex={turnIndex} />
      )}

      {/* Legacy: AgentBlock for old runs */}
      {!hasStagedRun && run && (assistant !== null || run.status !== "running" || isStreaming) && (
        <AgentBlock
          cols={cols}
          assistant={assistant}
          run={run}
          streaming={isStreaming}
          turnIndex={turnIndex}
          dim={dim}
        />
      )}

      {question && <ActionRequiredBlock cols={cols} turnIndex={turnIndex} question={question} />}
    </Box>
  );
}

