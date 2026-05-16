import assert from "node:assert/strict";
import test from "node:test";
import { ChildProcess } from "node:child_process";
import { runCommand, type CommandResult } from "../process/CommandRunner.js";
import { resolveExecutable, buildSpawnSpec } from "./executableResolver.js";

function commandResult(overrides: Partial<CommandResult>): CommandResult {
  return {
    status: "completed",
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    startedAt: 0,
    endedAt: 0,
    durationMs: 0,
    userMessage: "Command completed.",
    ...overrides,
  };
}

function mockRunCommand(result: CommandResult, onCall?: (spec: Parameters<typeof runCommand>[0]) => void): typeof runCommand {
  return ((spec) => {
    onCall?.(spec);
    return {
      child: null as unknown as ChildProcess,
      result: Promise.resolve(result),
      cancel: () => undefined,
    };
  }) as typeof runCommand;
}

test("resolver: uses configuredPath", async () => {
  const resolved = await resolveExecutable({
    commandNames: ["test"],
    label: "test",
    configuredPath: process.execPath,
  });
  assert.equal(resolved, process.execPath);
});

test("resolver: uses environment override", async () => {
  const original = process.env.TEST_EXECUTABLE;
  process.env.TEST_EXECUTABLE = "custom-test";
  try {
    const resolved = await resolveExecutable({
      commandNames: ["test"],
      label: "test",
      envOverrides: ["TEST_EXECUTABLE"],
    });
    assert.equal(resolved, "custom-test");
  } finally {
    if (original === undefined) delete process.env.TEST_EXECUTABLE;
    else process.env.TEST_EXECUTABLE = original;
  }
});

test("resolver: falls back to bare name if not found", async () => {
  const mockImpl = mockRunCommand(commandResult({ status: "failed", exitCode: 1 }));
  const resolved = await resolveExecutable({
    runCommandImpl: mockImpl,
    commandNames: ["mytest"],
    label: "test",
  });
  assert.equal(resolved, "mytest");
});

test("buildSpawnSpec: wraps .cmd files in cmd.exe on Windows", async () => {
  if (process.platform !== "win32") return;
  const spec = buildSpawnSpec("test.cmd", ["arg1"]);
  assert.equal(spec.executable, "cmd.exe");
  assert.deepEqual(spec.args, ["/d", "/s", "/c", "test.cmd", "arg1"]);
});

test("buildSpawnSpec: does not wrap .exe files", async () => {
  if (process.platform !== "win32") return;
  const spec = buildSpawnSpec("test.exe", ["arg1"]);
  assert.equal(spec.executable, "test.exe");
  assert.deepEqual(spec.args, ["arg1"]);
});
