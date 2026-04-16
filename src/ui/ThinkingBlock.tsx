import React from "react";
import { Box, Text } from "ink";
import type { RunEvent } from "../session/types.js";
import { getUsableShellWidth } from "./layout.js";
import { useTheme } from "./theme.js";
import { DashCard } from "./DashCard.js";
import {
  formatProgressBlockBodyLines,
  getProgressUpdateCount,
  selectVisibleProgressBlocks,
} from "./progressEntries.js";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const MAX_VISIBLE_PROGRESS_ENTRIES = 3;

interface ThinkingBlockProps {
  cols: number;
  run: RunEvent;
  turnIndex: number;
}

export function ThinkingBlock({ cols, run }: ThinkingBlockProps) {
  const theme = useTheme();
  const { blocks, hiddenCount, totalCount } = selectVisibleProgressBlocks(run.progressEntries ?? [], MAX_VISIBLE_PROGRESS_ENTRIES);
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 8));
  const updateCount = totalCount || getProgressUpdateCount(run.progressEntries ?? []);
  const rightBadge = run.status === "running"
    ? "active"
    : `${updateCount} update${updateCount === 1 ? "" : "s"}`;

  return (
    <DashCard
      cols={cols}
      title="Processing"
      rightBadge={rightBadge}
      borderColor={run.status === "running" ? theme.BORDER_ACTIVE : theme.BORDER_SUBTLE}
    >
      {blocks.length === 0 ? (
        <Text color={theme.DIM}>Waiting for response...</Text>
      ) : (
        <Box flexDirection="column" width="100%">
          {hiddenCount > 0 && (
            <Text color={theme.DIM}>{`... ${hiddenCount} earlier update${hiddenCount === 1 ? "" : "s"}`}</Text>
          )}
          {blocks.map((block, blockIndex) => (
            <Box key={block.key} flexDirection="column" width="100%" marginTop={blockIndex === 0 && hiddenCount === 0 ? 0 : 1}>
              <Text color={theme.INFO}>{block.label}</Text>
              {formatProgressBlockBodyLines(block.text, contentWidth).map((line, lineIndex) => (
                <Text key={`${block.key}-${lineIndex}`} color={theme.MUTED}>
                  {line ? `  ${line}` : " "}
                </Text>
              ))}
            </Box>
          ))}
        </Box>
      )}
    </DashCard>
  );
}
