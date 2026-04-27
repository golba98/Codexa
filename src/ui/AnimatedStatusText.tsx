import React, { useEffect, useState } from "react";
import { Text } from "ink";
import * as renderDebug from "../core/perf/renderDebug.js";
import { useTheme } from "./theme.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { BUSY_STATUS_FRAME_MS, getBusyStatusFrame } from "./busyStatusAnimation.js";

interface AnimatedStatusTextProps {
  baseText: string;
  isActive: boolean;
  isError?: boolean;
  animationFrame?: string;
}

function useLocalBusyStatusFrame(isActive: boolean, label: string): string {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setFrameIndex(0);
      return;
    }

    setFrameIndex(0);
    const timer = setInterval(() => {
      setFrameIndex((current) => {
        const next = current + 1;
        renderDebug.traceStatusTick({ owner: "Status", label, frameIndex: next });
        return next;
      });
    }, BUSY_STATUS_FRAME_MS);
    timer.unref?.();

    return () => {
      clearInterval(timer);
    };
  }, [isActive, label]);

  return getBusyStatusFrame(frameIndex);
}

export function AnimatedStatusText({ baseText, isActive, isError = false, animationFrame }: AnimatedStatusTextProps) {
  const localFrame = useLocalBusyStatusFrame(isActive, baseText);
  renderDebug.useRenderDebug("Status", {
    baseText,
    isActive,
    isError,
    animationFrame: animationFrame ?? localFrame,
  });

  const theme = useTheme();
  const renderedText = sanitizeTerminalOutput(baseText);
  const suffix = isActive ? animationFrame ?? localFrame : "";

  return (
    <Text color={isError ? theme.ERROR : theme.INFO} wrap="truncate">
      {renderedText}{suffix}
    </Text>
  );
}
