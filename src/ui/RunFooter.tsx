import React from "react";
import { Box, Text, useInput } from "ink";
import type { UIState } from "../session/types.js";
import { useTheme } from "./theme.js";

export function getRunFooterStatus(uiState: UIState): string {
  if (uiState.kind === "THINKING") return "Analysing request...";
  if (uiState.kind === "RESPONDING") return "Streaming response...";
  if (uiState.kind === "SHELL_RUNNING") return "Executing shell command...";
  return "Working...";
}

interface RunFooterProps {
  uiState: UIState;
  onCancel: () => void;
  onQuit: () => void;
}

export function RunFooter({ uiState, onCancel, onQuit }: RunFooterProps) {
  const theme = useTheme();

  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "q")) {
      onQuit();
      return;
    }
    if (key.escape) {
      onCancel();
    }
  }, { isActive: true });

  return (
    <Box flexDirection="column" paddingBottom={1} width="100%">
      <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={theme.BORDER_SUBTLE} marginBottom={1} />
      <Box paddingX={1} width="100%" justifyContent="space-between" overflow="hidden">
        <Text color={theme.INFO}>{"✧ "}{getRunFooterStatus(uiState)}</Text>
        <Text color={theme.DIM}>Esc cancel  Ctrl+C quit</Text>
      </Box>
    </Box>
  );
}
