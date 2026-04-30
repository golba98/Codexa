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
    if (previous?.type === "progress" && previous.update.id === update.update.id) {
      previous.update = update.update;
    } else {
      updates.push(update);
    }
    return false;
  }

  if (update.type === "tool") {
    if (previous?.type === "tool" && previous.activity.id === update.activity.id) {
      previous.activity = { ...previous.activity, ...update.activity };
    } else {
      updates.push(update);
    }
    return false;
  }

  if (previous?.type === "activity") {
    previous.activity.push(...update.activity);
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
  };
}
