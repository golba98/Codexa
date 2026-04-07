/**
 * ActivityPanel — displays tool and shell command activity.
 */

import React from "react";
import { Box, Text } from "ink";
import { truncateEnd } from "../displayText.js";
import { useTheme } from "../theme.js";
import { getUsableShellWidth } from "../layout.js";
import { getTextWidth, wrapPlainText, wrapTextRows } from "../textLayout.js";
import type { ToolActivity } from "../../orchestration/panelState.js";

interface ActivityPanelProps {
  cols: number;
  title?: string;
  tools: ToolActivity[];
  maxVisible?: number;
}

const STATUS_ICONS: Record<string, string> = {
  running: "▶",
  completed: "✓",
  failed: "✕",
};

export function ActivityPanel({
  cols,
  title = "Activity",
  tools,
  maxVisible: maxVisibleProp,
}: ActivityPanelProps) {
  const theme = useTheme();
  const [, setTick] = React.useState(0);

  // Force re-render for running tools (elapsed time)
  React.useEffect(() => {
    const hasRunning = tools.some((t) => t.status === "running");
    if (!hasRunning) return;

    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [tools]);

  // Show nothing if no tools
  if (tools.length === 0) return null;

  // Enforce 3 lines in 80x24 mode, otherwise default to 5
  const maxVisible = maxVisibleProp || (cols <= 80 ? 3 : 5);
  const visibleTools = tools.slice(-maxVisible);
  const hiddenCount = Math.max(0, tools.length - maxVisible);
  const sectionCols = Math.max(1, getUsableShellWidth(cols, 2));
  const contentWidth = sectionCols - 2;
  const activeCount = tools.filter((t) => t.status === "running").length;

  return (
    <Box marginBottom={1} width="100%" paddingLeft={2}>
      <Box flexDirection="column" width="100%">
        {hiddenCount > 0 && (
          <Text color={theme.DIM}>… {hiddenCount} more actions hidden above</Text>
        )}
        {visibleTools.map((tool) => {
          const icon = STATUS_ICONS[tool.status] ?? "•";
          const isRunning = tool.status === "running";
          const isFailed = tool.status === "failed";

          const iconColor = isRunning
            ? theme.INFO
            : isFailed
              ? theme.ERROR
              : theme.SUCCESS;

          // Calculate elapsed time
          let elapsed = "";
          if (tool.completedAt && tool.startedAt) {
            const ms = tool.completedAt - tool.startedAt;
            elapsed = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
          } else if (isRunning && tool.startedAt) {
            const ms = Date.now() - tool.startedAt;
            elapsed = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
          }

          const primaryText = tool.command || tool.name;
          const elapsedSuffix = elapsed ? ` • ${elapsed}` : "";
          const elapsedWidth = getTextWidth(elapsedSuffix);
          const firstLineWidth = Math.max(1, contentWidth - 2 - elapsedWidth);
          const wrappedPrimary = wrapTextRows(primaryText, firstLineWidth);
          const firstRow = wrappedPrimary[0];
          const continuationText = firstRow ? primaryText.slice(firstRow.end) : "";
          const continuationRows = continuationText
            ? wrapPlainText(continuationText, Math.max(1, contentWidth - 2))
            : [];
          const detailRows = tool.summary || tool.message
            ? wrapPlainText(tool.summary || tool.message || "", Math.max(1, contentWidth - 2))
            : [];

          return (
            <Box key={tool.id} flexDirection="column" marginBottom={0} width="100%">
              <Box width="100%">
                <Text color={iconColor}>{icon} </Text>
                <Text color={isRunning ? theme.TEXT : theme.MUTED} bold={isRunning}>
                  {truncateEnd(firstRow?.text || tool.name, firstLineWidth)}
                </Text>
                {elapsed && (
                  <Text color={theme.DIM}>{elapsedSuffix}</Text>
                )}
              </Box>
              {continuationRows.map((row, idx) => (
                <Box key={idx} paddingLeft={2} width="100%">
                  <Text color={theme.DIM}>{row}</Text>
                </Box>
              ))}
              {detailRows.map((row, idx) => (
                <Box key={`detail-${idx}`} paddingLeft={2} width="100%">
                  <Text color={isFailed ? theme.ERROR : theme.DIM}>{row || " "}</Text>
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
