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
  opacity: TurnOpacity;
  question: string | null;
  runPhase: TurnRunPhase;
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
  status,
  cols,
  dim,
}: {
  prompt: string;
  status: RunEvent["status"] | null;
  cols: number;
  dim: boolean;
}) {
  const theme = useTheme();

  const statusBadge = status
    ? status === "running"
      ? "active"
      : status === "completed"
        ? "done"
        : status
    : "queued";

  const borderColor = dim ? theme.BORDER_SUBTLE : (status === "running" ? theme.BORDER_ACTIVE : theme.BORDER_SUBTLE);
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

const MemoizedUserInputCard = memo(UserInputCard, (prev, next) => (
  prev.prompt === next.prompt
  && prev.status === next.status
  && prev.cols === next.cols
  && prev.dim === next.dim
));

// ─── Task Status Line ────────────────────────────────────────────────────────

function TaskStatusLine({
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

  let phaseText: string;
  let badge: string;

  if (status !== "running") {
    phaseText = "Complete";
    badge = status === "failed" ? "failed" : "done";
  } else {
    // Sync dots to the spinner index (which ticks at 90ms).
    // Math.floor(frameIndex / 3) updates every 270ms, 4 frames logic
    const dotsCount = Math.floor(frameIndex / 3) % 4; // 0, 1, 2, 3
    const dots = ".".repeat(dotsCount).padEnd(3, " ");
    const baseText = runPhase === "streaming" ? "Streaming response" : "Receiving response";
    phaseText = `${baseText} ${dots}`;
    badge = "active";
  }

  const spinner = isActive ? SPINNER_FRAMES[frameIndex] + " " : "";
  const durationText = durationMs != null ? ` ${formatDuration(durationMs)}` : "";
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

const MemoizedTaskStatusLine = memo(TaskStatusLine, (prev, next) => (
  prev.status === next.status
  && prev.durationMs === next.durationMs
  && prev.runPhase === next.runPhase
  && prev.cols === next.cols
));

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
  opacity,
  question,
  runPhase,
  streamPreviewRows,
  streamMode,
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
        status={run?.status ?? null}
        cols={cols}
        dim={opacity === "dim"}
      />

      {run && (
        <>
          <MemoizedTaskStatusLine status={run.status} durationMs={run.durationMs} runPhase={runPhase} cols={cols} />

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
  return (
    prev.cols === next.cols &&
    prev.turnIndex === next.turnIndex &&
    prev.opacity === next.opacity &&
    prev.question === next.question &&
    prev.runPhase === next.runPhase &&
    prev.streamPreviewRows === next.streamPreviewRows &&
    prev.streamMode === next.streamMode &&
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
  if (assistant?.content?.trim()) {
    return "streaming";
  }

  return "thinking";
}
