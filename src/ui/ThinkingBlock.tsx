import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { RunEvent } from "../session/types.js";
import { getUsableShellWidth } from "./layout.js";
import { wrapPlainText } from "./textLayout.js";
import { useTheme } from "./theme.js";
import { DashCard } from "./DashCard.js";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const MAX_VISIBLE_THINKING_LINES = 5;

interface ThinkingBlockProps {
  cols: number;
  run: RunEvent;
  turnIndex: number;
}

export function ThinkingBlock({ cols, run }: ThinkingBlockProps) {
  const theme = useTheme();

  const latestTool = run.toolActivities[run.toolActivities.length - 1] ?? null;
  const toolLine = latestTool
    ? latestTool.status === "running"
      ? `running: ${latestTool.command}`
      : latestTool.summary ?? latestTool.command
    : null;

  const thinkingLines = run.thinkingLines ?? [];
  const hasThinking = thinkingLines.length > 0;
  const hasContent = hasThinking || toolLine;

  if (!hasContent) return null;

  const hiddenCount = Math.max(0, thinkingLines.length - MAX_VISIBLE_THINKING_LINES);
  const visibleLines = thinkingLines.slice(-MAX_VISIBLE_THINKING_LINES);
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 4));

  return (
    <DashCard cols={cols} title="Processing" rightBadge="active" borderColor={theme.BORDER_ACTIVE}>
      {hiddenCount > 0 && (
        <Text color={theme.DIM}>{`... ${hiddenCount} more above`}</Text>
      )}
      {visibleLines.map((line, index) => {
        const rows = wrapPlainText(line, contentWidth);
        return rows.map((row, rowIdx) => (
          <Text key={`${index}-${rowIdx}`} color={theme.MUTED}>{row || " "}</Text>
        ));
      })}
      {toolLine && (
        <Text color={theme.INFO}>{"• "}{toolLine}</Text>
      )}
    </DashCard>
  );
}
