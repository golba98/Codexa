/**
 * ScrollIndicator - Subtle, premium scrollbar for transcript viewport
 * 
 * Displays scroll position and hints at scrollable content.
 * Only visible when content exceeds viewport height.
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme.js";

interface ScrollIndicatorProps {
  /** Current scroll offset from bottom (0 = at bottom) */
  scrollOffset: number;
  /** Maximum possible scroll value */
  maxScroll: number;
  /** Visible viewport height in rows */
  viewportHeight: number;
  /** Total content height in rows */
  totalHeight: number;
  /** Whether scrollable content exists */
  visible: boolean;
}

export function ScrollIndicator({
  scrollOffset,
  maxScroll,
  viewportHeight,
  totalHeight,
  visible,
}: ScrollIndicatorProps) {
  const theme = useTheme();

  if (!visible || maxScroll <= 0) {
    return null;
  }

  // Calculate scroll percentage (0 = bottom, 100 = top)
  const scrollPercentage = maxScroll > 0 
    ? Math.round((scrollOffset / maxScroll) * 100)
    : 0;

  // Simple text indicator showing scroll status
  const isAtBottom = scrollOffset === 0;
  const isAtTop = scrollOffset === maxScroll;
  
  const indicator = isAtBottom 
    ? "⬇ bottom" 
    : isAtTop 
      ? "⬆ top" 
      : `⬆ ${scrollPercentage}%`;

  // Render as a small badge at the bottom
  // Since Ink doesn't support absolute positioning with right/bottom,
  // we'll render this inline and rely on Timeline to position it
  return (
    <Box paddingX={1} justifyContent="flex-end">
      <Text color={theme.DIM} dimColor>
        {indicator}
      </Text>
    </Box>
  );
}
