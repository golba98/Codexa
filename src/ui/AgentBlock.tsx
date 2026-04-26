import React, { memo, useDeferredValue, useMemo } from "react";
import { Box, Text } from "ink";
import type { AssistantEvent, RunEvent } from "../session/types.js";
import { getAssistantContent } from "../session/types.js";
import { MemoizedRenderMessage } from "./Markdown.js";
import { getUsableShellWidth } from "./layout.js";
import { useTheme } from "./theme.js";
import { wrapPlainText } from "./textLayout.js";
import { RUN_OUTPUT_TRUNCATION_NOTICE } from "../session/chatLifecycle.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import {
  sanitizeOutput,
  sanitizeStreamChunk,
  normalizeOutput,
  classifyOutput,
  formatForBox,
} from "./outputPipeline.js";
import { DashCard } from "./DashCard.js";


function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface AgentBlockProps {
  cols: number;
  assistant: AssistantEvent | null;
  run: RunEvent | null;
  streaming: boolean;
  turnIndex: number;
  dim?: boolean;
  runPhase?: "streaming" | "final";
  streamingPreviewRows?: number;
  streamingMode?: "assistant-first";
}

const MemoizedMessageBody = memo(function MessageBody({
  segments,
  width,
}: {
  segments: ReturnType<typeof formatForBox>;
  width: number;
}) {
  return <MemoizedRenderMessage segments={segments} width={width} />;
}, (prev, next) => prev.segments === next.segments && prev.width === next.width);

const StreamingCursor = memo(function StreamingCursor() {
  const theme = useTheme();
  return (
    <Box width="100%" paddingLeft={2}>
      <Text color={theme.ACCENT}>{"▌"}</Text>
    </Box>
  );
});

export function AgentBlock({
  cols,
  assistant,
  run,
  streaming,
  dim = false,
  runPhase = streaming ? "streaming" : "final",
}: AgentBlockProps) {
  const theme = useTheme();
  const content = getAssistantContent(assistant);
  const deferredContent = useDeferredValue(content);
  // During streaming, use content directly for immediate rendering.
  // When not streaming, defer large final content to avoid blocking input.
  const renderContent = streaming ? content : deferredContent;
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 4));

  const pipelineState = useMemo(() => {
    const sanitized = streaming ? sanitizeStreamChunk(renderContent) : sanitizeOutput(renderContent);
    const normalized = normalizeOutput(sanitized);
    const classified = classifyOutput(normalized);
    const formatted = formatForBox(classified, contentWidth);
    return { length: normalized.length, formatted };
  }, [contentWidth, renderContent, streaming]);

  const failureMessage = run?.status === "failed"
    ? sanitizeTerminalOutput(run.errorMessage ?? run.summary)
    : null;
  const cancelMessage = run?.status === "canceled" ? sanitizeTerminalOutput(run.summary) : null;

  const runStatus = runPhase === "streaming"
    ? "streaming"
    : run?.status === "completed"
      ? "complete"
      : run?.status ?? "running";
  const rightBadge = run?.durationMs != null && runPhase !== "streaming"
    ? `${runStatus} • ${formatDuration(run.durationMs)}`
    : runStatus;
  const heading = run?.runtime.model ? run.runtime.model.toUpperCase().replace(/-/g, " ") : "Codex";

  const borderColor = dim ? theme.BORDER_SUBTLE : (runPhase === "streaming" ? theme.BORDER_ACTIVE : theme.BORDER_SUBTLE);

  return (
    <DashCard cols={cols} title={heading} rightBadge={rightBadge} borderColor={borderColor}>
      {!streaming && failureMessage && (
        <Box flexDirection="column" width="100%">
          {wrapPlainText(failureMessage, contentWidth).map((row, index) => (
            <Text key={index} color={theme.ERROR}>{index === 0 ? `✕ ${row || " "}` : row || " "}</Text>
          ))}
        </Box>
      )}

      {pipelineState.length > 0 && (
        <Box flexDirection="column" width="100%">
          <MemoizedMessageBody segments={pipelineState.formatted} width={contentWidth} />
        </Box>
      )}

      {streaming && <StreamingCursor />}

      {!streaming && run && run.status !== "running" && (
        <Box flexDirection="column" width="100%">
          {run.status === "canceled" && cancelMessage ? (
            <Text color={theme.WARNING}>{cancelMessage}</Text>
          ) : run.status === "completed" && pipelineState.length === 0 ? (
            <Text color={theme.DIM}>{"(no output)"}</Text>
          ) : null}
          {run.truncatedOutput && (
            <Text color={theme.DIM}>{RUN_OUTPUT_TRUNCATION_NOTICE}</Text>
          )}
        </Box>
      )}
    </DashCard>
  );
}
