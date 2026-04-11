import React from "react";
import { Box, Text } from "ink";
import type { UIState } from "../session/types.js";
import { useTheme } from "./theme.js";
import { AnimatedStatusText } from "./AnimatedStatusText.js";

export function measureRunFooterRows(): number {
  return 3;
}

export function getRunFooterStatus(uiState: UIState): string {
  if (uiState.kind === "THINKING") return "Analysing request";
  if (uiState.kind === "RESPONDING") return "Streaming response";
  if (uiState.kind === "SHELL_RUNNING") return "Executing shell command";
  return "Working";
}

interface RunFooterProps {
  uiState: UIState;
  onCancel: () => void;
  onQuit: () => void;
}

export function RunFooter({ uiState }: RunFooterProps) {
  const theme = useTheme();
  // THINKING/RESPONDING/SHELL_RUNNING indicate active processing
  const isActive = uiState.kind === "THINKING" || uiState.kind === "RESPONDING" || uiState.kind === "SHELL_RUNNING";

  return (
    <Box flexDirection="column" paddingBottom={1} width="100%">
      <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={theme.BORDER_SUBTLE} marginBottom={1} />
      <Box paddingX={1} width="100%" justifyContent="space-between" overflow="hidden">
        <Box flexShrink={1} flexGrow={1} overflow="hidden">
          <Text color={theme.INFO}>{"✧ "}</Text>
          <AnimatedStatusText baseText={getRunFooterStatus(uiState)} isActive={isActive} />
        </Box>
        <Box flexShrink={0}>
          <Text color={theme.DIM}>Esc cancel  Ctrl+C quit</Text>
        </Box>
      </Box>
    </Box>
  );
}
