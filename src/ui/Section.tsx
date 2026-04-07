/**
 * Section — lightweight rail-based section component.
 * 
 * Matches CODEXA's premium identity:
 * ─ TITLE ───────────────────────────────────────────────────────── badge ─
 *   content
 * 
 * Or boxed variant for user input:
 * ╭─ TITLE ───────────────────────────────────────────────────────── badge ─╮
 * │ content                                                                 │
 * ╰─────────────────────────────────────────────────────────────────────────╯
 */

import React from "react";
import { Box, Text } from "ink";
import { fitLeftRightRow, getDisplayWidth } from "./displayText.js";
import { useTheme } from "./theme.js";

interface SectionProps {
  cols: number;
  title: string;
  rightBadge?: string;
  /** Whether section is active/in-progress (affects styling) */
  active?: boolean;
  /** Visual style: "rail" (lines only) or "boxed" (rounded corners) */
  variant?: "rail" | "boxed";
  /** Optional override for the rail color */
  borderColor?: string;
  /** Optional override for the title color */
  titleColor?: string;
  /** Optional override for the badge color */
  badgeColor?: string;
  /** Legacy marker prop, ignored but kept for compatibility */
  marker?: string;
  /** Legacy color prop, ignored but kept for compatibility */
  markerColor?: string;
  children: React.ReactNode;
}

export function Section({
  cols,
  title,
  rightBadge,
  active = false,
  variant = "rail",
  borderColor,
  titleColor: titleColorProp,
  badgeColor: badgeColorProp,
  children,
}: SectionProps) {
  const theme = useTheme();
  const safeCols = Math.max(10, cols);
  
  // Colors based on active state
  const titleColor = titleColorProp || (active ? theme.TEXT : theme.MUTED);
  const badgeColor = badgeColorProp || theme.DIM;
  const railColor = borderColor || (active ? theme.BORDER_ACTIVE : theme.BORDER_SUBTLE);

  const prefix = variant === "boxed" ? "╭─ " : "─ ";
  const suffix = variant === "boxed" ? " ─╮" : " ─";
  const prefixWidth = getDisplayWidth(prefix);
  const suffixWidth = getDisplayWidth(suffix);
  
  const availableWidth = safeCols - prefixWidth - suffixWidth;
  
  // Fit title and badge in available space
  const fitted = fitLeftRightRow({
    left: title,
    right: rightBadge || "",
    width: availableWidth,
    gap: 2,
    leftStrategy: "end",
    rightStrategy: "end",
  });

  // Calculate rail fill
  const titleWidth = getDisplayWidth(fitted.left);
  const badgeWidth = getDisplayWidth(fitted.right);
  const fillCount = Math.max(0, availableWidth - titleWidth - badgeWidth - (fitted.right ? 1 : 0));

  return (
    <Box flexDirection="column" width={safeCols}>
      {/* Header rail */}
      <Box width={safeCols} overflow="hidden">
        <Text color={railColor}>{prefix}</Text>
        <Text color={titleColor} bold>{fitted.left}</Text>
        <Text color={railColor}>{"─".repeat(fillCount)}</Text>
        {fitted.right && (
          <Text color={badgeColor}>{fitted.right + " "}</Text>
        )}
        <Text color={railColor}>{suffix}</Text>
      </Box>
      
      {/* Content with optional borders */}
      <Box flexDirection="row" width={safeCols}>
        {variant === "boxed" && <Text color={railColor}>{"│ "}</Text>}
        <Box 
          flexDirection="column" 
          flexGrow={1} 
          paddingLeft={variant === "boxed" ? 0 : 2}
          width={safeCols - (variant === "boxed" ? 4 : 2)}
        >
          {children}
        </Box>
        {variant === "boxed" && <Text color={railColor}>{" │"}</Text>}
      </Box>

      {/* Bottom Border for boxed variant only */}
      {variant === "boxed" && (
        <Box width={safeCols} overflow="hidden">
          <Text color={railColor}>{"╰" + "─".repeat(Math.max(0, safeCols - 2)) + "╯"}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * SectionDivider — simple horizontal rule for visual separation.
 */
export function SectionDivider({ cols }: { cols: number }) {
  const theme = useTheme();
  const width = Math.max(4, cols);
  return (
    <Box width={width}>
      <Text color={theme.BORDER_SUBTLE}>{"─".repeat(width)}</Text>
    </Box>
  );
}
