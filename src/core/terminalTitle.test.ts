import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireTerminalTitleGuard,
  reassertTerminalTitle,
  SET_TERMINAL_TITLE,
  TERMINAL_TITLE,
} from "./terminalTitle.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("reassertTerminalTitle sets the process title and writes both title sequences", () => {
  const originalTitle = process.title;
  const writes: string[] = [];

  try {
    reassertTerminalTitle((chunk) => {
      writes.push(chunk);
    });

    assert.equal(process.title, TERMINAL_TITLE);
    assert.deepEqual(writes, [SET_TERMINAL_TITLE]);
  } finally {
    process.title = originalTitle;
  }
});

test("acquireTerminalTitleGuard asserts immediately, ticks while active, and reasserts on release", async () => {
  let calls = 0;
  const release = acquireTerminalTitleGuard(10, () => {
    calls += 1;
  });

  await sleep(35);
  release();

  const callsAfterRelease = calls;
  await sleep(20);

  assert.ok(callsAfterRelease >= 3, `expected at least 3 title assertions, got ${callsAfterRelease}`);
  assert.equal(calls, callsAfterRelease);
});

test("acquireTerminalTitleGuard release is idempotent", () => {
  let calls = 0;
  const release = acquireTerminalTitleGuard(50, () => {
    calls += 1;
  });

  release();
  const callsAfterFirstRelease = calls;
  release();

  assert.equal(callsAfterFirstRelease, 2);
  assert.equal(calls, callsAfterFirstRelease);
});
