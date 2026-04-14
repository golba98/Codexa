import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeConfig, normalizeRuntimeConfig } from "../config/runtimeConfig.js";
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
    runtime: resolveRuntimeConfig(normalizeRuntimeConfig({
      model: "gpt-5.4",
      policy: {
        approvalPolicy: "untrusted",
        sandboxMode: "read-only",
      },
    })),
    cwd: "C:/repo",
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
      "--config",
      "reasoning.effort=high",
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
    runtime: resolveRuntimeConfig(normalizeRuntimeConfig({
      model: "gpt-5.4-mini",
      reasoningLevel: "medium",
      policy: {
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
      },
    })),
    cwd: "C:/repo",
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

test("fails clearly when the requested policy cannot be represented safely", () => {
  const result = buildCodexExecArgs({
    runtime: resolveRuntimeConfig(normalizeRuntimeConfig({
      model: "gpt-5.4",
      policy: {
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
      },
    })),
    cwd: "C:/repo",
  }, {
    askForApproval: false,
    sandbox: false,
    config: false,
    fullAuto: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.strategy, "fail");
  assert.match(result.ok ? "" : result.error, /cannot safely apply the selected reasoning level/i);
  assert.match(result.ok ? "" : result.error, /does not support --config/i);
});

test("uses mixed config and direct flags when only approval direct flag is unavailable", () => {
  const result = buildCodexExecArgs({
    runtime: resolveRuntimeConfig(normalizeRuntimeConfig({
      model: "gpt-5.4",
      reasoningLevel: "medium",
      policy: {
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
      },
    })),
    cwd: "C:/repo",
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
