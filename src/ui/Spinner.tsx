import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { useTheme } from "./theme.js";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ color }: { color?: string }) {
  const theme = useTheme();
  const [frame, setFrame] = useState(0);
  const activeColor = color ?? theme.DIM;

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 80);

    return () => clearInterval(timer);
  }, []);

  return <Text color={activeColor}>{frames[frame]}</Text>;
}
