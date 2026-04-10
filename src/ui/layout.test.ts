import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceTerminalViewport,
  clampVisualText,
  createTerminalViewport,
  createLayoutSnapshot,
  getShellHeight,
  getShellWidth,
  getUsableShellWidth,
  getVisualWidth,
} from "./layout.js";
import { measureTopHeaderRows } from "./TopHeader.js";

test("leaves a one-column gutter to avoid edge-triggered scrollbars", () => {
  assert.equal(getShellWidth(120), 119);
  assert.equal(getShellWidth(80), 79);
});

test("keeps a sensible minimum shell width on tiny terminals", () => {
  assert.equal(getShellWidth(20), 20);
  assert.equal(getShellWidth(10), 20);
  assert.equal(getShellWidth(undefined), 119);
});

test("derives usable shell width from the guttered viewport width", () => {
  assert.equal(getUsableShellWidth(120, 6), 113);
  assert.equal(getUsableShellWidth(20, 30), 1);
});

test("leaves a one-row gutter to avoid edge-triggered bottom scrolling", () => {
  assert.equal(getShellHeight(40), 39);
  assert.equal(getShellHeight(24), 23);
});

test("keeps a sensible minimum shell height on tiny terminals", () => {
  assert.equal(getShellHeight(10), 10);
  assert.equal(getShellHeight(5), 10);
  assert.equal(getShellHeight(undefined), 23);
});

test("keeps breakpoint modes stable at the edges", () => {
  assert.equal(createLayoutSnapshot(110, 24).mode, "full");
  assert.equal(createLayoutSnapshot(109, 24).mode, "compact");
  assert.equal(createLayoutSnapshot(60, 24).mode, "compact");
  assert.equal(createLayoutSnapshot(59, 24).mode, "micro");
});

test("measures the header rows for full and compact layouts", () => {
  assert.equal(measureTopHeaderRows(createLayoutSnapshot(120, 30)), 6);
  assert.equal(measureTopHeaderRows(createLayoutSnapshot(80, 24)), 1);
});

test("preserves the previous layout when resize values are invalid", () => {
  const previous = createLayoutSnapshot(80, 30);
  const next = createLayoutSnapshot(0, -1, previous);

  assert.deepEqual(next, previous);
});

test("marks undersized restore samples as unstable without discarding the last stable layout", () => {
  const stable = createTerminalViewport(120, 40);
  const invalidSamples = [
    advanceTerminalViewport(stable, 1, 1),
    advanceTerminalViewport(stable, 2, 1),
    advanceTerminalViewport(stable, 1, 24),
    advanceTerminalViewport(stable, 24, 1),
    // Medium-invalid: pass old <=1 check but fail MIN_VIEWPORT thresholds
    advanceTerminalViewport(stable, 15, 8),
    advanceTerminalViewport(stable, 19, 24),
    advanceTerminalViewport(stable, 120, 9),
  ];

  for (const sample of invalidSamples) {
    assert.equal(sample.unstable, true);
    assert.equal(sample.cols, stable.cols);
    assert.equal(sample.rows, stable.rows);
    assert.equal(sample.layoutEpoch, stable.layoutEpoch);
  }
});

test("bumps the layout epoch when the terminal recovers from an unstable restore", () => {
  const stable = createTerminalViewport(120, 40);
  const unstable = advanceTerminalViewport(stable, 1, 1);
  const recovered = advanceTerminalViewport(unstable, 100, 30);

  assert.equal(unstable.unstable, true);
  assert.equal(recovered.unstable, false);
  assert.equal(recovered.cols, 100);
  assert.equal(recovered.rows, 30);
  assert.equal(recovered.layoutEpoch, stable.layoutEpoch + 1);
});

test("measures visual width instead of raw string length", () => {
  assert.equal("⚡".length, 1);
  assert.equal(getVisualWidth("⚡"), 2);
});

test("clamps text to a visual width budget", () => {
  assert.equal(clampVisualText("ACTION REQUIRED", 8), "ACTION …");
  assert.equal(clampVisualText("⚡⚡", 3), "⚡…");
});
