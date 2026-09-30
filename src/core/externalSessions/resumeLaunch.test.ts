import assert from "node:assert/strict";
import test from "node:test";
import { buildExternalResumeLaunch } from "./resumeLaunch.js";
import type { ExternalSessionSummary } from "./types.js";

const summary = (source: ExternalSessionSummary["source"], cwd: string | null): ExternalSessionSummary => ({ source, id: "abc-123", title: "Title", cwd, updatedAt: "2026-09-30T10:00:00.000Z" });
const options = { fallbackCwd: "/current", resolveExecutable: async (source: string) => `/bin/${source}-cli`, folderExists: (path: string) => path !== "/gone" };

test("buildExternalResumeLaunch resumes each CLI by session id in the session's folder", async () => {
  assert.deepEqual(await buildExternalResumeLaunch(summary("claude", "/work"), options), { ok: true, launch: { displayName: "Claude Code", executable: "/bin/claude-cli", args: ["--resume", "abc-123"], cwd: "/work" } });
  assert.deepEqual(await buildExternalResumeLaunch(summary("codex", "/work"), options), { ok: true, launch: { displayName: "Codex", executable: "/bin/codex-cli", args: ["resume", "abc-123"], cwd: "/work" } });
  assert.deepEqual(await buildExternalResumeLaunch(summary("antigravity", null), options), { ok: true, launch: { displayName: "Antigravity", executable: "/bin/antigravity-cli", args: ["--conversation", "abc-123"], cwd: "/current" } });
});

test("buildExternalResumeLaunch refuses when the session folder is gone or unknown for Claude Code", async () => {
  const gone = await buildExternalResumeLaunch(summary("codex", "/gone"), options);
  assert.equal(gone.ok, false);
  assert.match(gone.ok ? "" : gone.message, /no longer exists: \/gone/);
  const unknown = await buildExternalResumeLaunch(summary("claude", null), options);
  assert.equal(unknown.ok, false);
  assert.match(unknown.ok ? "" : unknown.message, /original folder/);
});
