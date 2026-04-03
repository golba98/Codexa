import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkspaceRoot, resolveWorkspaceRoot } from "./workspaceRoot.js";

test("prefers CODEX_WORKSPACE_ROOT when provided", () => {
  const originalWorkspace = process.env.CODEX_WORKSPACE_ROOT;
  try {
    process.env.CODEX_WORKSPACE_ROOT = "D:/project/";
    assert.equal(resolveWorkspaceRoot(), normalizeWorkspaceRoot("D:/project/"));
  } finally {
    process.env.CODEX_WORKSPACE_ROOT = originalWorkspace;
  }
});

test("falls back to process.cwd when no workspace override exists", () => {
  const originalWorkspace = process.env.CODEX_WORKSPACE_ROOT;
  try {
    delete process.env.CODEX_WORKSPACE_ROOT;
    assert.equal(resolveWorkspaceRoot(), normalizeWorkspaceRoot(process.cwd()));
  } finally {
    process.env.CODEX_WORKSPACE_ROOT = originalWorkspace;
  }
});
