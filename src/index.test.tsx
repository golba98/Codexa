import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
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

test("strict VT mode refuses unsupported terminals without writing bracketed paste sequences", () => {
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
    env: { CODEXA_REQUIRE_VT: "1" },
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

test("uncertain Windows VT support warns but continues without stdout probing", () => {
  let stdoutWrites = "";
  let stderrWrites = "";
  let renderCalled = false;
  const registeredHandlers: Array<() => void> = [];

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
    registerExitHandler(handler) {
      registeredHandlers.push(handler);
    },
  });

  assert.deepEqual(result, { started: true, exitCode: 0 });
  assert.equal(renderCalled, true);
  assert.match(stderrWrites, /will continue/i);
  assert.doesNotMatch(stdoutWrites, /\x1b(?:\[6n|\[>c|\[c|c)/);

  registeredHandlers[0]?.();
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

  // Normal valid resize is a soft repaint and must not call Ink.clear().
  assert.equal(harness.stdout.clearCalls, 0, "normal resize must not call clear()");

  // Post-resize writes must not contain full/viewport clear sequences.
  const resizeWrites = harness.stdout.writes.slice(startupEnd);
  assert.doesNotMatch(resizeWrites, /\x1b\[3J/, "scrollback must not be erased on resize");
  assert.doesNotMatch(resizeWrites, /\x1b\[2J/, "normal resize must not clear the viewport");

  harness.resolveExit();
  await flushMicrotasks();
});

test("normal app render writes do not clear the terminal after startup", async () => {
  const harness = createSupportedHarness();
  startApp(harness.deps);

  const appWriteStart = harness.stdout.writes.indexOf("\x1b[?1000h");
  assert.ok(appWriteStart >= 0, "mock app render should write mouse mode");
  const appWrites = harness.stdout.writes.slice(appWriteStart);

  assert.equal(harness.stdout.clearCalls, 0);
  assert.doesNotMatch(appWrites, /\x1b\[2J|\x1b\[3J/);

  harness.resolveExit();
  await flushMicrotasks();
});

test("soft-repaints when resize occurs without invalid dimensions", async () => {
  const harness = createSupportedHarness();
  startApp(harness.deps);

  const writesBefore = harness.stdout.writes;

  // Emit a resize at valid dimensions (no invalid transition)
  harness.stdout.columns = 80;
  harness.stdout.emit("resize");

  // No writes happen immediately.
  const immediateWrites = harness.stdout.writes.slice(writesBefore.length);
  assert.equal(immediateWrites, "");

  // After debounce fires, valid resize still avoids terminal clear writes.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(harness.stdout.clearCalls, 0);
  const delayedWrites = harness.stdout.writes.slice(writesBefore.length);
  assert.doesNotMatch(delayedWrites, /\x1b\[2J|\x1b\[3J/);

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

    // No writes happen immediately.

    assert.equal(harness.stdout.clearCalls, 0);

    // Wait for the 150ms debounce to fire
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Valid resize remains a soft repaint, even when rapid events collapse.
    assert.equal(harness.stdout.clearCalls, 0);
    assert.equal(harness.stdout.writes, "");
  } finally {
    harness.resolveExit();
    await flushMicrotasks();
  }
});

test("scheduled soft repaint does not call renderHandle.clear when inkInstance is null", async () => {
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

  // In test mocks inkInstance is null; normal valid resize should still avoid
  // the fallback clear path.
  assert.equal(harness.stdout.clearCalls, 0);
  assert.equal(harness.stdout.writes, "");

  harness.resolveExit();
  await flushMicrotasks();
});

test("render startup does not introduce alternate-screen mode", () => {
  const source = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /write\([^)]*1049h/);
  assert.doesNotMatch(source, /const\s+\w+\s*=\s*["'`][^"'`]*1049h/);
});
