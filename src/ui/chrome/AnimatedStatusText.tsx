import { Text } from "ink";
import { useEffect, useState } from "react";
import * as renderDebug from "../../core/perf/renderDebug.js";
import { sanitizeTerminalOutput } from "../../core/terminal/terminalSanitize.js";
import { useTheme } from "../theme.js";
import {
  BUSY_STATUS_FRAME_MS,
  BUSY_STATUS_FRAMES,
  getBusyStatusFrame,
} from "./busyStatusAnimation.js";

interface AnimatedStatusTextProps {
  baseText: string;
  isActive: boolean;
  isError?: boolean;
  animationFrame?: string;
  animationStyle?: "dots" | "flow";
}

function useLocalBusyStatusFrame(isActive: boolean, label: string, flow: boolean): number {
  const [frameIndex, setFrameIndex] = useState(0);
  const staticStatus = process.env.UBUME_DEBUG_STATIC_STATUS === "1";

  useEffect(() => {
    if (!isActive || staticStatus) {
      setFrameIndex(0);
      return;
    }

    setFrameIndex(0);
    const timer = setInterval(
      () => {
        setFrameIndex((current) => {
          const next = current + 1;
          renderDebug.traceStatusTick({ owner: "Status", label, frameIndex: next });
          return next;
        });
      },
      flow ? 120 : BUSY_STATUS_FRAME_MS,
    );
    timer.unref?.();

    return () => {
      clearInterval(timer);
    };
  }, [isActive, label, staticStatus, flow]);

  if (isActive && staticStatus) {
    return BUSY_STATUS_FRAMES.length - 1;
  }
  return frameIndex;
}

export function AnimatedStatusText({
  baseText,
  isActive,
  isError = false,
  animationFrame,
  animationStyle = "dots",
}: AnimatedStatusTextProps) {
  const flow = animationStyle === "flow";
  const animate = isActive && (!flow || !process.env.NO_COLOR);
  const frameIndex = useLocalBusyStatusFrame(
    animate && animationFrame === undefined,
    baseText,
    flow,
  );
  const localFrame = getBusyStatusFrame(frameIndex);
  renderDebug.useRenderDebug("Status", {
    baseText,
    isActive,
    isError,
    animationFrame: animationFrame ?? localFrame,
  });
  renderDebug.useLifecycleDebug("Status", {
    baseText,
    isActive,
    isError,
  });

  const theme = useTheme();
  const renderedText = sanitizeTerminalOutput(baseText);
  const suffix = animate && !flow ? (animationFrame ?? localFrame) : "";
  const characters = Array.from(renderedText);
  const highlight = frameIndex % (characters.length + 3);

  return (
    <Text color={isError ? theme.error : theme.info} wrap="truncate">
      {flow && animate
        ? characters.map((character, index) => (
            <Text
              key={index}
              color={index >= highlight - 2 && index <= highlight ? theme.accent : theme.info}
              bold={index >= highlight - 2 && index <= highlight}
            >
              {character}
            </Text>
          ))
        : renderedText}
      {suffix}
    </Text>
  );
}
