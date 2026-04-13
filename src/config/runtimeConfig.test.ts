import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RUNTIME_CONFIG,
  addWritableRoot,
  buildCodexConfigOverrides,
  buildCodexExecArgs,
  formatRuntimeStatus,
  normalizeRuntimeConfig,
  removeWritableRoot,
  resolveRuntimeConfig,
} from "./runtimeConfig.js";

test("defaults resolve into a concrete runtime config", () => {
  const resolved = resolveRuntimeConfig(DEFAULT_RUNTIME_CONFIG);

  assert.equal(resolved.model, DEFAULT_RUNTIME_CONFIG.model);
  assert.equal(resolved.mode, DEFAULT_RUNTIME_CONFIG.mode);
  assert.equal(resolved.policy.approvalPolicy, "on-request");
  assert.equal(resolved.policy.sandboxMode, "workspace-write");
  assert.equal(resolved.policy.networkAccess, false);
  assert.equal(resolved.policy.serviceTier, "flex");
  assert.equal(resolved.policy.personality, "none");
});

test("mode inheritance resolves to expected approval and sandbox policies", () => {
  const suggest = resolveRuntimeConfig(normalizeRuntimeConfig({ mode: "suggest" }));
  const autoEdit = resolveRuntimeConfig(normalizeRuntimeConfig({ mode: "auto-edit" }));
  const fullAuto = resolveRuntimeConfig(normalizeRuntimeConfig({ mode: "full-auto" }));

  assert.equal(suggest.policy.sandboxMode, "read-only");
  assert.equal(suggest.policy.approvalPolicy, "on-request");
  assert.equal(autoEdit.policy.sandboxMode, "workspace-write");
  assert.equal(fullAuto.policy.sandboxMode, "workspace-write");
});

test("explicit policy overrides beat inherited mode defaults", () => {
  const resolved = resolveRuntimeConfig(normalizeRuntimeConfig({
    mode: "suggest",
    policy: {
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
      networkAccess: "enabled",
    },
  }));

  assert.equal(resolved.policy.approvalPolicy, "never");
  assert.equal(resolved.policy.sandboxMode, "danger-full-access");
  assert.equal(resolved.policy.networkAccess, true);
});

test("writable roots normalize and dedupe", () => {
  const withRoots = addWritableRoot(addWritableRoot(DEFAULT_RUNTIME_CONFIG, "C:/Repo"), "C:\\Repo\\");
  assert.equal(withRoots.policy.writableRoots.length, 1);

  const removed = removeWritableRoot(withRoots, "c:/repo");
  assert.equal(removed.policy.writableRoots.length, 0);
});

test("writable root normalization strips redundant trailing separators", () => {
  const normalized = normalizeRuntimeConfig({
    policy: {
      writableRoots: ["C:\\Repo\\", "C:\\Repo", "C:\\Repo\\\\nested\\..\\"],
    },
  });

  assert.deepEqual(normalized.policy.writableRoots, ["C:\\Repo"]);
});

test("builds deterministic codex config overrides and exec args", () => {
  const resolved = resolveRuntimeConfig(normalizeRuntimeConfig({
    model: "gpt-5.4-mini",
    mode: "suggest",
    reasoningLevel: "medium",
    policy: {
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      networkAccess: "enabled",
      writableRoots: ["C:/Repo/extra"],
      serviceTier: "fast",
      personality: "pragmatic",
    },
  }));

  assert.deepEqual(buildCodexConfigOverrides(resolved), [
    "reasoning.effort=medium",
    "approval_policy=never",
    "sandbox_workspace_write.network_access=true",
    "sandbox_workspace_write.writable_roots=[\"C:/Repo/extra\"]",
    "service_tier=fast",
    "personality=pragmatic",
  ]);

  assert.deepEqual(buildCodexExecArgs(resolved, "C:/repo"), [
    "exec",
    "--experimental-json",
    "--skip-git-repo-check",
    "--cd",
    "C:/repo",
    "--model",
    "gpt-5.4-mini",
    "--sandbox",
    "workspace-write",
    "--config",
    "reasoning.effort=medium",
    "--config",
    "approval_policy=never",
    "--config",
    "sandbox_workspace_write.network_access=true",
    "--config",
    "sandbox_workspace_write.writable_roots=[\"C:/Repo/extra\"]",
    "--config",
    "service_tier=fast",
    "--config",
    "personality=pragmatic",
    "-",
  ]);
});

test("formats runtime status with effective policy details", () => {
  const resolved = resolveRuntimeConfig(DEFAULT_RUNTIME_CONFIG);
  const status = formatRuntimeStatus(resolved, {
    workspaceRoot: "C:\\Workspace",
    tokensUsed: 512,
  });

  assert.match(status, /Provider:/);
  assert.match(status, /Approval policy:/);
  assert.match(status, /Sandbox mode:/);
  assert.match(status, /Tokens used: ~512/);
});
