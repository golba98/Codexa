import assert from "node:assert/strict";
import test from "node:test";
import {
  BUSY_STATUS_FRAMES,
  getBusyStatusFrame,
  isAnimatedBusyState,
} from "./busyStatusAnimation.js";

test("busy status frames advance in a fixed-width dot slot", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map(getBusyStatusFrame),
    [" .  ", " .. ", " ...", " .  ", " .. "],
  );
  assert.ok(BUSY_STATUS_FRAMES.every((frame) => frame.length === BUSY_STATUS_FRAMES[0]!.length));
});

test("busy animation runs only for active work states", () => {
  assert.equal(isAnimatedBusyState("THINKING"), true);
  assert.equal(isAnimatedBusyState("RESPONDING"), true);
  assert.equal(isAnimatedBusyState("SHELL_RUNNING"), true);
  assert.equal(isAnimatedBusyState("IDLE"), false);
  assert.equal(isAnimatedBusyState("ERROR"), false);
  assert.equal(isAnimatedBusyState("AWAITING_USER_ACTION"), false);
});
