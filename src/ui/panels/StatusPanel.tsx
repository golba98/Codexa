/**
 * StatusPanel — displays current intent/status message.
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import { ThinkingIndicator } from "../ThinkingIndicator.js";

interface StatusPanelProps {
  message: string;
  taskLabel?: string;
  showSpinner?: boolean;
  simple?: boolean;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function StatusPanel({ message, taskLabel, showSpinner = false, simple = false }: StatusPanelProps) {
  const theme = useTheme();
  const [frameIndex, setFrameIndex] = React.useState(0);

  React.useEffect(() => {
    if (!showSpinner) return;
    const timer = setInterval(() => {
      setFrameIndex((i) => (i + 1) % SPINNER_FRAMES.length);
    }, 90);
    return () => clearInterval(timer);
  }, [showSpinner]);

  if (!message) return null;

  // Use simple "Thinking..." indicator for simple tasks
  if (simple && showSpinner) {
    return <ThinkingIndicator />;
  }

  return (
    <Box width="100%" paddingLeft={2} paddingRight={1}>
      <Box>
        {showSpinner && (
          <Text color={theme.INFO}>{SPINNER_FRAMES[frameIndex]} </Text>
        )}
        {!showSpinner && <Text color={theme.ACCENT}>✧ </Text>}
        {taskLabel && (
          <Text color={theme.MUTED}>{taskLabel}: </Text>
        )}
        <Text color={theme.TEXT}>{message}</Text>
      </Box>
    </Box>
  );
}
