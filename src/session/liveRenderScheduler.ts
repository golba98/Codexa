import type { BackendProgressUpdate } from "../core/providers/types.js";
import type { RunFileActivity } from "../core/workspaceActivity.js";
import type { RunToolActivity } from "./types.js";
import * as renderDebug from "../core/perf/renderDebug.js";

export type LiveRenderUpdate =
  | { type: "assistant"; chunk: string }
  | { type: "plan"; chunk: string }
  | { type: "progress"; update: BackendProgressUpdate }
  | { type: "activity"; activity: RunFileActivity[] }
  | { type: "tool"; activity: RunToolActivity };

type TimerHandle = ReturnType<typeof setTimeout>;

export interface LiveRenderSchedulerOptions {
  flush: (updates: LiveRenderUpdate[]) => void;
  assistantFlushMs: number;
  progressOnlyFlushMs: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
}

export interface LiveRenderScheduler {
  enqueue: (update: LiveRenderUpdate) => void;
  flushNow: () => boolean;
  cancel: () => void;
  hasPendingUpdates: () => boolean;
  getStats: () => LiveRenderSchedulerStats;
}

export interface LiveRenderSchedulerStats {
  providerEvents: number;
  flushes: number;
  averageFlushIntervalMs: number;
  maxFlushIntervalMs: number;
}

function findPendingUpdateIndex(
  updates: LiveRenderUpdate[],
  predicate: (update: LiveRenderUpdate) => boolean,
): number {
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    if (predicate(updates[index]!)) return index;
  }
  return -1;
}

function mergeLiveRenderUpdate(updates: LiveRenderUpdate[], update: LiveRenderUpdate): boolean {
  const previous = updates[updates.length - 1];

  if (update.type === "assistant" || update.type === "plan") {
    if (previous?.type === update.type) {
      previous.chunk += update.chunk;
    } else {
      updates.push({ ...update });
    }
    return true;
  }

  if (update.type === "progress") {
    const index = findPendingUpdateIndex(
      updates,
      (pending) => pending.type === "progress" && pending.update.id === update.update.id,
    );
    if (index >= 0 && updates[index]?.type === "progress") {
      updates[index] = update;
    } else {
      updates.push(update);
    }
    return false;
  }

  if (update.type === "tool") {
    const index = findPendingUpdateIndex(
      updates,
      (pending) => pending.type === "tool" && pending.activity.id === update.activity.id,
    );
    if (index >= 0 && updates[index]?.type === "tool") {
      const previousTool = updates[index];
      updates[index] = {
        type: "tool",
        activity: { ...previousTool.activity, ...update.activity },
      };
    } else {
      updates.push(update);
    }
    return false;
  }

  const activityIndex = findPendingUpdateIndex(updates, (pending) => pending.type === "activity");
  if (activityIndex >= 0 && updates[activityIndex]?.type === "activity") {
    updates[activityIndex].activity.push(...update.activity);
  } else {
    updates.push({ type: "activity", activity: [...update.activity] });
  }
  return false;
}

export function createLiveRenderScheduler({
  flush,
  assistantFlushMs,
  progressOnlyFlushMs,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: LiveRenderSchedulerOptions): LiveRenderScheduler {
  let pendingUpdates: LiveRenderUpdate[] = [];
  let hasPendingAssistantDelta = false;
  let timer: TimerHandle | null = null;
  let isFlushing = false;
  let flushAgain = false;
  let providerEvents = 0;
  let flushes = 0;
  let totalFlushIntervalMs = 0;
  let maxFlushIntervalMs = 0;
  let lastFlushMonotonicMs: number | null = null;

  const cancelScheduledFlush = () => {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  };

  const drain = (): boolean => {
    if (isFlushing) {
      flushAgain = true;
      return false;
    }

    cancelScheduledFlush();

    if (pendingUpdates.length === 0) {
      hasPendingAssistantDelta = false;
      return false;
    }

    isFlushing = true;
    let flushed = false;
    try {
      do {
        flushAgain = false;
        const updates = pendingUpdates;
        pendingUpdates = [];
        hasPendingAssistantDelta = false;
        if (updates.length > 0) {
          flushed = true;
          const startedAt = performance.now();
          flush(updates);
          flushes += 1;
          if (lastFlushMonotonicMs !== null) {
            const intervalMs = Math.max(0, Math.round(startedAt - lastFlushMonotonicMs));
            totalFlushIntervalMs += intervalMs;
            maxFlushIntervalMs = Math.max(maxFlushIntervalMs, intervalMs);
          }
          lastFlushMonotonicMs = startedAt;
          renderDebug.traceSchedulerFlush({
            reason: updates.some((update) => update.type === "assistant" || update.type === "plan") ? "stream" : "progress",
            updates: updates.length,
            assistantChunks: updates.filter((update) => update.type === "assistant").length,
            progressUpdates: updates.filter((update) => update.type === "progress").length,
            toolUpdates: updates.filter((update) => update.type === "tool").length,
            activityUpdates: updates.filter((update) => update.type === "activity").length,
            durationMs: Math.round(performance.now() - startedAt),
          });
        }
      } while (flushAgain || pendingUpdates.length > 0);
    } finally {
      isFlushing = false;
    }

    return flushed;
  };

  const schedule = () => {
    if (timer || isFlushing) return;

    const interval = hasPendingAssistantDelta ? assistantFlushMs : progressOnlyFlushMs;
    timer = setTimer(() => {
      timer = null;
      drain();
    }, interval);
  };

  return {
    enqueue(update) {
      providerEvents += 1;
      const addedAssistant = mergeLiveRenderUpdate(pendingUpdates, update);
      hasPendingAssistantDelta ||= addedAssistant;
      schedule();
    },
    flushNow: drain,
    cancel() {
      cancelScheduledFlush();
      pendingUpdates = [];
      hasPendingAssistantDelta = false;
    },
    hasPendingUpdates() {
      return pendingUpdates.length > 0;
    },
    getStats() {
      const intervalCount = Math.max(0, flushes - 1);
      return {
        providerEvents,
        flushes,
        averageFlushIntervalMs: intervalCount > 0 ? Math.round(totalFlushIntervalMs / intervalCount) : 0,
        maxFlushIntervalMs,
      };
    },
  };
}
