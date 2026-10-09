interface FakeTimer {
  id: number;
  at: number;
  ms: number;
  fn: () => void;
}

/** Lets pending promise chains (and Ink renders they trigger) run to completion. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Deterministic setTimer/clearTimer/now trio for code that takes injected timers
 * (e.g. the update-check scheduler). `advance` fires due timers in order and
 * settles after each so async work they start can finish.
 */
export function createFakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, FakeTimer>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = ++seq;
      timers.set(id, { id, at: now + ms, ms, fn });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    pending: () => [...timers.values()],
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const next = [...timers.values()]
          .filter((t) => t.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers.delete(next.id);
        now = next.at;
        next.fn();
        await settle();
      }
      now = target;
    },
  };
}
