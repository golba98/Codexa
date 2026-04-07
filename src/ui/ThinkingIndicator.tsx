/**
 * ThinkingIndicator — Simple animated "Thinking..." indicator
 * Used during run processing when we want minimal UI
 */

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme.js";

const DOTS = ["", ".", "..", "..."];

interface ThinkingIndicatorProps {
  label?: string;
}

export function ThinkingIndicator({ label = "Thinking" }: ThinkingIndicatorProps) {
  const theme = useTheme();
  const [dotsIndex, setDotsIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setDotsIndex((current) => (current + 1) % DOTS.length);
    }, 400);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box width="100%" paddingLeft={2}>
      <Text color={theme.INFO}>{label}</Text>
      <Text color={theme.DIM}>{DOTS[dotsIndex]}</Text>
    </Box>
  );
}
