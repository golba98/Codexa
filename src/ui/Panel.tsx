import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme.js";

interface PanelProps {
  cols: number;
  title: string;
  rightTitle?: string;
  borderColor?: string;
  titleColor?: string;
  children: React.ReactNode;
}

export function Panel({ cols, title, rightTitle, borderColor, titleColor, children }: PanelProps) {
  const theme = useTheme();
  const cBorder = borderColor || theme.BORDER_ACTIVE;
  const cTitle = titleColor || theme.TEXT;

  const leftLabel = ` ${title} `;
  const rightLabel = rightTitle ? ` ${rightTitle} ` : "";

  // ╭─ TITLE ─── RIGHTTITLE ╮
  // Calculate remaining dashes
  // total length = 2 (╭─) + leftLabel + dashes + rightLabel + 1 (╮) = cols
  // dashes = cols - 3 - leftLabel.length - rightLabel.length
  const maxDashes = cols - 3 - leftLabel.length - rightLabel.length;
  const dashCount = Math.max(0, maxDashes);

  return (
    <Box flexDirection="column" width={cols} overflow="hidden">
      <Text color={cBorder}>
        {"╭─"}
        <Text color={cTitle}>{leftLabel}</Text>
        {"─".repeat(dashCount)}
        {rightTitle && <Text color={theme.DIM}>{rightLabel}</Text>}
        {"╮"}
      </Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderTop={false}
        borderColor={cBorder}
        width={cols}
        paddingX={1}
        paddingY={0}
      >
        {children}
      </Box>
    </Box>
  );
}
