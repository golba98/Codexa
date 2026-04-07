import assert from "node:assert/strict";
import test from "node:test";
import {
  clampVisualText,
  createLayoutSnapshot,
  getShellHeight,
  getShellWidth,
  getUsableShellWidth,
  getVisualWidth,
} from "./layout.js";

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

test("marks undersized terminals for composer-only fallback", () => {
  assert.equal(createLayoutSnapshot(47, 24).tooSmall, true);
  assert.equal(createLayoutSnapshot(80, 11).tooSmall, true);
  assert.equal(createLayoutSnapshot(80, 24).tooSmall, false);
});

test("preserves the previous layout when resize values are invalid", () => {
  const previous = createLayoutSnapshot(80, 30);
  const next = createLayoutSnapshot(0, -1, previous);

  assert.deepEqual(next, previous);
});

test("measures visual width instead of raw string length", () => {
  assert.equal("⚡".length, 1);
  assert.equal(getVisualWidth("⚡"), 2);
});

test("clamps text to a visual width budget", () => {
  assert.equal(clampVisualText("ACTION REQUIRED", 8), "ACTION …");
  assert.equal(clampVisualText("⚡⚡", 3), "⚡…");
});
