import React from "react";
import { Box, Text } from "ink";
import type { UIState } from "../session/types.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import { useTheme } from "./theme.js";
import { AnimatedStatusText } from "./AnimatedStatusText.js";
import { isAnimatedBusyState } from "./busyStatusAnimation.js";

export function measureRunFooterRows(): number {
  return 3;
}

export function getRunFooterStatus(uiState: UIState): string {
  if (uiState.kind === "IDLE") return "";
  if (uiState.kind === "THINKING") return "Codex is thinking";
  if (uiState.kind === "RESPONDING") return "Codex is streaming";
  if (uiState.kind === "SHELL_RUNNING") return "Codex is running command";
  if (uiState.kind === "ERROR") return uiState.message;
  if (uiState.kind === "AWAITING_USER_ACTION") return "Codex needs your answer";
  return "Codex is working";
}

interface RunFooterProps {
  uiState: UIState;
  onCancel: () => void;
  onQuit: () => void;
}

export function RunFooter({ uiState }: RunFooterProps) {
  renderDebug.useRenderDebug("Footer", {
    uiStateKind: uiState.kind,
  });

  const theme = useTheme();
  // THINKING/RESPONDING/SHELL_RUNNING indicate active processing
  const isActive = isAnimatedBusyState(uiState.kind);

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
