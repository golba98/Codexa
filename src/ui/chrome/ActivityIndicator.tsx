import React, { useState, useEffect } from "react";
import { Text } from "ink";
import type { UIState, ExternalCliStatus } from "../../session/types.js";
import { useTheme } from "../theme.js";

const SPINNER_FRAMES = ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?"];
const STREAMING_FRAMES = ["?", "?", "?", "?"];

export interface ActivityIndicatorProps {
  uiState: UIState;
  externalCliStatus?: ExternalCliStatus;
}

export function ActivityIndicator({ uiState, externalCliStatus = "idle" }: ActivityIndicatorProps) {
  const theme = useTheme();
  const [frameIndex, setFrameIndex] = useState(0);

  const isError = uiState.kind === "ERROR" || externalCliStatus === "failed";
  const isStarting = externalCliStatus === "starting";
  const isThinking = uiState.kind === "THINKING";
  const isStreaming = uiState.kind === "RESPONDING";
  const isAction = uiState.kind === "SHELL_RUNNING";

  const isAnimated = isStarting || isThinking || isStreaming;

  useEffect(() => {
    if (!isAnimated) return;
    const interval = setInterval(() => {
      setFrameIndex((prev) => prev + 1);
    }, 80);
    return () => clearInterval(interval);
  }, [isAnimated]);

  let glyph = "?";
  let color = theme.textDim;
  let bold = false;

  if (isError) {
    glyph = "�";
    color = theme.error;
    bold = true;
  } else if (isAction) {
    glyph = "?";
    color = theme.warning;
    bold = true;
  } else if (isStarting || isThinking) {
    glyph = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]!;
    color = theme.text;
  } else if (isStreaming) {
    glyph = STREAMING_FRAMES[frameIndex % STREAMING_FRAMES.length]!;
    color = theme.success;
  } else {
    glyph = "?";
    color = theme.textDim;
  }

  return <Text color={color} bold={bold}>{glyph}</Text>;
}
