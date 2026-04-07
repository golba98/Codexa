import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import type { AssistantEvent, RunEvent } from "../session/types.js";
import { MarkdownContent } from "./Markdown.js";
import { getUsableShellWidth } from "./layout.js";
import { useTheme } from "./theme.js";
import { wrapPlainText } from "./textLayout.js";
import { RUN_OUTPUT_TRUNCATION_NOTICE } from "../session/chatLifecycle.js";

const FLUSH_INTERVAL_MS = 60;

function useStreamBuffer(streaming: boolean) {
  const bufferRef = useRef("");
  const [displayText, setDisplayText] = useState("");

  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => {
      setDisplayText((prev) => {
        const next = bufferRef.current;
        return next !== prev ? next : prev;
      });
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [streaming]);

  return {
    displayText,
    appendToken: useCallback((token: string) => {
      bufferRef.current += token;
    }, []),
    resetBuffer: useCallback(() => {
      bufferRef.current = "";
      setDisplayText("");
    }, []),
  };
}

function useStreamingCursor() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setVisible((current) => !current), 500);
    return () => clearInterval(id);
  }, []);
  return visible;
}

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
}

export function AgentBlock({ cols, assistant, run, streaming, turnIndex, dim = false }: AgentBlockProps) {
  const theme = useTheme();
  const cursorVisible = useStreamingCursor();
  const prevContentRef = useRef("");
  const { displayText, appendToken, resetBuffer } = useStreamBuffer(streaming);

  useEffect(() => {
    if (!streaming || !assistant?.content) return;
    const nextChunk = assistant.content.slice(prevContentRef.current.length);
    if (nextChunk) {
      appendToken(nextChunk);
      prevContentRef.current = assistant.content;
    }
  }, [appendToken, assistant?.content, streaming]);

  useEffect(() => {
    if (streaming) {
      prevContentRef.current = "";
      resetBuffer();
    }
  }, [resetBuffer, streaming]);

  const content = streaming ? displayText : (assistant?.content ?? "");
  const textColor = dim ? theme.DIM : theme.TEXT;
  const sectionCols = Math.max(1, getUsableShellWidth(cols, 2));
  const contentWidth = Math.max(1, sectionCols - 6);
  const streamingRows = useMemo(() => wrapPlainText(content, contentWidth), [content, contentWidth]);
  const failureMessage = run?.status === "failed" ? (run.errorMessage ?? run.summary) : null;

  const rightBadge = streaming
    ? "streaming"
    : run?.durationMs != null
      ? `complete • ${formatDuration(run.durationMs)}`
      : run?.status === "completed"
        ? "complete"
        : run?.status ?? "";

  const heading = `codexa [${turnIndex}]`;

  return (
    <Box 
      flexDirection="column" 
      width="100%" 
      borderStyle="round" 
      borderColor={dim ? theme.BORDER_SUBTLE : theme.BORDER}
      paddingX={1}
      marginBottom={1}
    >
      <Box flexDirection="row" justifyContent="space-between" width="100%" marginBottom={1}>
        <Text color={dim ? theme.DIM : theme.TEXT} bold>{heading}</Text>
        <Text color={theme.DIM}>{rightBadge}</Text>
      </Box>

      <Box flexDirection="column" width="100%">
        {/* Failure message */}
        {!streaming && failureMessage && (
          <Box flexDirection="column" width="100%" marginBottom={1}>
            {wrapPlainText(failureMessage, contentWidth).map((row, index) => (
              <Text key={index} color={theme.ERROR}>{index === 0 ? `✕ ${row || " "}` : `  ${row || " "}`}</Text>
            ))}
          </Box>
        )}

        {/* Main content */}
        {content.length > 0 && (
          <Box flexDirection="column" width="100%">
            {streaming ? (
              streamingRows.map((row, index) => {
                const isLastRow = index === streamingRows.length - 1;
                return (
                  <Box key={`stream-${index}`} width="100%">
                    <Text color={textColor}>{row || " "}</Text>
                    {isLastRow && cursorVisible && <Text color={theme.ACCENT}>{"▌"}</Text>}
                  </Box>
                );
              })
            ) : (
              <MarkdownContent content={content} cols={cols} />
            )}
          </Box>
        )}

        {/* Footer status */}
        {!streaming && run && run.status !== "running" && (
          <Box flexDirection="column" marginTop={content.length > 0 ? 1 : 0} width="100%">
            {run.touchedFileCount > 0 ? (
              <Text color={dim ? theme.DIM : theme.SUCCESS}>
                {"✓ "}
                <Text color={dim ? theme.DIM : theme.MUTED}>
                  {run.touchedFileCount} file{run.touchedFileCount === 1 ? "" : "s"} modified
                </Text>
              </Text>
            ) : run.status === "canceled" ? (
              <Text color={theme.WARNING}>{run.summary}</Text>
            ) : run.status === "completed" && content.length === 0 ? (
              <Text color={theme.DIM}>{"(no output)"}</Text>
            ) : null}
            {run.truncatedOutput && (
              <Text color={theme.DIM}>{RUN_OUTPUT_TRUNCATION_NOTICE}</Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}

