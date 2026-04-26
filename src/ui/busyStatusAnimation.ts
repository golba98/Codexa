export const BUSY_STATUS_FRAME_MS = 350;
export const BUSY_STATUS_FRAMES = [" .  ", " .. ", " ..."] as const;

export function getBusyStatusFrame(frameIndex: number): string {
  const safeIndex = Math.max(0, Math.floor(frameIndex));
  return BUSY_STATUS_FRAMES[safeIndex % BUSY_STATUS_FRAMES.length]!;
}

export function isAnimatedBusyState(kind: string): boolean {
  return kind === "THINKING" || kind === "RESPONDING" || kind === "SHELL_RUNNING";
}
