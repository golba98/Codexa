import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MODE,
  buildCodexExecArgs,
  formatModeLabel,
  formatRuntimePolicySummary,
  getLegacyRuntimePolicyForMode,
  getNextMode,
  normalizeReasoningForModel,
} from "./settings.js";

test("builds suggest exec args with explicit untrusted read-only policy", () => {
  assert.deepEqual(
    buildCodexExecArgs("gpt-5.4", "C:/repo", {
      approvalPolicy: "untrusted",
      sandboxMode: "read-only",
    }),
    [
      "exec",
      "--experimental-json",
      "--skip-git-repo-check",
      "--cd",
      "C:/repo",
      "--model",
      "gpt-5.4",
      "--ask-for-approval",
      "untrusted",
      "--sandbox",
      "read-only",
      "-",
    ],
  );
});

test("passes reasoning effort through codex exec args", () => {
  assert.deepEqual(
    buildCodexExecArgs(
      "gpt-5.4-mini",
      "C:/repo",
      { approvalPolicy: "untrusted", sandboxMode: "read-only" },
      "medium",
    ),
    [
      "exec",
      "--experimental-json",
      "--skip-git-repo-check",
      "--cd",
      "C:/repo",
      "--model",
      "gpt-5.4-mini",
      "--config",
      "reasoning.effort=medium",
      "--ask-for-approval",
      "untrusted",
      "--sandbox",
      "read-only",
      "-",
    ],
  );
});

test("builds workspace-write exec args with on-request approval", () => {
  assert.deepEqual(
    buildCodexExecArgs("gpt-5.4", "C:/repo", {
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
    }),
    [
      "exec",
      "--experimental-json",
      "--skip-git-repo-check",
      "--cd",
      "C:/repo",
      "--model",
      "gpt-5.4",
      "--ask-for-approval",
      "on-request",
      "--sandbox",
      "workspace-write",
      "-",
    ],
  );
});

test("builds danger-full-access exec args with never approval", () => {
  assert.deepEqual(
    buildCodexExecArgs("gpt-5.4", "C:/repo", {
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
    }),
    [
      "exec",
      "--experimental-json",
      "--skip-git-repo-check",
      "--cd",
      "C:/repo",
      "--model",
      "gpt-5.4",
      "--ask-for-approval",
      "never",
      "--sandbox",
      "danger-full-access",
      "-",
    ],
  );
});

test("returns legacy runtime policies for existing modes", () => {
  assert.deepEqual(getLegacyRuntimePolicyForMode("suggest"), {
    approvalPolicy: "untrusted",
    sandboxMode: "read-only",
  });
  assert.deepEqual(getLegacyRuntimePolicyForMode("auto-edit"), {
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
  });
  assert.deepEqual(getLegacyRuntimePolicyForMode("full-auto"), {
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
  });
});

test("formats runtime policy summaries for status output", () => {
  assert.equal(
    formatRuntimePolicySummary({
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
    }),
    "On request approval · Workspace write sandbox",
  );
});

test("keeps supported reasoning levels for gpt-5.4-mini", () => {
  assert.equal(normalizeReasoningForModel("gpt-5.4-mini", "high"), "high");
});

test("keeps reasoning unchanged for non-mini models", () => {
  assert.equal(normalizeReasoningForModel("gpt-5.4", "low"), "low");
});

test("can build legacy transcript exec args without structured output", () => {
  assert.deepEqual(
    buildCodexExecArgs(
      "gpt-5.4",
      "C:/repo",
      { approvalPolicy: "untrusted", sandboxMode: "read-only" },
      undefined,
      false,
    ),
    [
      "exec",
      "--skip-git-repo-check",
      "--cd",
      "C:/repo",
      "--model",
      "gpt-5.4",
      "--ask-for-approval",
      "untrusted",
      "--sandbox",
      "read-only",
      "-",
    ],
  );
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
