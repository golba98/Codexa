import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireTerminalTitleGuard,
  buildTerminalTitleSequence,
  createTerminalTitleController,
  deriveTerminalTitle,
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

test("deriveTerminalTitle follows terminal title mode on startup", () => {
  const workspaceRoot = "C:\\Development\\1-JavaScript\\13-Custom-CLI-Normal";

  assert.equal(deriveTerminalTitle(workspaceRoot, "dir"), "13-Custom-CLI-Normal");
  assert.equal(deriveTerminalTitle(workspaceRoot, "name"), "Codexa");
  assert.equal(deriveTerminalTitle(workspaceRoot, "simple"), "13-Custom-CLI-Normal");
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

test("createTerminalTitleController deduplicates identical title writes", () => {
  const writes: string[] = [];
  const controller = createTerminalTitleController((chunk) => writes.push(chunk));

  controller.write("Codexa");
  controller.write("Codexa");
  controller.write("Other");

  assert.equal(writes.length, 2);
  assert.equal(writes[0], buildTerminalTitleSequence("Codexa"));
  assert.equal(writes[1], buildTerminalTitleSequence("Other"));
});

test("createTerminalTitleController force option bypasses dedup for cold-start retries", () => {
  const writes: string[] = [];
  const controller = createTerminalTitleController((chunk) => writes.push(chunk));

  controller.write("Codexa");
  controller.write("Codexa", { force: true });
  controller.write("Codexa", { force: true });

  assert.equal(writes.length, 3);
  writes.forEach((w) => assert.equal(w, buildTerminalTitleSequence("Codexa")));
});

test("createTerminalTitleController returns 13-Custom-CLI-Normal for dir mode", () => {
  const workspaceRoot = "C:\\Development\\1-JavaScript\\13-Custom-CLI-Normal";
  assert.equal(deriveTerminalTitle(workspaceRoot, "dir"), "13-Custom-CLI-Normal");
});

test("createTerminalTitleController returns Codexa for name mode", () => {
  const workspaceRoot = "C:\\Development\\1-JavaScript\\13-Custom-CLI-Normal";
  assert.equal(deriveTerminalTitle(workspaceRoot, "name"), "Codexa");
});

test("beginColdStartSequence writes immediately then retries at 50ms and 250ms", async () => {
  const timestamps: number[] = [];
  const start = Date.now();
  const controller = createTerminalTitleController(() => {
    timestamps.push(Date.now() - start);
  });

  const cancel = controller.beginColdStartSequence("Codexa");

  await sleep(300);
  cancel();

  assert.equal(timestamps.length, 3, `expected 3 writes, got ${timestamps.length}`);
  assert.ok(timestamps[0]! < 20, `first write should be immediate, was ${timestamps[0]}ms`);
  assert.ok(timestamps[1]! >= 40 && timestamps[1]! < 120, `second write should be ~50ms, was ${timestamps[1]}ms`);
  assert.ok(timestamps[2]! >= 200, `third write should be ~250ms, was ${timestamps[2]}ms`);
});

test("beginColdStartSequence cancel stops pending retries", async () => {
  let writes = 0;
  const controller = createTerminalTitleController(() => {
    writes += 1;
  });

  const cancel = controller.beginColdStartSequence("Codexa");
  cancel();

  await sleep(300);

  assert.equal(writes, 1, "only immediate write should have fired after cancel");
});

test("beginColdStartSequence force-writes even if title matches last known title", () => {
  const writes: string[] = [];
  const controller = createTerminalTitleController((chunk) => writes.push(chunk));

  controller.write("Codexa");
  assert.equal(writes.length, 1);

  controller.beginColdStartSequence("Codexa");
  assert.equal(writes.length, 2, "cold-start should force-write even after dedup state is set");
});
