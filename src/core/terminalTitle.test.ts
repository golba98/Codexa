import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireTerminalTitleGuard,
  buildTerminalTitleSequence,
  computeTerminalTitle,
  deriveTerminalTitle,
  formatTerminalTitleLabel,
  getIntendedTerminalTitle,
  normalizeTerminalTitle,
  reassertTerminalTitle,
  reassertIntendedTerminalTitle,
  sanitizeTerminalTitle,
  setIntendedTerminalTitle,
  setTerminalTitle,
  startTerminalTitleStartupGuard,
  beginColdStartSequence,
  createTerminalTitleSequenceStripper,
  stripTerminalTitleSequences,
  stripTerminalTitleSequencesFromChunk,
  writeCodexaTerminalTitle,
  writeGuardedTerminalOutput,
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

test("title normalization never exposes raw Windows paths", () => {
  assert.equal(normalizeTerminalTitle("C:\\WINDOWS\\system"), "Codexa");
  assert.equal(normalizeTerminalTitle("c:/Users/example"), "Codexa");
  assert.equal(normalizeTerminalTitle("\\\\server\\share"), "Codexa");
  assert.equal(buildTerminalTitleSequence("C:\\WINDOWS\\system"), buildTerminalTitleSequence("Codexa"));
});

test("stripTerminalTitleSequences removes OSC 0 title sequences with BEL terminator", () => {
  assert.equal(
    stripTerminalTitleSequences("hello\x1b]0;C:\\WINDOWS\\system\x07world"),
    "helloworld",
  );
});

test("stripTerminalTitleSequences removes OSC 2 title sequences with BEL terminator", () => {
  assert.equal(
    stripTerminalTitleSequences("hello\x1b]2;Codex\x07world"),
    "helloworld",
  );
});

test("stripTerminalTitleSequences preserves normal ANSI SGR colour sequences", () => {
  const input = "\x1b[31mred\x1b[0m";
  assert.equal(stripTerminalTitleSequences(input), input);
});

test("stripTerminalTitleSequences removes title OSC from mixed output while preserving SGR", () => {
  assert.equal(
    stripTerminalTitleSequences("start\x1b]0;C:\\WINDOWS\\system\x07middle\x1b[32mok\x1b[0mend"),
    "startmiddle\x1b[32mok\x1b[0mend",
  );
});

test("stripTerminalTitleSequences removes OSC title sequences with ST terminator", () => {
  assert.equal(
    stripTerminalTitleSequences("hello\x1b]0;C:\\WINDOWS\\system\x1b\\world"),
    "helloworld",
  );
});

test("stripTerminalTitleSequencesFromChunk handles Buffer input", () => {
  assert.equal(
    stripTerminalTitleSequencesFromChunk(Buffer.from("hello\x1b]0;C:\\WINDOWS\\system\x07world", "utf8")),
    "helloworld",
  );
});

test("createTerminalTitleSequenceStripper removes title sequences split across chunks", () => {
  const stripper = createTerminalTitleSequenceStripper({
    source: "test",
    stream: "stdout",
    origin: "child",
  });

  assert.equal(stripper.process("hello\x1b]0;C:\\WINDOWS"), "hello");
  assert.equal(stripper.process("\\system\x07world"), "world");
  assert.equal(stripper.flush(), "");
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

test("writeCodexaTerminalTitle delegates to central title writer with force support", () => {
  const writes: string[] = [];
  __resetTerminalTitleCache();

  writeCodexaTerminalTitle("Codexa", { force: true, reason: "test", write: (chunk) => writes.push(chunk) });

  assert.deepEqual(writes, [buildTerminalTitleSequence("Codexa")]);
});

test("intended terminal title fallback is safe and later replaced by workspace title", () => {
  const writes: string[] = [];
  __resetTerminalTitleCache();

  setIntendedTerminalTitle("C:\\WINDOWS\\system", {
    force: true,
    reason: "test-fallback",
    write: (chunk) => writes.push(chunk),
  });
  assert.equal(getIntendedTerminalTitle(), "Codexa");
  assert.equal(writes.at(-1), buildTerminalTitleSequence("Codexa"));

  setIntendedTerminalTitle("13-Custom-CLI-Normal", {
    force: true,
    reason: "test-workspace",
    write: (chunk) => writes.push(chunk),
  });
  assert.equal(getIntendedTerminalTitle(), "13-Custom-CLI-Normal");
  assert.equal(writes.at(-1), buildTerminalTitleSequence("13-Custom-CLI-Normal"));
});

test("busy idle reassertion keeps the same intended title", () => {
  const writes: string[] = [];
  __resetTerminalTitleCache();

  setIntendedTerminalTitle("13-Custom-CLI-Normal", {
    force: true,
    write: (chunk) => writes.push(chunk),
  });
  reassertIntendedTerminalTitle({ reason: "busy-start", write: (chunk) => writes.push(chunk) });
  reassertIntendedTerminalTitle({ reason: "busy-end", write: (chunk) => writes.push(chunk) });

  assert.equal(getIntendedTerminalTitle(), "13-Custom-CLI-Normal");
  assert.deepEqual(writes, [
    buildTerminalTitleSequence("13-Custom-CLI-Normal"),
    buildTerminalTitleSequence("13-Custom-CLI-Normal"),
    buildTerminalTitleSequence("13-Custom-CLI-Normal"),
  ]);
});

test("writeGuardedTerminalOutput strips external title OSC and preserves SGR", () => {
  const writes: string[] = [];
  const result = writeGuardedTerminalOutput(
    (chunk) => {
      writes.push(chunk);
      return true;
    },
    "start\x1b]0;C:\\WINDOWS\\system\x07middle\x1b[32mok\x1b[0mend",
    { source: "test", stream: "stdout", origin: "child" },
  );

  assert.equal(result, true);
  assert.deepEqual(writes, ["startmiddle\x1b[32mok\x1b[0mend"]);
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

test("startup guard reasserts intended title until cancelled", async () => {
  const writes: string[] = [];
  __resetTerminalTitleCache();

  setIntendedTerminalTitle("13-Custom-CLI-Normal", {
    force: true,
    write: (chunk) => writes.push(chunk),
  });
  const cancel = startTerminalTitleStartupGuard({
    intervalMs: 10,
    durationMs: 100,
    write: (chunk) => writes.push(chunk),
  });

  await sleep(25);
  cancel();
  const writesAfterCancel = writes.length;
  await sleep(25);

  assert.ok(writesAfterCancel >= 3, `expected guard to reassert title, got ${writesAfterCancel} writes`);
  assert.equal(writes.length, writesAfterCancel);
  assert.ok(writes.every((chunk) => chunk === buildTerminalTitleSequence("13-Custom-CLI-Normal")));
});
