import React from "react";
import { Text } from "ink";
import { useTheme } from "./theme.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { getBusyStatusFrame } from "./busyStatusAnimation.js";

interface AnimatedStatusTextProps {
  baseText: string;
  isActive: boolean;
  isError?: boolean;
  animationFrame?: string;
}

export function AnimatedStatusText({ baseText, isActive, isError = false, animationFrame }: AnimatedStatusTextProps) {
  const theme = useTheme();
  const renderedText = sanitizeTerminalOutput(baseText);
  const suffix = isActive ? animationFrame ?? getBusyStatusFrame(0) : "";

  return (
    <Text color={isError ? theme.ERROR : theme.INFO} wrap="truncate">
      {renderedText}{suffix}
    </Text>
  );
}
