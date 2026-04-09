import React from "react";
import { Text } from "ink";
import type { RunEvent } from "../session/types.js";
import { clampVisualText, getUsableShellWidth } from "./layout.js";
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

  const hiddenCount = Math.max(0, thinkingLines.length - MAX_VISIBLE_THINKING_LINES);
  const visibleLines = thinkingLines.slice(-MAX_VISIBLE_THINKING_LINES);
  const contentWidth = Math.max(1, getUsableShellWidth(cols, 4));

  // Build the fixed-height line slots
  const lineSlots: React.ReactNode[] = [];

  if (!hasContent) {
    lineSlots.push(
      <Text key="waiting" color={theme.DIM}>Waiting for response...</Text>,
    );
  } else if (hiddenCount > 0) {
    lineSlots.push(
      <Text key="hidden" color={theme.DIM}>{`... ${hiddenCount} more above`}</Text>,
    );
  }

  // Render visible thinking lines (truncated, not wrapped)
  if (hasContent) {
    visibleLines.forEach((line, index) => {
      const clamped = clampVisualText(line, contentWidth);
      lineSlots.push(
        <Text key={`line-${index}`} color={theme.MUTED}>{clamped || " "}</Text>,
      );
    });
  }

  // Pad to MAX_VISIBLE_THINKING_LINES slots for stable height
  while (lineSlots.length < MAX_VISIBLE_THINKING_LINES) {
    lineSlots.push(
      <Text key={`pad-${lineSlots.length}`} color={theme.DIM}>{" "}</Text>,
    );
  }

  // Always render tool status row (blank if no tool activity)
  if (toolLine) {
    const clampedTool = clampVisualText(toolLine, Math.max(1, contentWidth - 2));
    lineSlots.push(
      <Text key="tool" color={theme.INFO}>{"• "}{clampedTool}</Text>,
    );
  } else {
    lineSlots.push(
      <Text key="tool-empty" color={theme.DIM}>{" "}</Text>,
    );
  }

  return (
    <DashCard cols={cols} title="Processing" rightBadge="active" borderColor={theme.BORDER_ACTIVE}>
      {lineSlots}
    </DashCard>
  );
}
