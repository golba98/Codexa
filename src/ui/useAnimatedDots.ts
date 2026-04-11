import { useEffect, useState } from "react";

export function useAnimatedDots(isActive: boolean, intervalMs = 270): string {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setFrameIndex((current) => current + 1);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isActive, intervalMs]);

  if (!isActive) return "";
  return ".".repeat(frameIndex % 4).padEnd(3, " ");
}
