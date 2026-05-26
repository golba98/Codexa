import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runCommand, runShellCommand, summarizeCommandResult, type CommandResult } from "./CommandRunner.js";

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

test("runCommand executes a direct executable with argument array", async () => {
  const runner = runCommand({
    executable: process.execPath,
    args: ["-e", "console.log(process.argv[1])", "direct-ok"],
    cwd: process.cwd(),
  });

  const result = await runner.result;
  assert.equal(result.status, "completed");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "direct-ok");
});

test("runCommand rejects obvious executable injection", () => {
  assert.throws(
    () => runCommand({
      executable: "node & echo injected",
      args: ["--version"],
      cwd: process.cwd(),
    }),
    /single executable name|shell metacharacters/i,
  );
});

test("runShellCommand is the explicit shell execution path", async () => {
  const runner = runShellCommand("echo shell-ok", { cwd: process.cwd() });
  const result = await runner.result;

  assert.equal(result.status, "completed");
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /shell-ok/);
});

test("command runner reports lifecycle boundaries for terminal title reassertion", () => {
  const source = readFileSync(fileURLToPath(new URL("./CommandRunner.ts", import.meta.url)), "utf8");
  const beforeSpawnIndex = source.indexOf('handlers.onProcessLifecycle?.("before-spawn")');
  const spawnIndex = source.indexOf("child = spawn(");
  const spawnedIndex = source.indexOf('handlers.onProcessLifecycle?.("spawned")', spawnIndex);
  const errorIndex = source.indexOf('child.once("error"', spawnIndex);
  const lifecycleErrorIndex = source.indexOf('handlers.onProcessLifecycle?.("error")', errorIndex);
  const closeIndex = source.indexOf('child.once("close"', spawnIndex);
  const exitIndex = source.indexOf('handlers.onProcessLifecycle?.("exit")', closeIndex);
  const cancelIndex = source.indexOf("cancel: () =>");
  const lifecycleCancelIndex = source.indexOf('handlers.onProcessLifecycle?.("cancel")', cancelIndex);

  assert.ok(beforeSpawnIndex >= 0 && beforeSpawnIndex < spawnIndex);
  assert.ok(spawnedIndex > spawnIndex);
  assert.ok(lifecycleErrorIndex > errorIndex);
  assert.ok(exitIndex > closeIndex);
  assert.ok(lifecycleCancelIndex > cancelIndex);
});

test("generic command runner does not expose shell mode", () => {
  const source = readFileSync(fileURLToPath(new URL("./CommandRunner.ts", import.meta.url)), "utf8");
  assert.equal(source.includes("shell?: boolean"), false);
  assert.equal(source.includes("spec.shell"), false);
});
