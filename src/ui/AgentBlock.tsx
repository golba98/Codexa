import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import type { AssistantEvent, RunEvent, RunToolActivity } from "../session/types.js";
import { MarkdownContent } from "./Markdown.js";
import { getUsableShellWidth } from "./layout.js";
import { useTheme } from "./theme.js";
import { formatRunActivityStats, selectVisibleRunActivity } from "./runActivityView.js";
import { getTextWidth, wrapPlainText } from "./textLayout.js";
import { RUN_OUTPUT_TRUNCATION_NOTICE } from "../session/chatLifecycle.js";

const FLUSH_INTERVAL_MS = 60;
const MAX_VISIBLE_TOOL_ACTIVITIES = 4;

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

function getVisibleToolActivities(run: RunEvent) {
  const visible = run.toolActivities.slice(-MAX_VISIBLE_TOOL_ACTIVITIES);
  return {
    visible,
    hiddenCount: Math.max(0, run.toolActivities.length - visible.length),
  };
}

function ToolActivityBlock({
  activity,
  width,
  metadataColor,
  mutedColor,
  accentColor,
  errorColor,
}: {
  activity: RunToolActivity;
  width: number;
  metadataColor: string;
  mutedColor: string;
  accentColor: string;
  errorColor: string;
}) {
  const markerWidth = getTextWidth("✧ ");
  const heading = activity.status === "running"
    ? `Executing: ${activity.command}`
    : `Executed: ${activity.command}`;
  const headingRows = wrapPlainText(heading, Math.max(1, width - markerWidth));
  const summaryRows = activity.summary ? wrapPlainText(activity.summary, width) : [];
  const headingColor = activity.status === "failed" ? errorColor : metadataColor;
  const summaryColor = activity.status === "failed" ? errorColor : mutedColor;
  const markerColor = activity.status === "failed" ? errorColor : accentColor;

  return (
    <Box flexDirection="column" marginBottom={summaryRows.length > 0 ? 1 : 0} width="100%">
      {headingRows.map((row, index) => (
        <Box key={`${activity.id}-heading-${index}`} width="100%">
          <Text color={markerColor}>{index === 0 ? "✧ " : "  "}</Text>
          <Text color={headingColor}>{row || " "}</Text>
        </Box>
      ))}
      {summaryRows.map((row, index) => (
        <Box key={`${activity.id}-summary-${index}`} paddingLeft={2} width="100%">
          <Text color={summaryColor}>{row || " "}</Text>
        </Box>
      ))}
    </Box>
  );
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
  const metadataColor = dim ? theme.DIM : theme.MUTED;
  const textColor = dim ? theme.DIM : theme.TEXT;
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 4));
  const streamingRows = useMemo(() => wrapPlainText(content, contentWidth), [content, contentWidth]);
  const activityStats = run ? formatRunActivityStats(run) : null;
  const { visible: visibleActivity, hiddenCount } = run
    ? selectVisibleRunActivity(run)
    : { visible: [], hiddenCount: 0 };
  const { visible: visibleTools, hiddenCount: hiddenToolCount } = run
    ? getVisibleToolActivities(run)
    : { visible: [], hiddenCount: 0 };
  const failureMessage = run?.status === "failed" ? (run.errorMessage ?? run.summary) : null;
  const cancelMessage = run?.status === "canceled" ? run.summary : null;

  const rightMeta = streaming
    ? "streaming..."
    : run?.durationMs != null && run.status !== "running"
      ? `${run.status}  •  ${formatDuration(run.durationMs)}`
      : null;

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Box width="100%" justifyContent="space-between" overflow="hidden">
        <Box overflow="hidden">
          <Text color={dim ? theme.DIM : theme.ACCENT}>{"✧ "}</Text>
          <Text color={metadataColor} bold>{"codexa"}</Text>
        </Box>
        {rightMeta && (
          <Box flexShrink={0}>
            <Text color={theme.DIM}>{rightMeta}</Text>
          </Box>
        )}
      </Box>

      {activityStats && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1} width="100%">
          {wrapPlainText(activityStats, contentWidth).map((row, index) => (
            <Text key={index} color={metadataColor}>{row || " "}</Text>
          ))}
        </Box>
      )}

      {visibleTools.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1} width="100%">
          {visibleTools.map((tool) => (
            <ToolActivityBlock
              key={tool.id}
              activity={tool}
              width={contentWidth}
              metadataColor={metadataColor}
              mutedColor={theme.DIM}
              accentColor={theme.ACCENT}
              errorColor={theme.ERROR}
            />
          ))}
          {hiddenToolCount > 0 && (
            <Text color={theme.DIM}>{`+${hiddenToolCount} more tool step${hiddenToolCount === 1 ? "" : "s"}`}</Text>
          )}
        </Box>
      )}

      {!dim && visibleActivity.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1} width="100%">
          {visibleActivity.map((item, index) => {
            const prefix = item.operation === "created" ? "+ "
              : item.operation === "deleted" ? "- "
              : "~ ";
            const prefixColor = item.operation === "created" ? theme.SUCCESS
              : item.operation === "deleted" ? theme.ERROR
              : theme.WARNING;
            const stats = [
              item.addedLines ? `+${item.addedLines}` : null,
              item.removedLines ? `-${item.removedLines}` : null,
            ].filter(Boolean).join(" ");

            return (
              <Box key={`${item.path}-${index}`} width="100%">
                <Text color={prefixColor}>{prefix}</Text>
                <Box flexGrow={1} flexShrink={1}>
                  <Text color={metadataColor} wrap="truncate">{item.path}</Text>
                </Box>
                {stats && <Text color={theme.DIM}>{`  ${stats}`}</Text>}
              </Box>
            );
          })}
          {hiddenCount > 0 && (
            <Text color={theme.DIM}>{`+${hiddenCount} more`}</Text>
          )}
        </Box>
      )}

      {!streaming && failureMessage && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1} width="100%">
          {wrapPlainText(failureMessage, contentWidth).map((row, index) => (
            <Text key={index} color={theme.ERROR}>{index === 0 ? `✕ ${row || " "}` : row || " "}</Text>
          ))}
        </Box>
      )}

      {content.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} marginTop={1} width="100%">
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
            <MarkdownContent content={content} />
          )}
        </Box>
      )}

      {!streaming && run && run.status !== "running" && (
        <Box
          flexDirection="column"
          paddingLeft={2}
          marginTop={content.length > 0 || visibleActivity.length > 0 || visibleTools.length > 0 || !!activityStats ? 1 : 0}
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
    </Box>
  );
}
