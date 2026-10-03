export type CancelScheduledPromptRunStart = () => void;

export function schedulePromptRunStartAfterVisibleCommit(
  start: () => void,
): CancelScheduledPromptRunStart {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  queueMicrotask(() => {
    if (cancelled) return;
    timer = setTimeout(() => {
      timer = null;
      if (!cancelled) {
        start();
      }
    }, 0);
  });

  return () => {
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
