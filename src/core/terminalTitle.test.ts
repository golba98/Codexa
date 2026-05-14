import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireTerminalTitleGuard,
  buildTerminalTitleSequence,
  computeTerminalTitle,
  deriveTerminalTitle,
  formatTerminalTitleLabel,
  reassertTerminalTitle,
  sanitizeTerminalTitle,
  setTerminalTitle,
  beginColdStartSequence,
  __resetTerminalTitleCache,
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
    "Codexa",
  );
});

test("deriveTerminalTitle follows terminal title mode on startup", () => {
  const workspaceRoot = "C:\\Development\\1-JavaScript\\13-Custom-CLI-Normal";

  assert.equal(deriveTerminalTitle(workspaceRoot, "dir"), "13-Custom-CLI-Normal");
  assert.equal(deriveTerminalTitle(workspaceRoot, "name"), "Codexa");
  assert.equal(deriveTerminalTitle(workspaceRoot, "simple"), "Codexa");
});

test("computeTerminalTitle follows the requested mapping", () => {
  const workspaceName = "13-Custom-CLI-Normal";
  assert.equal(computeTerminalTitle({ terminalTitleMode: "dir", workspaceName }), "13-Custom-CLI-Normal");
  assert.equal(computeTerminalTitle({ terminalTitleMode: "name" }), "Codexa");
  assert.equal(computeTerminalTitle({ terminalTitleMode: "simple" }), "Codexa");
  assert.equal(computeTerminalTitle({ terminalTitleMode: "dir", appName: "Other" }), "Other");
});

test("reassertTerminalTitle writes both title sequences without mutating process title", () => {
  const writes: string[] = [];
  const originalTitle = process.title;

  try {
    reassertTerminalTitle("Codexa", (chunk) => {
      writes.push(chunk);
    });

    assert.equal(process.title, originalTitle);
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

test("setTerminalTitle deduplicates identical title writes", () => {
  const writes: string[] = [];
  __resetTerminalTitleCache();

  setTerminalTitle("Codexa", { write: (chunk) => writes.push(chunk) });
  setTerminalTitle("Codexa", { write: (chunk) => writes.push(chunk) });
  setTerminalTitle("Other", { write: (chunk) => writes.push(chunk) });

  assert.equal(writes.length, 2);
  assert.equal(writes[0], buildTerminalTitleSequence("Codexa"));
  assert.equal(writes[1], buildTerminalTitleSequence("Other"));
});

test("setTerminalTitle force option bypasses dedup", () => {
  const writes: string[] = [];
  __resetTerminalTitleCache();

  setTerminalTitle("Codexa", { write: (chunk) => writes.push(chunk) });
  setTerminalTitle("Codexa", { force: true, write: (chunk) => writes.push(chunk) });
  setTerminalTitle("Codexa", { force: true, write: (chunk) => writes.push(chunk) });

  assert.equal(writes.length, 3);
  writes.forEach((w) => assert.equal(w, buildTerminalTitleSequence("Codexa")));
});

test("beginColdStartSequence writes immediately then retries", async () => {
  const writes: string[] = [];
  __resetTerminalTitleCache();

  const cancel = beginColdStartSequence("Codexa", { write: (chunk) => writes.push(chunk) });
  
  assert.equal(writes.length, 1, "should write immediately");
  
  await sleep(60);
  assert.equal(writes.length, 2, "should have retried at 50ms");
  
  cancel();
  await sleep(300);
  assert.equal(writes.length, 2, "should not have retried further after cancel");
});
