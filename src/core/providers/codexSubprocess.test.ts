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

test("codex subprocess supports raw prompt passthrough before wrapped prompt fallback", () => {
  const source = readFileSync(fileURLToPath(new URL("./codexSubprocess.ts", import.meta.url)), "utf8");

  assert.match(source, /const promptPolicy = options\.promptPolicy \?\? "wrapped"/);
  assert.match(source, /promptPolicy === "raw"\s+\?\s+prompt\s+:\s+buildCodexPrompt/s);
});

test("codex subprocess cleanup skips kill after process close", () => {
  const source = readFileSync(fileURLToPath(new URL("./codexSubprocess.ts", import.meta.url)), "utf8");
  const closeIndex = source.indexOf('proc.on("close"', source.indexOf("proc = spawnCodexProcess"));
  const exitedIndex = source.indexOf("procExited = true", closeIndex);
  const cleanupIndex = source.indexOf("return () =>", exitedIndex);
  const skipIndex = source.indexOf("!proc || procExited || proc.killed", cleanupIndex);
  const killIndex = source.indexOf("proc.kill()", cleanupIndex);

  assert.notEqual(closeIndex, -1);
  assert.notEqual(exitedIndex, -1);
  assert.notEqual(cleanupIndex, -1);
  assert.notEqual(skipIndex, -1);
  assert.notEqual(killIndex, -1);
  assert.ok(exitedIndex < cleanupIndex);
  assert.ok(skipIndex < killIndex);
});

test("codex subprocess reports lifecycle boundaries for terminal title reassertion", () => {
  const source = readFileSync(fileURLToPath(new URL("./codexSubprocess.ts", import.meta.url)), "utf8");
  const beforeSpawnIndex = source.indexOf('handlers.onProcessLifecycle?.("before-spawn")');
  const spawnIndex = source.indexOf("proc = spawnCodexProcess");
  const spawnedIndex = source.indexOf('handlers.onProcessLifecycle?.("spawned")', spawnIndex);
  const closeIndex = source.indexOf('proc.on("close"', spawnIndex);
  const exitIndex = source.indexOf('handlers.onProcessLifecycle?.("exit")', closeIndex);
  const errorIndex = source.indexOf('proc.on("error"', spawnIndex);
  const lifecycleErrorIndex = source.indexOf('handlers.onProcessLifecycle?.("error")', errorIndex);
  const cleanupIndex = source.indexOf("return () =>", spawnedIndex);
  const lifecycleCleanupIndex = source.indexOf('handlers.onProcessLifecycle?.("cleanup")', cleanupIndex);

  assert.ok(beforeSpawnIndex >= 0 && beforeSpawnIndex < spawnIndex);
  assert.ok(spawnedIndex > spawnIndex);
  assert.ok(exitIndex > closeIndex);
  assert.ok(lifecycleErrorIndex > errorIndex);
  assert.ok(lifecycleCleanupIndex > cleanupIndex);
});
