import React from "react";
import { Box, Text } from "ink";
import type { RunEvent } from "../session/types.js";
import { clampVisualText, getUsableShellWidth } from "./layout.js";
import { useTheme } from "./theme.js";
import { DashCard } from "./DashCard.js";
import {
  formatProgressBlockBodyLines,
  getProgressUpdateCount,
  selectVisibleProgressBlocks,
  type VisibleProgressBlock,
} from "./progressEntries.js";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const MAX_VISIBLE_PROGRESS_ENTRIES = 3;

interface ThinkingBlockProps {
  cols: number;
  run: RunEvent;
  turnIndex: number;
}

function getBlockMarker(isLive: boolean): string {
  return isLive ? "▸" : "•";
}

export function ThinkingBlock({ cols, run }: ThinkingBlockProps) {
  const theme = useTheme();
  const {
    blocks,
    hiddenCount,
    totalCount,
    latestBlock,
    latestActiveBlock,
  } = selectVisibleProgressBlocks(run.progressEntries ?? [], MAX_VISIBLE_PROGRESS_ENTRIES);
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 8));
  const updateCount = totalCount || getProgressUpdateCount(run.progressEntries ?? []);
  const currentBlock = latestActiveBlock ?? latestBlock;
  const currentText = currentBlock
    ? clampVisualText(currentBlock.headline.replace(/^Current:\s*/i, ""), Math.max(1, contentWidth - 9))
    : null;
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
        <Text color={theme.DIM}>Codex is working...</Text>
      ) : (
        <Box flexDirection="column" width="100%">
          {currentText && run.status === "running" && (
            <Box width="100%">
              <Text color={theme.INFO} bold>Current: </Text>
              <Text color={theme.TEXT}>{currentText}</Text>
            </Box>
          )}
          {hiddenCount > 0 && (
            <Box marginTop={currentText && run.status === "running" ? 1 : 0}>
              <Text color={theme.DIM}>{`... ${hiddenCount} earlier update${hiddenCount === 1 ? "" : "s"}`}</Text>
            </Box>
          )}
          {blocks.map((block, blockIndex) => {
            const isLive = run.status === "running" && block.isActive;
            return (
              <Box
                key={block.key}
                flexDirection="column"
                width="100%"
                marginTop={blockIndex === 0 && hiddenCount === 0 && !(currentText && run.status === "running") ? 0 : 1}
              >
                <Text color={isLive ? theme.ACCENT : theme.INFO} bold={isLive}>
                  {`${getBlockMarker(isLive)} ${isLive ? "Live" : block.label}`}
                </Text>
                {formatProgressBlockBodyLines(block.text, contentWidth).map((line, lineIndex) => (
                  <Text key={`${block.key}-${lineIndex}`} color={theme.MUTED}>
                    {line ? `${isLive ? "  | " : "    "}${line}` : " "}
                  </Text>
                ))}
                {isLive && (
                  <Text color={theme.ACCENT}>  | ▌</Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </DashCard>
  );
}
