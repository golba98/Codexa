import React from "react";
import { Text } from "ink";
import { useTheme } from "./theme.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { useThrottledValue } from "./useThrottledValue.js";
import { useAnimatedDots } from "./useAnimatedDots.js";

interface AnimatedStatusTextProps {
  baseText: string;
  isActive: boolean;
  isError?: boolean;
}

export function AnimatedStatusText({ baseText, isActive, isError = false }: AnimatedStatusTextProps) {
  const theme = useTheme();
  const dots = useAnimatedDots(isActive);
  const renderedText = useThrottledValue(sanitizeTerminalOutput(baseText), 80);

  return (
    <Text color={isError ? theme.ERROR : theme.INFO} wrap="truncate">
      {renderedText}{isActive ? dots : ""}
    </Text>
  );
}
