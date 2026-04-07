/**
 * ResultPanel — displays the final structured answer.
 * Supports streaming content and markdown rendering.
 */

import React from "react";
import { Box, Text } from "ink";
import { MarkdownContent } from "../Markdown.js";
import { useTheme } from "../theme.js";
import { getUsableShellWidth } from "../layout.js";
import { wrapPlainText } from "../textLayout.js";
import { filterVerboseInstructions } from "../contentFilter.js";
import type { ResultSection } from "../../orchestration/panelState.js";

interface ResultPanelProps {
  cols: number;
  title?: string;
  sections?: ResultSection[];
  partialContent?: string;
  finalContent?: string;
  streaming?: boolean;
  model?: string;
  durationMs?: number | null;
}

const SECTION_LABELS: Record<string, string> = {
  intro: "Overview",
  analysis: "Analysis",
  suggestion: "Suggestions",
  implementation: "Implementation",
  summary: "Summary",
  explanation: "Explanation",
};

export function ResultPanel({
  cols,
  title,
  sections = [],
  partialContent = "",
  finalContent = "",
  streaming = false,
  model,
  durationMs,
}: ResultPanelProps) {
  const theme = useTheme();
  const [cursorVisible, setCursorVisible] = React.useState(true);

  // Streaming cursor blink
  React.useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setCursorVisible((v) => !v), 500);
    return () => clearInterval(timer);
  }, [streaming]);

  // Determine content to display (filter instructions from final content)
  const rawContent = finalContent || partialContent;
  const content = streaming ? rawContent : filterVerboseInstructions(rawContent);
  const hasContent = content.length > 0 || sections.length > 0;

  // Show nothing if no content
  if (!hasContent && !streaming) return null;

  const sectionCols = Math.max(1, getUsableShellWidth(cols, 2));
  const contentWidth = sectionCols - 2;

  return (
    <Box marginBottom={1} width="100%" paddingLeft={2}>
      <Box flexDirection="column" width="100%">
        {/* Render sections */}
        {sections.map((section, idx) => (
          <Box key={idx} flexDirection="column" marginBottom={1} width="100%">
            <Text color={theme.ACCENT} bold>
              {SECTION_LABELS[section.type] || section.type.toUpperCase()}
            </Text>
            <Box marginTop={0} width="100%">
              <MarkdownContent content={filterVerboseInstructions(section.content)} cols={cols} />
            </Box>
          </Box>
        ))}

        {/* Render main content */}
        {content && (
          <Box flexDirection="column" width="100%">
            {streaming ? (
              // Streaming mode: plain text with cursor
              <Box flexDirection="column" width="100%">
                {wrapPlainText(content, contentWidth).map((row, idx, arr) => {
                  const isLast = idx === arr.length - 1;
                  return (
                    <Box key={idx} width="100%">
                      <Text color={theme.TEXT}>{row || " "}</Text>
                      {isLast && cursorVisible && (
                        <Text color={theme.ACCENT}>▌</Text>
                      )}
                    </Box>
                  );
                })}
              </Box>
            ) : (
              // Final mode: markdown rendered
              <MarkdownContent content={content} cols={cols} />
            )}
          </Box>
        )}

        {/* Empty state while streaming */}
        {!hasContent && streaming && (
          <Text color={theme.DIM}>Waiting for response...</Text>
        )}
      </Box>
    </Box>
  );
}
