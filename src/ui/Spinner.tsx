import React, { startTransition, useEffect, useState } from "react";
import { Text } from "ink";
import { useTheme } from "./theme.js";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ color }: { color?: string }) {
  const theme = useTheme();
  const [frame, setFrame] = useState(0);
  const activeColor = color ?? theme.DIM;

  useEffect(() => {
    const timer = setInterval(() => {
      // startTransition marks this as low-priority so React can coalesce or
      // defer it when a higher-priority streaming render is already pending.
      startTransition(() => {
        setFrame((f) => (f + 1) % frames.length);
      });
    }, 80);

    return () => clearInterval(timer);
  }, []);

  return <Text color={activeColor}>{frames[frame]}</Text>;
}
