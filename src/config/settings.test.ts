import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MODE,
  buildCodexExecArgs,
  formatModeLabel,
  getNextMode,
  normalizeReasoningForModel,
} from "./settings.js";

test("builds suggest exec args with read-only sandbox", () => {
  assert.deepEqual(buildCodexExecArgs("gpt-5.4", "suggest", "C:/repo"), [
    "exec",
    "--experimental-json",
    "--skip-git-repo-check",
    "--cd",
    "C:/repo",
    "--model",
    "gpt-5.4",
    "--sandbox",
    "read-only",
    "-",
  ]);
});

test("passes reasoning effort through codex exec args", () => {
  assert.deepEqual(buildCodexExecArgs("gpt-5.4-mini", "suggest", "C:/repo", "medium"), [
    "exec",
    "--experimental-json",
    "--skip-git-repo-check",
    "--cd",
    "C:/repo",
    "--model",
    "gpt-5.4-mini",
    "--config",
    "reasoning.effort=medium",
    "--sandbox",
    "read-only",
    "-",
  ]);
});

test("builds auto-edit exec args with workspace-write sandbox", () => {
  assert.deepEqual(buildCodexExecArgs("gpt-5.4", "auto-edit", "C:/repo"), [
    "exec",
    "--experimental-json",
    "--skip-git-repo-check",
    "--cd",
    "C:/repo",
    "--model",
    "gpt-5.4",
    "--sandbox",
    "workspace-write",
    "-",
  ]);
});

test("builds full-auto exec args with full-auto flag", () => {
  assert.deepEqual(buildCodexExecArgs("gpt-5.4", "full-auto", "C:/repo"), [
    "exec",
    "--experimental-json",
    "--skip-git-repo-check",
    "--cd",
    "C:/repo",
    "--model",
    "gpt-5.4",
    "--full-auto",
    "-",
  ]);
});

test("keeps supported reasoning levels for gpt-5.4-mini", () => {
  assert.equal(normalizeReasoningForModel("gpt-5.4-mini", "high"), "high");
});

test("keeps reasoning unchanged for non-mini models", () => {
  assert.equal(normalizeReasoningForModel("gpt-5.4", "low"), "low");
});

test("builds extra high exec args through codex exec args", () => {
  assert.deepEqual(buildCodexExecArgs("gpt-5.4", "suggest", "C:/repo", "xhigh"), [
    "exec",
    "--experimental-json",
    "--skip-git-repo-check",
    "--cd",
    "C:/repo",
    "--model",
    "gpt-5.4",
    "--config",
    "reasoning.effort=xhigh",
    "--sandbox",
    "read-only",
    "-",
  ]);
});

test("can build legacy transcript exec args without structured output", () => {
  assert.deepEqual(buildCodexExecArgs("gpt-5.4", "suggest", "C:/repo", undefined, false), [
    "exec",
    "--skip-git-repo-check",
    "--cd",
    "C:/repo",
    "--model",
    "gpt-5.4",
    "--sandbox",
    "read-only",
    "-",
  ]);
});

test("formats codex-style mode labels", () => {
  assert.equal(formatModeLabel("suggest"), "SUGGEST");
  assert.equal(formatModeLabel("auto-edit"), "AUTO-EDIT");
  assert.equal(formatModeLabel("full-auto"), "FULL AUTO");
});

test("cycles modes in the same order as Ctrl+Y", () => {
  assert.equal(getNextMode("suggest"), "auto-edit");
  assert.equal(getNextMode("auto-edit"), "full-auto");
  assert.equal(getNextMode("full-auto"), "suggest");
});

test("defaults to full-auto mode", () => {
  assert.equal(DEFAULT_MODE, "full-auto");
});
