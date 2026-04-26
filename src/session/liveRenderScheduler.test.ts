import assert from "node:assert/strict";
import test from "node:test";
import { createLiveRenderScheduler, type LiveRenderUpdate } from "./liveRenderScheduler.js";

function progress(id: string, text: string): LiveRenderUpdate {
  return { type: "progress", update: { id, source: "reasoning", text } };
}

function tool(id: string, status: "running" | "completed"): LiveRenderUpdate {
  return {
    type: "tool",
    activity: {
      id,
      command: "Get-Content README.md",
      status,
      startedAt: 1,
      completedAt: status === "completed" ? 2 : undefined,
    },
  };
}

test("coalesces adjacent assistant chunks at the scheduled flush", () => {
  const flushed: LiveRenderUpdate[][] = [];
  const microtasks: Array<() => void> = [];
  const scheduler = createLiveRenderScheduler({
    assistantFlushMs: 33,
    progressOnlyFlushMs: 80,
    flush: (updates) => flushed.push(updates),
    queueMicrotaskFn: (callback) => microtasks.push(callback),
  });

  scheduler.enqueue({ type: "assistant", chunk: "Hello" });
  scheduler.enqueue({ type: "assistant", chunk: ", world" });

  assert.equal(flushed.length, 0);
  assert.equal(microtasks.length, 1);
  microtasks[0]!();

  assert.equal(flushed.length, 1);
  assert.deepEqual(flushed[0], [{ type: "assistant", chunk: "Hello, world" }]);
});

test("preserves progress, action, and assistant order while coalescing only adjacent compatible updates", () => {
  const flushed: LiveRenderUpdate[][] = [];
  const scheduler = createLiveRenderScheduler({
    assistantFlushMs: 33,
    progressOnlyFlushMs: 80,
    flush: (updates) => flushed.push(updates),
    queueMicrotaskFn: () => {},
  });

  scheduler.enqueue(progress("p1", "Thinking"));
  scheduler.enqueue(tool("t1", "running"));
  scheduler.enqueue({ type: "assistant", chunk: "First" });
  scheduler.enqueue({ type: "assistant", chunk: " segment" });
  scheduler.enqueue(progress("p1", "Thinking harder"));
  scheduler.flushNow();

  assert.deepEqual(flushed[0]?.map((update) => update.type), ["progress", "tool", "assistant", "progress"]);
  assert.equal((flushed[0]?.[2] as Extract<LiveRenderUpdate, { type: "assistant" }>).chunk, "First segment");
  assert.equal((flushed[0]?.[3] as Extract<LiveRenderUpdate, { type: "progress" }>).update.text, "Thinking harder");
});

test("prevents reentrant flushes when a producer enqueues during a flush", () => {
  const flushed: LiveRenderUpdate[][] = [];
  let inFlush = false;
  let scheduler: ReturnType<typeof createLiveRenderScheduler>;

  scheduler = createLiveRenderScheduler({
    assistantFlushMs: 33,
    progressOnlyFlushMs: 80,
    flush: (updates) => {
      assert.equal(inFlush, false, "flush should not reenter itself");
      inFlush = true;
      flushed.push(updates);
      if (flushed.length === 1) {
        scheduler.enqueue({ type: "assistant", chunk: "queued during flush" });
      }
      inFlush = false;
    },
    queueMicrotaskFn: () => {},
  });

  scheduler.enqueue({ type: "assistant", chunk: "first" });

  assert.equal(scheduler.flushNow(), true);
  assert.equal(flushed.length, 2);
  assert.equal((flushed[0]?.[0] as Extract<LiveRenderUpdate, { type: "assistant" }>).chunk, "first");
  assert.equal((flushed[1]?.[0] as Extract<LiveRenderUpdate, { type: "assistant" }>).chunk, "queued during flush");
});

test("flushNow drains queued updates before finalization", () => {
  const flushed: LiveRenderUpdate[][] = [];
  const microtasks: Array<() => void> = [];
  const scheduler = createLiveRenderScheduler({
    assistantFlushMs: 33,
    progressOnlyFlushMs: 80,
    flush: (updates) => flushed.push(updates),
    queueMicrotaskFn: (callback) => microtasks.push(callback),
  });

  scheduler.enqueue({ type: "assistant", chunk: "final chunk" });

  assert.equal(scheduler.flushNow(), true);
  assert.equal(flushed.length, 1);
  assert.equal(scheduler.hasPendingUpdates(), false);

  microtasks[0]?.();
  assert.equal(flushed.length, 1);
});
