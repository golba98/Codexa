import React from "react";
import type { ReactNode } from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme.js";
import { getVisualWidth } from "./layout.js";

interface DashCardProps {
  cols: number;
  title: string;
  rightBadge?: string;
  borderColor?: string;
  titleColor?: string;
  badgeColor?: string;
  children: ReactNode;
}

export function DashCard({
  cols,
  title,
  rightBadge,
  borderColor,
  titleColor,
  badgeColor,
  children,
}: DashCardProps) {
  const theme = useTheme();
  const border = borderColor ?? theme.BORDER_SUBTLE;
  const tColor = titleColor ?? theme.MUTED;
  const bColor = badgeColor ?? theme.DIM;

  // Account for AppShell gutter (-1) and Timeline paddingX={1} (-2)
  const w = cols - 3;

  const topLine = buildTopBorder(w, title, rightBadge);
  const bottomFill = "─".repeat(Math.max(1, w - 2));

  return (
    <Box flexDirection="column" width="100%">
      <Text wrap="truncate">
        <Text color={border}>{"╭── "}</Text>
        <Text color={tColor} bold>{topLine.title}</Text>
        <Text color={border}>{" " + topLine.fill + " "}</Text>
        {topLine.badge ? (
          <>
            <Text color={bColor}>{topLine.badge}</Text>
            <Text color={border}>{" ──╮"}</Text>
          </>
        ) : (
          <Text color={border}>{"──╮"}</Text>
        )}
      </Text>
      <Box flexDirection="row" width="100%">
        <Text color={border}>{"│ "}</Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {children}
        </Box>
        <Text color={border}>{" │"}</Text>
      </Box>
      <Text wrap="truncate" color={border}>{"╰" + bottomFill + "╯"}</Text>
    </Box>
  );
}

function buildTopBorder(
  w: number,
  title: string,
  badge?: string,
): { title: string; fill: string; badge: string | null } {
  // Layout: "╭── " + title + " " + fill + " " + badge + " ──╮"
  // Or:     "╭── " + title + " " + fill + "──╮"
  const prefix = 4; // "╭── "
  const suffix = badge ? 4 : 3; // " ──╮" with badge spacing, or "──╮"
  const titleWidth = getVisualWidth(title);
  const badgeWidth = badge ? getVisualWidth(badge) : 0;
  const spacing = 2; // spaces around fill (one each side)

  const available = w - prefix - titleWidth - spacing - badgeWidth - suffix;
  const fillCount = Math.max(1, available);
  const fill = "─".repeat(fillCount);

  return { title, fill, badge: badge ?? null };
}
