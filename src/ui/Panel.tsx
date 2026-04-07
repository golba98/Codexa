import React from "react";
import { Box, Text } from "ink";
import { fitLeftRightRow, getDisplayWidth } from "./displayText.js";
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
  const safeCols = Math.max(4, cols);
  const prefix = "╭─";
  const suffix = "╮";
  const innerWidth = Math.max(0, safeCols - getDisplayWidth(prefix) - getDisplayWidth(suffix));
  const fitted = fitLeftRightRow({
    left: ` ${title} `,
    right: rightTitle ? ` ${rightTitle} ` : "",
    width: innerWidth,
    gap: 0,
  });
  const fillCount = Math.max(0, innerWidth - getDisplayWidth(fitted.left) - getDisplayWidth(fitted.right));

  return (
    <Box flexDirection="column" width={safeCols} overflow="hidden">
      <Text color={cBorder}>
        {prefix}
        <Text color={cTitle}>{fitted.left}</Text>
        {"─".repeat(fillCount)}
        {fitted.right && <Text color={theme.DIM}>{fitted.right}</Text>}
        {suffix}
      </Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderTop={false}
        borderColor={cBorder}
        width={safeCols}
        paddingX={1}
        paddingY={0}
      >
        {children}
      </Box>
    </Box>
  );
}
