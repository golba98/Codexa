import assert from "node:assert/strict";
import test from "node:test";
import { parseHeadlessExecArgs } from "./execArgs.js";

test("parses codexa exec positional prompt", () => {
  const parsed = parseHeadlessExecArgs(["Print", "the", "directory"]);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.prompt, "Print the directory");
  assert.equal(parsed.value.launchArgs.initialPrompt, "Print the directory");
});

test("parses codexa exec --prompt value", () => {
  const parsed = parseHeadlessExecArgs(["--prompt", "Print the directory"]);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.prompt, "Print the directory");
});

test("parses codexa exec --prompt=value", () => {
  const parsed = parseHeadlessExecArgs(["--prompt=Print the directory"]);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.prompt, "Print the directory");
});

test("rejects missing and empty prompts", () => {
  const missing = parseHeadlessExecArgs([]);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.match(missing.error, /missing prompt/i);
  }

  const empty = parseHeadlessExecArgs(["--prompt", "   "]);
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.match(empty.error, /--prompt/i);
  }
});

test("preserves profile and repeated config overrides", () => {
  const parsed = parseHeadlessExecArgs([
    "--profile",
    "bench",
    "-c",
    "model=\"gpt-5.4-mini\"",
    "--config",
    "sandbox_mode=\"workspace-write\"",
    "--config=approval_policy=\"never\"",
    "Print",
    "files",
  ]);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.prompt, "Print files");
  assert.equal(parsed.value.launchArgs.profile, "bench");
  assert.deepEqual(parsed.value.launchArgs.configOverrides, [
    "model=\"gpt-5.4-mini\"",
    "sandbox_mode=\"workspace-write\"",
    "approval_policy=\"never\"",
  ]);
  assert.deepEqual(parsed.value.launchArgs.passthroughArgs, [
    "--profile",
    "bench",
    "-c",
    "model=\"gpt-5.4-mini\"",
    "--config",
    "sandbox_mode=\"workspace-write\"",
    "--config=approval_policy=\"never\"",
  ]);
});
