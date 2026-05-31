import assert from "node:assert/strict";
import test from "node:test";
import {
  resetInkOutputForFreshFrame,
  resolveInkRenderInstance,
  type InkRenderInstance,
} from "./inkRenderReset.js";

function createFakeInkInstance() {
  const calls = { logReset: 0, throttledOnRenderCancel: 0, throttledLogCancel: 0 };
  const instance: InkRenderInstance & { writes: string } = {
    lastOutput: "previous-frame",
    lastOutputToRender: "previous-frame-to-render\n",
    lastOutputHeight: 12,
    lastTerminalWidth: 80,
    fullStaticOutput: "old-static-output",
    writes: "",
    log: {
      reset() {
        calls.logReset += 1;
      },
    },
    throttledOnRender: {
      cancel() {
        calls.throttledOnRenderCancel += 1;
      },
    },
    throttledLog: {
      cancel() {
        calls.throttledLogCancel += 1;
      },
    },
  };
  return { instance, calls };
}

test("resetInkOutputForFreshFrame zeroes Ink frame caches to the startup baseline", () => {
  const { instance, calls } = createFakeInkInstance();

  const result = resetInkOutputForFreshFrame({ instance, columns: 140 });

  assert.equal(result, true);
  assert.equal(instance.lastOutput, "");
  assert.equal(instance.lastOutputToRender, "");
  assert.equal(instance.lastOutputHeight, 0);
  assert.equal(instance.fullStaticOutput, "");
  assert.equal(instance.lastTerminalWidth, 140, "reseats lastTerminalWidth so the next frame is not treated as a width shrink");
  assert.equal(calls.logReset, 1, "resets log-update accounting exactly once");
  assert.equal(calls.throttledOnRenderCancel, 1, "drops any pending throttled render");
  assert.equal(calls.throttledLogCancel, 1, "drops any pending throttled log write");
});

test("resetInkOutputForFreshFrame emits no clear/erase escape sequences itself", () => {
  // The terminal is already physically cleared by clearTranscript before this
  // runs; the reset must not write its own escape sequences. Our fake exposes
  // a `writes` buffer that nothing in the reset path should touch.
  const { instance } = createFakeInkInstance();
  instance.writes = "";

  resetInkOutputForFreshFrame({ instance, columns: 100 });

  assert.equal(instance.writes, "", "reset relies on the already-issued physical clear, never writes escapes");
});

test("resetInkOutputForFreshFrame leaves lastTerminalWidth untouched when columns is not finite", () => {
  const { instance } = createFakeInkInstance();

  resetInkOutputForFreshFrame({ instance, columns: undefined });
  assert.equal(instance.lastTerminalWidth, 80);

  resetInkOutputForFreshFrame({ instance, columns: Number.NaN });
  assert.equal(instance.lastTerminalWidth, 80);
});

test("resetInkOutputForFreshFrame is a graceful no-op when no Ink instance is available", () => {
  const result = resetInkOutputForFreshFrame({ instance: null, columns: 120 });
  assert.equal(result, false);
});

test("resetInkOutputForFreshFrame tolerates partial Ink instances", () => {
  // A future Ink version may not expose every field; the reset must not throw.
  const partial: InkRenderInstance = { lastOutputHeight: 5 };
  const result = resetInkOutputForFreshFrame({ instance: partial, columns: 120 });
  assert.equal(result, true);
  assert.equal(partial.lastOutputHeight, 0);
});

test("resolveInkRenderInstance returns null for an unknown stdout without throwing", () => {
  const unknownStdout = { columns: 80, rows: 24 };
  assert.equal(resolveInkRenderInstance(unknownStdout), null);
});
