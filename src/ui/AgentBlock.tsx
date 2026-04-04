import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import type { AssistantEvent, RunEvent } from "../session/types.js";
import { MarkdownContent } from "./Markdown.js";
import { Panel } from "./Panel.js";
import { getUsableShellWidth } from "./layout.js";
import { useTheme } from "./theme.js";
import { wrapPlainText } from "./textLayout.js";
import { RUN_OUTPUT_TRUNCATION_NOTICE } from "../session/chatLifecycle.js";

const FLUSH_INTERVAL_MS = 60;
const DEFAULT_STREAMING_PREVIEW_ROWS = 10;

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
  runPhase?: "streaming" | "final";
  streamingPreviewRows?: number;
  streamingMode?: "assistant-first";
}

export interface StreamingPreview {
  rows: string[];
  hiddenRows: number;
}

export function buildStreamingPreviewRows(rows: string[], maxRows: number): StreamingPreview {
  const safeMax = Math.max(1, maxRows);
  if (rows.length <= safeMax) {
    return { rows, hiddenRows: 0 };
  }
  return {
    rows: rows.slice(-safeMax),
    hiddenRows: rows.length - safeMax,
  };
}

export function AgentBlock({
  cols,
  assistant,
  run,
  streaming,
  turnIndex,
  dim = false,
  runPhase = streaming ? "streaming" : "final",
  streamingPreviewRows = DEFAULT_STREAMING_PREVIEW_ROWS,
}: AgentBlockProps) {
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
  const metadataColor = dim ? theme.DIM : theme.MUTED;
  const textColor = dim ? theme.DIM : theme.TEXT;
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 4));
  const streamingRows = useMemo(() => wrapPlainText(content, contentWidth), [content, contentWidth]);
  const streamPreview = useMemo(
    () => buildStreamingPreviewRows(streamingRows, streamingPreviewRows),
    [streamingPreviewRows, streamingRows],
  );
  const failureMessage = run?.status === "failed" ? (run.errorMessage ?? run.summary) : null;
  const cancelMessage = run?.status === "canceled" ? run.summary : null;
  const runStatus = runPhase === "streaming"
    ? "streaming"
    : run?.status === "completed"
      ? "complete"
      : run?.status ?? "running";
  const rightMeta = run?.durationMs != null && runPhase !== "streaming"
    ? `${runStatus} • ${formatDuration(run.durationMs)}`
    : runStatus;
  const heading = run?.model ? run.model.toUpperCase().replace(/-/g, " ") : `AGENT RESPONSE`;

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Panel
        cols={Math.max(1, getUsableShellWidth(cols, 2))}
        title={heading}
        rightTitle={rightMeta}
        borderColor={dim ? theme.BORDER_SUBTLE : theme.BORDER_ACTIVE}
        titleColor={metadataColor}
      >
        {!streaming && failureMessage && (
          <Box flexDirection="column" marginTop={1} width="100%">
            {wrapPlainText(failureMessage, contentWidth).map((row, index) => (
              <Text key={index} color={theme.ERROR}>{index === 0 ? `✕ ${row || " "}` : row || " "}</Text>
            ))}
          </Box>
        )}

        {content.length > 0 && (
          <Box flexDirection="column" marginTop={1} width="100%">
            {streaming ? (
              <>
                {streamPreview.hiddenRows > 0 && (
                  <Text color={metadataColor}>{`... ${streamPreview.hiddenRows} earlier line${streamPreview.hiddenRows === 1 ? "" : "s"} hidden`}</Text>
                )}
                {streamPreview.rows.map((row, index) => {
                  const isLastRow = index === streamPreview.rows.length - 1;
                  return (
                    <Box key={`stream-${index}`} width="100%">
                      <Text color={textColor}>{row || " "}</Text>
                      {isLastRow && cursorVisible && <Text color={theme.ACCENT}>{"▌"}</Text>}
                    </Box>
                  );
                })}
              </>
            ) : (
              <MarkdownContent content={content} cols={cols} />
            )}
          </Box>
        )}

        {!streaming && run && run.status !== "running" && (
          <Box
            flexDirection="column"
            marginTop={content.length > 0 ? 1 : 0}
            width="100%"
          >
            {run.touchedFileCount > 0 ? (
              <Text color={dim ? theme.DIM : theme.SUCCESS}>
                {"✓ "}
                <Text color={metadataColor}>
                  {run.touchedFileCount} file{run.touchedFileCount === 1 ? "" : "s"} modified
                </Text>
              </Text>
            ) : run.status === "canceled" ? (
              <Text color={theme.WARNING}>{cancelMessage}</Text>
            ) : run.status === "completed" && content.length === 0 ? (
              <Text color={theme.DIM}>{"(no output)"}</Text>
            ) : null}
            {run.truncatedOutput && (
              <Text color={theme.DIM}>{RUN_OUTPUT_TRUNCATION_NOTICE}</Text>
            )}
          </Box>
        )}
      </Panel>
    </Box>
  );
}
