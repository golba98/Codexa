import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireTerminalTitleGuard,
  buildTerminalTitleSequence,
  formatTerminalTitleLabel,
  reassertTerminalTitle,
  sanitizeTerminalTitle,
} from "./terminalTitle.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("buildTerminalTitleSequence emits OSC 0 and OSC 2 with sanitized title text", () => {
  const sequence = buildTerminalTitleSequence("Codexa\u0007!");
  assert.equal(sequence, "\x1b]0;Codexa !\x07\x1b]2;Codexa !\x07");
  assert.equal(sanitizeTerminalTitle("  Codexa  "), "Codexa");
});

test("formatTerminalTitleLabel follows the workspace leaf and app-name rules", () => {
  assert.equal(
    formatTerminalTitleLabel("C:\\Development\\1-JavaScript\\13-Custom-CLI-Normal", "dir"),
    "13-Custom-CLI-Normal",
  );
  assert.equal(
    formatTerminalTitleLabel("C:\\Development\\1-JavaScript\\13-Custom-CLI-Normal", "name"),
    "Codexa",
  );
  assert.equal(
    formatTerminalTitleLabel("C:\\Development\\1-JavaScript\\13-Custom-CLI-Normal", "simple"),
    "13-Custom-CLI-Normal",
  );
});

test("reassertTerminalTitle sets the process title and writes both title sequences", () => {
  const originalTitle = process.title;
  const writes: string[] = [];

  try {
    reassertTerminalTitle("Codexa", (chunk) => {
      writes.push(chunk);
    });

    assert.equal(process.title, "Codexa");
    assert.deepEqual(writes, [buildTerminalTitleSequence("Codexa")]);
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
