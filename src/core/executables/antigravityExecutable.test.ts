import assert from "node:assert/strict";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { resetAgyExecutableCacheForTests, resolveAgyExecutable } from "./antigravityExecutable.js";
import { runCommand, type CommandResult } from "../process/CommandRunner.js";

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

function mockRunCommand(onCall: (spec: Parameters<typeof runCommand>[0]) => CommandResult): typeof runCommand {
  return ((spec) => ({
    child: null as unknown as ChildProcess,
    result: Promise.resolve(onCall(spec)),
    cancel: () => undefined,
  })) as typeof runCommand;
}

async function withEnv<T>(env: Partial<NodeJS.ProcessEnv>, callback: () => Promise<T>): Promise<T> {
  const originalExecutable = process.env.AGY_EXECUTABLE;
  try {
    if ("AGY_EXECUTABLE" in env) process.env.AGY_EXECUTABLE = env.AGY_EXECUTABLE;
    else delete process.env.AGY_EXECUTABLE;
    resetAgyExecutableCacheForTests();
    return await callback();
  } finally {
    if (originalExecutable === undefined) delete process.env.AGY_EXECUTABLE;
    else process.env.AGY_EXECUTABLE = originalExecutable;
    resetAgyExecutableCacheForTests();
  }
}

test("agy resolver: bare fallback returns 'agy' when where.exe finds nothing", async () => {
  if (process.platform === "win32") return;
  await withEnv({}, async () => {
    const resolved = await resolveAgyExecutable({
      runCommandImpl: mockRunCommand(() => commandResult({ status: "failed", exitCode: 1, stdout: "" })),
    });
    assert.equal(resolved, "agy");
  });
});

test("agy resolver: AGY_EXECUTABLE env override is respected", async () => {
  // Use a bare name (no path separator) to avoid existence check in processValidation
  await withEnv({ AGY_EXECUTABLE: "agy-custom" }, async () => {
    let whereCalled = false;
    const resolved = await resolveAgyExecutable({
      runCommandImpl: mockRunCommand((spec) => {
        if (spec.executable === "where.exe") whereCalled = true;
        return commandResult({ stdout: "agy\n" });
      }),
    });

    assert.equal(resolved, "agy-custom");
    assert.equal(whereCalled, false);
  });
});

test("agy resolver: caches result after first call", async () => {
  await withEnv({}, async () => {
    let callCount = 0;
    const runner = mockRunCommand(() => {
      callCount++;
      return commandResult({ status: "failed", exitCode: 1 });
    });

    await resolveAgyExecutable({ runCommandImpl: runner });
    await resolveAgyExecutable();
    assert.equal(callCount, 1);
  });
});

test("agy resolver: configuredPath bypasses cache", async () => {
  // Use a bare name (no path separator) to avoid existence check in processValidation
  await withEnv({}, async () => {
    const first = await resolveAgyExecutable({
      runCommandImpl: mockRunCommand(() => commandResult({ status: "failed", exitCode: 1 })),
    });
    const second = await resolveAgyExecutable({ configuredPath: "agy-override" });
    assert.equal(first, "agy");
    assert.equal(second, "agy-override");
  });
});
