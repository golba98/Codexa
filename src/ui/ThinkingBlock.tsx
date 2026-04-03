import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { RunEvent } from "../session/types.js";
import { getUsableShellWidth } from "./layout.js";
import { wrapPlainText } from "./textLayout.js";
import { useTheme } from "./theme.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

interface ThinkingBlockProps {
  cols: number;
  run: RunEvent;
  turnIndex: number;
}

function formatTime(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ThinkingBlock({ cols, run, turnIndex }: ThinkingBlockProps) {
  const theme = useTheme();
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((current) => (current + 1) % SPINNER_FRAMES.length);
    }, 90);
    return () => clearInterval(timer);
  }, []);

  const latestTool = run.toolActivities[run.toolActivities.length - 1] ?? null;
  const activityLabel = latestTool
    ? latestTool.status === "running"
      ? `Executing: ${latestTool.command}`
      : latestTool.summary ?? latestTool.command
    : run.activitySummary
      ? `${run.touchedFileCount} file${run.touchedFileCount === 1 ? "" : "s"} touched`
      : run.summary;
  const detailWidth = Math.max(1, getUsableShellWidth(cols, 4));
  const detailRows = wrapPlainText(activityLabel || "Analysing request…", detailWidth);

  return (
    <Box flexDirection="column" marginBottom={1} width="100%">
      <Box width="100%" overflow="hidden">
        <Text color={theme.ACCENT}>{"✧ "}</Text>
        <Text color={theme.INFO}>{SPINNER_FRAMES[frameIndex]}{" "}</Text>
        <Text color={theme.TEXT} bold>{"codexa"}</Text>
        <Text color={theme.DIM}>{`  ·  ${run.model}`}</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2} width="100%">
        {detailRows.map((row, index) => (
          <Text key={index} color={theme.MUTED}>{row || " "}</Text>
        ))}
      </Box>
    </Box>
  );
}
