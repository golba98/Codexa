/**
 * ThinkingPanel — displays concise operational progress summaries.
 * Shows what the AI is doing without exposing raw chain-of-thought.
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import { getUsableShellWidth } from "../layout.js";
import { wrapPlainText } from "../textLayout.js";

interface ThinkingPanelProps {
  cols: number;
  title?: string;
  summaries: string[];
  active?: boolean;
  maxVisible?: number;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function ThinkingPanel({
  cols,
  title = "Processing",
  summaries,
  active = false,
  maxVisible: maxVisibleProp,
}: ThinkingPanelProps) {
  const theme = useTheme();
  const [frameIndex, setFrameIndex] = React.useState(0);

  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setFrameIndex((i) => (i + 1) % SPINNER_FRAMES.length);
    }, 90);
    return () => clearInterval(timer);
  }, [active]);

  // Show nothing if no summaries and not active
  if (summaries.length === 0 && !active) return null;

  // Enforce 3 lines in 80x24 mode, otherwise default to 5
  const maxVisible = maxVisibleProp || (cols <= 80 ? 3 : 5);
  const visibleSummaries = summaries.slice(-maxVisible);
  const hiddenCount = Math.max(0, summaries.length - maxVisible);
  const sectionCols = Math.max(1, getUsableShellWidth(cols, 2));
  const contentWidth = Math.max(1, sectionCols - 2);

  const panelTitle = active ? `${SPINNER_FRAMES[frameIndex]} ${title}` : title;

  return (
    <Box marginBottom={1} width="100%" paddingLeft={2}>
      <Box flexDirection="column" width="100%">
        {hiddenCount > 0 && (
          <Text color={theme.DIM}>… {hiddenCount} more actions hidden above</Text>
        )}
        {visibleSummaries.map((summary, idx) => {
          const isLatest = idx === visibleSummaries.length - 1;
          const rows = wrapPlainText(summary, contentWidth);
          return (
            <Box key={idx} flexDirection="column" width="100%">
              {rows.map((row, rowIdx) => (
                <Box key={rowIdx} width="100%">
                  <Text color={theme.MUTED}>
                    {rowIdx === 0 ? "• " : "  "}
                  </Text>
                  <Text color={isLatest && active ? theme.TEXT : theme.DIM}>
                    {row || " "}
                  </Text>
                </Box>
              ))}
            </Box>
          );
        })}
        {active && summaries.length === 0 && (
          <Text color={theme.DIM}>Analyzing...</Text>
        )}
      </Box>
    </Box>
  );
}
