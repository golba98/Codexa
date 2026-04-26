import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { EventEmitter } from "node:events";
import type { RenderOptions } from "ink";
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
  let cleanupCalls = 0;
  let renderOptions: RenderOptions | undefined;
  let resolveExitPromise = () => {};
  const waitUntilExitPromise = new Promise<void>((resolve) => {
    resolveExitPromise = resolve;
  });

  return {
    stdout,
    stderr,
    registeredHandlers,
    getCleanupCalls: () => cleanupCalls,
    getRenderCalls: () => renderCalls,
    getRenderOptions: () => renderOptions,
    resolveExit() {
      resolveExitPromise();
      registeredHandlers[0]?.();
    },
    deps: {
      stdin: { isTTY: true },
      stdout,
      stderr,
      env: {},
      platform: "linux" as const,
      renderApp(_node: React.ReactElement, options?: RenderOptions) {
        renderCalls += 1;
        renderOptions = options;
        stdout.write("\x1b[?1000h\x1b[?1006h");
        return {
          clear() {
            stdout.clearCalls += 1;
          },
          cleanup() {
            cleanupCalls += 1;
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
        cleanup() {},
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
  assert.deepEqual(harness.getRenderOptions()?.kittyKeyboard, {
    mode: "auto",
    flags: ["disambiguateEscapeCodes"],
  });

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

  // onResize does NOT erase scrollback — it defers only a visible-viewport
  // clear (\x1b[2J\x1b[H) to scheduleRepaint (150ms).
  assert.equal(harness.stdout.clearCalls, 0);
  assert.match(harness.stdout.writes, /\x1b\[\?1000h/);
  assert.match(harness.stdout.writes, /\x1b\[\?1006h/);
  assert.match(harness.stdout.writes, /\x1b\[\?2004h/);
  // \x1b[3J must NOT appear in post-startup writes (scrollback preserved).
  const writesAfterStart = harness.stdout.writes.indexOf("\x1b[?2004h") + "\x1b[?2004h".length;
  assert.doesNotMatch(harness.stdout.writes.slice(writesAfterStart), /\x1b\[3J/);

  // After the debounce fires, the full repaint + clear happens.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(harness.stdout.clearCalls >= 1);

  harness.resolveExit();
  await flushMicrotasks();
});

test("resize repaint does not erase terminal scrollback buffer", async () => {
  const harness = createSupportedHarness();
  startApp(harness.deps);

  // Startup legitimately contains \x1b[3J (prevents Windows Terminal stacked-UI artifact).
  assert.match(harness.stdout.writes, /\x1b\[3J/, "startup should erase scrollback once");

  // Capture offset so we can inspect only post-startup writes.
  const startupEnd = harness.stdout.writes.length;

  harness.stdout.columns = 80;
  harness.stdout.emit("resize");

  await new Promise((resolve) => setTimeout(resolve, 200));

  // The debounced repaint must have fired (mock path calls renderHandle.clear()).
  assert.ok(harness.stdout.clearCalls >= 1, "debounced repaint should have called clear()");

  // Post-resize writes must not contain the scrollback-erase sequence.
  // In the mock (no inkInstance) the fallback path calls clear() only, so
  // resizeWrites may be empty — which still satisfies doesNotMatch.
  const resizeWrites = harness.stdout.writes.slice(startupEnd);
  assert.doesNotMatch(resizeWrites, /\x1b\[3J/, "scrollback must not be erased on resize");

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

  // No writes happen immediately — scrollback clear is deferred to the
  // debounced repaint so rapid resize events don't cause visible flashing.
  const immediateWrites = harness.stdout.writes.slice(writesBefore.length);
  assert.equal(immediateWrites, "");

  // After debounce fires, the full hard repaint + Ink.clear() is called.
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

  // Cleanup is deferred via registerExitHandler (index 0)
  harness.registeredHandlers[0]!();
  assert.equal(harness.stdout.listenerCount("resize"), 0);
  assert.equal(harness.getCleanupCalls(), 1);
  // Verify enable sequences were written during startup
  assert.match(harness.stdout.writes, /\x1b\[\?1000h/);
  assert.match(harness.stdout.writes, /\x1b\[\?1006h/);
  assert.match(harness.stdout.writes, /\x1b\[\?2004h/);
  // Verify disable sequences were written during cleanup
  assert.match(harness.stdout.writes, /\x1b\[\?1000l/);
  assert.match(harness.stdout.writes, /\x1b\[\?1006l/);
  assert.match(harness.stdout.writes, /\x1b\[\?2004l/);

  // Resolving after explicit cleanup should be idempotent.
  harness.resolveExit();
  await flushMicrotasks();
});

test("treats sub-viewport dimensions as invalid and defers repaint", async () => {
  const harness = createSupportedHarness();
  startApp(harness.deps);

  // Reset counters after initial render
  harness.stdout.clearCalls = 0;
  harness.stdout.writes = "";

  // Emit resize with medium-invalid dims (pass old <=1 check but fail MIN_VIEWPORT threshold)
  harness.stdout.columns = 15;
  harness.stdout.rows = 8;
  harness.stdout.emit("resize");

  // Should NOT write scrollback clear — dims are invalid, content preserved
  assert.equal(harness.stdout.clearCalls, 0);

  // Debounce fires but dims are still invalid — repaint is skipped
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(harness.stdout.clearCalls, 0);

  // Now recover to valid dims
  harness.stdout.columns = 120;
  harness.stdout.rows = 40;
  harness.stdout.emit("resize");

  // After debounce, the repaint fires
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(harness.stdout.clearCalls >= 1, `expected >=1 clear calls, got ${harness.stdout.clearCalls}`);

  harness.resolveExit();
  await flushMicrotasks();
});

test("debounced repaint fires after rapid resizes to identical dimensions", async () => {
  const harness = createSupportedHarness();
  startApp(harness.deps);

  // Reset counters after initial render
  harness.stdout.clearCalls = 0;
  harness.stdout.writes = "";

  try {
    // Emit two resizes to identical valid dims in quick succession — simulates
    // max→standard where the final dims match what React already rendered.
    // The debounce should collapse both into a single repaint.
    harness.stdout.columns = 100;
    harness.stdout.rows = 35;
    harness.stdout.emit("resize");
    harness.stdout.emit("resize");

    // No writes happen immediately — scrollback clear is deferred.

    // No clear() yet — deferred to the debounced repaint
    assert.equal(harness.stdout.clearCalls, 0);

    // Wait for the 150ms debounce to fire
    await new Promise((resolve) => setTimeout(resolve, 200));

    // renderHandle.clear() should have been called by the debounced repaint.
    // (In mocks inkInstance is null so the fallback path runs.)
    assert.ok(harness.stdout.clearCalls >= 1, `expected >=1 clear calls, got ${harness.stdout.clearCalls}`);
  } finally {
    harness.resolveExit();
    await flushMicrotasks();
  }
});

test("scheduled repaint calls renderHandle.clear when inkInstance is null", async () => {
  const harness = createSupportedHarness();
  startApp(harness.deps);

  // Reset counters after initial render
  harness.stdout.clearCalls = 0;
  harness.stdout.writes = "";

  // Emit a normal resize — triggers scheduleRepaint (no immediate writes)
  harness.stdout.columns = 80;
  harness.stdout.emit("resize");

  // Immediately after resize: no writes and no renderHandle.clear() yet
  assert.equal(harness.stdout.clearCalls, 0);
  assert.equal(harness.stdout.writes, "");

  // Wait for the 150ms debounce to fire
  await new Promise((resolve) => setTimeout(resolve, 200));

  // In test mocks, inkInstance is null so scheduleRepaint uses the fallback
  // path that calls renderHandle.clear() (no HARD_REPAINT_SEQUENCE written
  // in the fallback branch — the full sequence is only used when inkInstance
  // is available).
  assert.ok(harness.stdout.clearCalls >= 1, `expected >=1 clear calls, got ${harness.stdout.clearCalls}`);

  harness.resolveExit();
  await flushMicrotasks();
});
