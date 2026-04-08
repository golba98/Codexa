import { useEffect, useRef, useState } from "react";

export function useThrottledValue<T>(value: T, delayMs: number): T {
  const [throttledValue, setThrottledValue] = useState(value);
  const lastUpdateRef = useRef(0);
  const pendingRef = useRef<T | null>(null);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;

    if (elapsed >= delayMs) {
      lastUpdateRef.current = now;
      pendingRef.current = null;
      setThrottledValue(value);
      return;
    }

    pendingRef.current = value;
    const timeout = setTimeout(() => {
      if (pendingRef.current === null) return;
      lastUpdateRef.current = Date.now();
      setThrottledValue(pendingRef.current);
      pendingRef.current = null;
    }, delayMs - elapsed);

    return () => clearTimeout(timeout);
  }, [delayMs, value]);

  return throttledValue;
}
