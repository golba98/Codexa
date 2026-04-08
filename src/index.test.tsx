import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { EventEmitter } from "node:events";
import { startApp } from "./index.js";

class MockStdout extends EventEmitter {
  isTTY = true;
  columns = 120;
  rows = 40;
  writes = "";
  clearCalls = 0;

  write(chunk: string): boolean {
    this.writes += chunk;
    return true;
  }
}

class MockStderr {
  writes = "";

  write(chunk: string): boolean {
    this.writes += chunk;
    return true;
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createSupportedHarness() {
  const stdout = new MockStdout();
  const stderr = new MockStderr();
  const registeredHandlers: Array<() => void> = [];
  let renderCalls = 0;
  let resolveExit = () => {};
  const waitUntilExitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  return {
    stdout,
    stderr,
    registeredHandlers,
    getRenderCalls: () => renderCalls,
    resolveExit,
    deps: {
      stdin: { isTTY: true },
      stdout,
      stderr,
      env: {},
      platform: "linux" as const,
      renderApp(_node: React.ReactElement) {
        renderCalls += 1;
        return {
          clear() {
            stdout.clearCalls += 1;
          },
          waitUntilExit() {
            return waitUntilExitPromise;
          },
        };
      },
      registerExitHandler(handler: () => void) {
        registeredHandlers.push(handler);
      },
    },
  };
}

test("refuses unsupported terminals without writing bracketed paste sequences", () => {
  let stdoutWrites = "";
  let stderrWrites = "";
  let renderCalled = false;
  let exitHandlerRegistered = false;

  const result = startApp({
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      columns: 120,
      rows: 40,
      on() {
        return this;
      },
      off() {
        return this;
      },
      write(chunk: string) {
        stdoutWrites += chunk;
        return true;
      },
    },
    stderr: {
      write(chunk: string) {
        stderrWrites += chunk;
        return true;
      },
    },
    env: {},
    platform: "win32",
    renderApp(_node: React.ReactElement) {
      renderCalled = true;
      return {
        clear() {},
        waitUntilExit() {
          return Promise.resolve();
        },
      };
    },
    registerExitHandler() {
      exitHandlerRegistered = true;
    },
  });

  assert.deepEqual(result, { started: false, exitCode: 1 });
  assert.equal(renderCalled, false);
  assert.equal(exitHandlerRegistered, false);
  assert.equal(stdoutWrites, "");
  assert.doesNotMatch(stderrWrites, /\?2004[hl]/);
  assert.match(stderrWrites, /VT control sequences/i);
});

test("enforces a single render root while active", async () => {
  const harness = createSupportedHarness();

  const first = startApp(harness.deps);
  const second = startApp(harness.deps);

  assert.deepEqual(first, { started: true, exitCode: 0 });
  assert.deepEqual(second, { started: true, exitCode: 0 });
  assert.equal(harness.getRenderCalls(), 1);

  harness.resolveExit();
  await flushMicrotasks();
});

test("hard-repaints once when resize recovers from invalid dimensions", async () => {
  const harness = createSupportedHarness();

  startApp(harness.deps);
  assert.equal(harness.stdout.clearCalls, 0);

  harness.stdout.columns = 1;
  harness.stdout.rows = 1;
  harness.stdout.emit("resize");

  harness.stdout.columns = 120;
  harness.stdout.rows = 40;
  harness.stdout.emit("resize");

  assert.equal(harness.stdout.clearCalls, 1);
  assert.match(harness.stdout.writes, /\x1b\[\?2004h/);
  assert.match(harness.stdout.writes, /\x1b\[2J\x1b\[3J\x1b\[H/);

  harness.resolveExit();
  await flushMicrotasks();
});

test("hard-repaints when resize occurs without invalid dimensions", async () => {
  const harness = createSupportedHarness();
  startApp(harness.deps);

  const writesBefore = harness.stdout.writes;

  // Emit a resize at valid dimensions (no invalid transition)
  harness.stdout.columns = 80;
  harness.stdout.emit("resize");

  // The clear sequence must be written immediately (before debounce fires)
  assert.match(harness.stdout.writes.slice(writesBefore.length), /\x1b\[2J\x1b\[3J\x1b\[H/);

  // After debounce fires, Ink.clear() is also called
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(harness.stdout.clearCalls >= 1);

  harness.resolveExit();
  await flushMicrotasks();
});

test("removes resize listener and restores bracketed paste on cleanup", async () => {
  const harness = createSupportedHarness();

  startApp(harness.deps);
  assert.equal(harness.stdout.listenerCount("resize"), 1);
  assert.equal(harness.registeredHandlers.length, 1);

  harness.registeredHandlers[0]!();
  assert.equal(harness.stdout.listenerCount("resize"), 0);
  assert.match(harness.stdout.writes, /\x1b\[\?2004h/);
  assert.match(harness.stdout.writes, /\x1b\[\?2004l/);

  // Resolving after explicit cleanup should be idempotent.
  harness.resolveExit();
  await flushMicrotasks();
});

test("scheduled repaint clears screen and calls renderHandle.clear when inkInstance is null", async () => {
  const harness = createSupportedHarness();
  startApp(harness.deps);

  // Reset counters after initial render
  harness.stdout.clearCalls = 0;
  harness.stdout.writes = "";

  // Emit a normal resize — triggers performHardRepaint + scheduleRepaint
  harness.stdout.columns = 80;
  harness.stdout.emit("resize");

  // Wait for the 150ms debounce to fire
  await new Promise((resolve) => setTimeout(resolve, 200));

  // In test mocks, inkInstance is null so scheduleRepaint uses the fallback
  // path that calls renderHandle.clear().  The immediate performHardRepaint
  // also calls clear(), so we expect at least 2.
  assert.ok(harness.stdout.clearCalls >= 2, `expected >=2 clear calls, got ${harness.stdout.clearCalls}`);

  // The scheduled repaint should also write a hard-clear sequence
  const repaintMatches = harness.stdout.writes.match(/\x1b\[2J\x1b\[3J\x1b\[H/g);
  assert.ok(repaintMatches && repaintMatches.length >= 1, "expected at least one hard repaint sequence");

  harness.resolveExit();
  await flushMicrotasks();
});
