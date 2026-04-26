import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("codex subprocess attaches output handlers before writing stdin", () => {
  const source = readFileSync(fileURLToPath(new URL("./codexSubprocess.ts", import.meta.url)), "utf8");
  const spawnIndex = source.indexOf("proc = spawnCodexProcess");
  const stdoutIndex = source.indexOf('proc.stdout?.on("data"', spawnIndex);
  const stderrIndex = source.indexOf('proc.stderr?.on("data"', spawnIndex);
  const closeIndex = source.indexOf('proc.on("close"', spawnIndex);
  const errorIndex = source.indexOf('proc.on("error"', spawnIndex);
  const stdinWriteIndex = source.indexOf("proc.stdin?.write", spawnIndex);

  assert.notEqual(spawnIndex, -1);
  assert.notEqual(stdoutIndex, -1);
  assert.notEqual(stderrIndex, -1);
  assert.notEqual(closeIndex, -1);
  assert.notEqual(errorIndex, -1);
  assert.notEqual(stdinWriteIndex, -1);
  assert.ok(stdoutIndex < stdinWriteIndex);
  assert.ok(stderrIndex < stdinWriteIndex);
  assert.ok(closeIndex < stdinWriteIndex);
  assert.ok(errorIndex < stdinWriteIndex);
});
