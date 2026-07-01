import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveLocalDevEntry, shouldClearTerminalOnLaunch } from "./run-local-dev.mjs";
import { createCodexaDevShim, SHIM_NAMES } from "./install-local-dev-bin.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptsDir);

test("resolveLocalDevEntry resolves interactive launches to the local repo src/index.tsx", () => {
  const resolved = resolveLocalDevEntry(repoRoot, []);
  assert.equal(resolved.isHeadlessMode, false);
  assert.equal(resolved.entry, join(repoRoot, "src", "index.tsx"));
  assert.deepEqual(resolved.entryArgs, []);
});

test("resolveLocalDevEntry forwards interactive prompt args to src/index.tsx", () => {
  const resolved = resolveLocalDevEntry(repoRoot, ["explain this repo", "--model", "x"]);
  assert.equal(resolved.entry, join(repoRoot, "src", "index.tsx"));
  assert.deepEqual(resolved.entryArgs, ["explain this repo", "--model", "x"]);
});

test("resolveLocalDevEntry resolves `exec` to the headless src/exec.ts", () => {
  const resolved = resolveLocalDevEntry(repoRoot, ["exec", "print the dir"]);
  assert.equal(resolved.isHeadlessMode, true);
  assert.equal(resolved.isHeadlessExec, true);
  assert.equal(resolved.entry, join(repoRoot, "src", "exec.ts"));
  assert.deepEqual(resolved.entryArgs, ["print the dir"]);
});

test("resolveLocalDevEntry resolves --headless-benchmark to src/exec.ts", () => {
  const resolved = resolveLocalDevEntry(repoRoot, ["--headless-benchmark", "x"]);
  assert.equal(resolved.isHeadlessMode, true);
  assert.equal(resolved.isHeadlessBenchmark, true);
  assert.equal(resolved.entry, join(repoRoot, "src", "exec.ts"));
});

test("shouldClearTerminalOnLaunch clears for a plain interactive TTY launch", () => {
  assert.equal(shouldClearTerminalOnLaunch(false, true), true);
});

test("shouldClearTerminalOnLaunch does not clear for headless (exec/benchmark) launches", () => {
  assert.equal(shouldClearTerminalOnLaunch(true, true), false);
});

test("shouldClearTerminalOnLaunch does not clear when stdout is not a TTY (piped/redirected)", () => {
  assert.equal(shouldClearTerminalOnLaunch(false, false), false);
  assert.equal(shouldClearTerminalOnLaunch(false, undefined), false);
});

test("createCodexaDevShim installs both codexa-dev and cxd pointing at the local launcher", () => {
  const binDir = mkdtempSync(join(tmpdir(), "codexa-dev-shim-"));
  try {
    const result = createCodexaDevShim({ binDir });
    const launcherPath = join(repoRoot, "scripts", "run-local-dev.mjs");

    assert.equal(result.launcherPath, launcherPath);
    assert.equal(result.shimPaths.length, SHIM_NAMES.length);
    assert.deepEqual([...SHIM_NAMES].sort(), ["codexa-dev", "cxd"]);

    for (const shimPath of result.shimPaths) {
      // Each shim exists and references the LOCAL run-local-dev.mjs launcher.
      assert.ok(statSync(shimPath).isFile(), `${shimPath} should be a file`);
      const contents = readFileSync(shimPath, "utf8");
      assert.ok(
        contents.includes(launcherPath),
        `${shimPath} should invoke the local launcher (${launcherPath})`,
      );
    }
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});
