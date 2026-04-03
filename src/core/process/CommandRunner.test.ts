import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCommandResult, type CommandResult } from "./CommandRunner.js";

function makeResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    status: "completed",
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    startedAt: 1,
    endedAt: 2,
    durationMs: 1,
    userMessage: "Command completed.",
    ...overrides,
  };
}

test("summarizes ripgrep file listings without flooding the UI", () => {
  const result = makeResult({
    stdout: "src/app.tsx\nsrc/ui/BottomComposer.tsx\n",
  });

  assert.equal(summarizeCommandResult("rg --files", result), "Found 2 files.");
});

test("keeps a concise fallback summary for generic successful commands", () => {
  const result = makeResult({
    stdout: "alpha\nbeta\ngamma\n",
  });

  assert.equal(summarizeCommandResult("node script.js", result), "Produced 3 lines of output.");
});

test("preserves the failure message for unsuccessful commands", () => {
  const result = makeResult({
    status: "failed",
    exitCode: 1,
    userMessage: "git exited with code 1.",
    stderr: "fatal: not a git repository",
  });

  assert.equal(summarizeCommandResult("git status", result), "git exited with code 1.");
});
