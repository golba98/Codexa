import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexExecArgs } from "./codexExecArgs.js";
import type { CodexCliCapabilities } from "./codexCapabilities.js";

const fullCapabilities: CodexCliCapabilities = {
  askForApproval: true,
  sandbox: true,
  config: true,
  fullAuto: true,
};

test("uses dedicated runtime policy flags when supported", () => {
  const result = buildCodexExecArgs({
    model: "gpt-5.4",
    cwd: "C:/repo",
    runtimePolicy: {
      approvalPolicy: "untrusted",
      sandboxMode: "read-only",
    },
  }, fullCapabilities);

  assert.deepEqual(result, {
    ok: true,
    strategy: "direct-flags",
    args: [
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
  });
});

test("falls back to config overrides when dedicated policy flags are unavailable", () => {
  const result = buildCodexExecArgs({
    model: "gpt-5.4-mini",
    cwd: "C:/repo",
    runtimePolicy: {
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
    },
    reasoningLevel: "medium",
  }, {
    askForApproval: false,
    sandbox: false,
    config: true,
    fullAuto: false,
  });

  assert.deepEqual(result, {
    ok: true,
    strategy: "config-overrides",
    args: [
      "exec",
      "--experimental-json",
      "--skip-git-repo-check",
      "--cd",
      "C:/repo",
      "--model",
      "gpt-5.4-mini",
      "--config",
      "reasoning.effort=medium",
      "-c",
      "approval_policy=on-request",
      "-c",
      "sandbox_mode=workspace-write",
      "-",
    ],
  });
});

test("uses full-auto shortcut only for never plus danger-full-access", () => {
  const result = buildCodexExecArgs({
    model: "gpt-5.4",
    cwd: "C:/repo",
    runtimePolicy: {
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
    },
    structuredOutput: false,
  }, {
    askForApproval: false,
    sandbox: false,
    config: false,
    fullAuto: true,
  });

  assert.deepEqual(result, {
    ok: true,
    strategy: "full-auto",
    args: [
      "exec",
      "--skip-git-repo-check",
      "--cd",
      "C:/repo",
      "--model",
      "gpt-5.4",
      "--full-auto",
      "-",
    ],
  });
});

test("fails clearly when the requested policy cannot be represented safely", () => {
  const result = buildCodexExecArgs({
    model: "gpt-5.4",
    cwd: "C:/repo",
    runtimePolicy: {
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
    },
  }, {
    askForApproval: false,
    sandbox: false,
    config: false,
    fullAuto: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.strategy, "fail");
  assert.match(result.ok ? "" : result.error, /cannot safely apply the requested runtime policy/i);
  assert.match(result.ok ? "" : result.error, /workspace write sandbox/i);
});

test("uses mixed config and direct flags when only approval direct flag is unavailable", () => {
  const result = buildCodexExecArgs({
    model: "gpt-5.4",
    cwd: "C:/repo",
    runtimePolicy: {
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
    },
    reasoningLevel: "medium",
  }, {
    askForApproval: false,
    sandbox: true,
    config: true,
    fullAuto: true,
  });

  assert.deepEqual(result, {
    ok: true,
    strategy: "config-overrides",
    args: [
      "exec",
      "--experimental-json",
      "--skip-git-repo-check",
      "--cd",
      "C:/repo",
      "--model",
      "gpt-5.4",
      "--config",
      "reasoning.effort=medium",
      "-c",
      "approval_policy=on-request",
      "--sandbox",
      "workspace-write",
      "-",
    ],
  });
});
