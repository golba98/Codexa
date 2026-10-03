import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  type CommandResult,
  runCommand,
  runShellCommand,
  summarizeCommandResult,
} from "./CommandRunner.js";

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

test("runCommand pipes stdinData to the child process", async () => {
  const runner = runCommand({
    executable: process.execPath,
    args: [
      "-e",
      "let d=''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => process.stdout.write(d));",
    ],
    cwd: process.cwd(),
    stdinData: "stdin-payload",
  });

  const result = await runner.result;
  assert.equal(result.status, "completed");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "stdin-payload");
});

test("runCommand without stdinData keeps stdin closed so children do not hang", async () => {
  const runner = runCommand({
    executable: process.execPath,
    args: [
      "-e",
      "let d=''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => process.stdout.write('closed:' + d));",
    ],
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });

  const result = await runner.result;
  assert.equal(result.status, "completed");
  assert.equal(result.stdout.trim(), "closed:");
});

test("runCommand rejects obvious executable injection", () => {
  assert.throws(
    () =>
      runCommand({
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
  const source = readFileSync(
    fileURLToPath(new URL("./CommandRunner.ts", import.meta.url)),
    "utf8",
  );
  const beforeSpawnIndex = source.indexOf('handlers.onProcessLifecycle?.("before-spawn")');
  const spawnIndex = source.indexOf("child = spawn(");
  const spawnedIndex = source.indexOf('handlers.onProcessLifecycle?.("spawned")', spawnIndex);
  const errorIndex = source.indexOf('child.once("error"', spawnIndex);
  const lifecycleErrorIndex = source.indexOf('handlers.onProcessLifecycle?.("error")', errorIndex);
  const closeIndex = source.indexOf('child.once("close"', spawnIndex);
  const exitIndex = source.indexOf('handlers.onProcessLifecycle?.("exit")', closeIndex);
  const cancelIndex = source.indexOf("cancel: () =>");
  const lifecycleCancelIndex = source.indexOf(
    'handlers.onProcessLifecycle?.("cancel")',
    cancelIndex,
  );

  assert.ok(beforeSpawnIndex >= 0 && beforeSpawnIndex < spawnIndex);
  assert.ok(spawnedIndex > spawnIndex);
  assert.ok(lifecycleErrorIndex > errorIndex);
  assert.ok(exitIndex > closeIndex);
  assert.ok(lifecycleCancelIndex > cancelIndex);
});

test("generic command runner does not expose shell mode", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./CommandRunner.ts", import.meta.url)),
    "utf8",
  );
  assert.equal(source.includes("shell?: boolean"), false);
  assert.equal(source.includes("spec.shell"), false);
});

test("cancel waits for an ignoring descendant even after the group leader closes", {
  skip: process.platform === "win32",
}, async () => {
  const { mkdtempSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "ubume-group-"));
  const marker = join(root, "writes");
  const descendant = `const fs=require('fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.writeFileSync(${JSON.stringify(marker)},String(Date.now())),20)`;
  const parent = `require('child_process').spawn('node',['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)`;
  const runner = runCommand({ executable: "node", args: ["-e", parent], cwd: root });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(marker)) {
      if (Date.now() > deadline) throw new Error("Descendant did not start.");
      await new Promise((r) => setTimeout(r, 20));
    }
    runner.cancel();
    await runner.stopped;
    const final = readFileSync(marker, "utf8");
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      readFileSync(marker, "utf8"),
      final,
      "descendant kept writing after stopped resolved",
    );
  } finally {
    try {
      process.kill(-runner.child.pid!, "SIGKILL");
    } catch {
      /* Already stopped. */
    }
    rmSync(root, { recursive: true, force: true });
  }
});
