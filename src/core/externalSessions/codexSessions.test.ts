import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listCodexSessions, readCodexTranscript } from "./codexSessions.js";

const { Database } = require("bun:sqlite") as {
  Database: new (path: string) => { run: (sql: string, ...params: unknown[]) => unknown; close: () => void };
};

const workspace = "/work/app";

function codexHome(): string {
  return mkdtempSync(join(tmpdir(), "ubume-codex-sessions-"));
}

function writeRollout(home: string, name: string, records: object[], mtime = "2026-09-30T10:00:00.000Z"): string {
  const dir = join(home, "sessions", "2026", "09", "30");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  utimesSync(path, new Date(mtime), new Date(mtime));
  return path;
}

const meta = (id: string, cwd: string, source = "cli") => ({ timestamp: "2026-09-30T10:00:00.000Z", type: "session_meta", payload: { id, cwd, source, originator: "codex-tui", base_instructions: { text: "long instructions" } } });
const message = (role: string, text: string, timestamp = "2026-09-30T10:00:01.000Z") => ({ timestamp, type: "response_item", payload: { type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }] } });

function writeStateDb(home: string, rows: Array<Record<string, unknown>>): void {
  const database = new Database(join(home, "state_5.sqlite"));
  database.run(`CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, source TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, first_user_message TEXT NOT NULL DEFAULT '', model TEXT, name TEXT, updated_at_ms INTEGER)`);
  for (const row of rows) {
    database.run(
      "INSERT INTO threads (id, rollout_path, created_at, updated_at, source, cwd, title, archived, first_user_message, model, name, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      row.id, row.rollout_path ?? "", 0, Math.floor(Number(row.updated_at_ms) / 1000), row.source ?? "cli", row.cwd, row.title ?? "", row.archived ?? 0, row.first_user_message ?? "", row.model ?? null, row.name ?? null, row.updated_at_ms,
    );
  }
  database.close();
}

test("listCodexSessions reads the thread index, including exec runs while hiding archived and empty threads", async () => {
  const home = codexHome();
  writeStateDb(home, [
    { id: "t-named", cwd: workspace, title: "Fix the build", name: "Build fix", first_user_message: "Fix the build", model: "gpt-6.1", updated_at_ms: Date.parse("2026-09-30T12:00:00.000Z") },
    { id: "t-plain", cwd: workspace, title: "Explain\nthe   parser", first_user_message: "Explain the parser", updated_at_ms: Date.parse("2026-09-30T11:00:00.000Z") },
    { id: "t-exec", cwd: workspace, source: "exec", title: "Ubume run", first_user_message: "Ubume run", updated_at_ms: Date.parse("2026-09-30T13:00:00.000Z") },
    { id: "t-archived", cwd: workspace, archived: 1, title: "Old", first_user_message: "Old", updated_at_ms: Date.parse("2026-09-30T14:00:00.000Z") },
    { id: "t-empty", cwd: workspace, title: "", first_user_message: "", updated_at_ms: Date.parse("2026-09-30T15:00:00.000Z") },
    { id: "t-other", cwd: "/elsewhere", title: "Other", first_user_message: "Other", updated_at_ms: Date.parse("2026-09-30T16:00:00.000Z") },
  ]);

  const here = await listCodexSessions({ kind: "workspace", root: workspace }, { env: { CODEX_HOME: home } });
  assert.deepEqual(here.map((session) => [session.id, session.title, session.updatedAt]), [
    ["t-exec", "Ubume run", "2026-09-30T13:00:00.000Z"],
    ["t-named", "Build fix", "2026-09-30T12:00:00.000Z"],
    ["t-plain", "Explain the parser", "2026-09-30T11:00:00.000Z"],
  ]);
  assert.equal(here[1]?.model, "gpt-6.1");

  const all = await listCodexSessions({ kind: "all" }, { env: { CODEX_HOME: home } });
  assert.deepEqual(all.map((session) => session.id), ["t-other", "t-exec", "t-named", "t-plain"]);
});

test("listCodexSessions falls back to rollout files when the thread index is unusable", async () => {
  const home = codexHome();
  writeFileSync(join(home, "state_5.sqlite"), "not a database");
  writeRollout(home, "rollout-2026-09-30T10-00-00-aaa.jsonl", [
    meta("aaa", workspace),
    message("user", "<environment_context>\n  <cwd>/work/app</cwd>\n</environment_context>"),
    message("user", "Add a settings page"),
  ], "2026-09-30T10:00:00.000Z");
  writeRollout(home, "rollout-2026-09-30T11-00-00-bbb.jsonl", [meta("bbb", workspace), message("user", "Rename things")], "2026-09-30T11:00:00.000Z");
  writeRollout(home, "rollout-2026-09-30T12-00-00-exec.jsonl", [meta("exec", workspace, "exec"), message("user", "Ubume run")]);
  writeRollout(home, "rollout-2026-09-30T13-00-00-empty.jsonl", [meta("empty", workspace)]);
  writeFileSync(join(home, "session_index.jsonl"), `${JSON.stringify({ id: "bbb", thread_name: "Rename pass", updated_at: "2026-09-30T11:00:00Z" })}\n`);

  const sessions = await listCodexSessions({ kind: "workspace", root: workspace }, { env: { CODEX_HOME: home } });
  assert.deepEqual(sessions.map((session) => [session.id, session.title]), [["bbb", "Rename pass"], ["exec", "Ubume run"], ["aaa", "Add a settings page"]]);
});

test("listCodexSessions returns nothing without a Codex store", async () => {
  assert.deepEqual(await listCodexSessions({ kind: "all" }, { env: { CODEX_HOME: join(codexHome(), "missing") } }), []);
});

test("readCodexTranscript shows prompts, replies and tool calls with their output", async () => {
  const home = codexHome();
  const path = writeRollout(home, "rollout-2026-09-30T10-00-00-ccc.jsonl", [
    meta("ccc", workspace),
    message("developer", "system rules"),
    message("user", "<environment_context>ignored</environment_context>"),
    message("user", "# AGENTS.md instructions for /work/app\n\n<INSTRUCTIONS>rules</INSTRUCTIONS>"),
    message("user", "List files"),
    { timestamp: "2026-09-30T10:00:02.000Z", type: "response_item", payload: { type: "reasoning", summary: [] } },
    message("assistant", "Checking."),
    { timestamp: "2026-09-30T10:00:03.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "c1", arguments: JSON.stringify({ cmd: "ls" }) } },
    { timestamp: "2026-09-30T10:00:04.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "a.txt" } },
    { timestamp: "2026-09-30T10:00:05.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", call_id: "c2", input: "*** Begin Patch" } },
    { timestamp: "2026-09-30T10:00:06.000Z", type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c2", output: [{ type: "input_text", text: "Success" }] } },
    { timestamp: "2026-09-30T10:00:06.200Z", type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "c3", input: 'const r = await tools.exec_command({cmd:"git status --short", yield_time_ms: 1000});\ntext(r)' } },
    { timestamp: "2026-09-30T10:00:06.500Z", type: "event_msg", payload: { type: "agent_message", message: "duplicate" } },
    message("assistant", "One file.", "2026-09-30T10:00:07.000Z"),
  ]);

  const transcript = await readCodexTranscript({ source: "codex", id: "ccc", title: "t", cwd: workspace, updatedAt: "2026-09-30T10:00:00.000Z", filePath: path });
  assert.deepEqual(transcript.entries.map((entry) => [entry.kind, entry.title, entry.text]), [
    ["user", "You", "List files"],
    ["assistant", "Codex", "Checking."],
    ["tool", "exec_command · ls", "ls\n\na.txt"],
    ["tool", "apply_patch · *** Begin Patch", "*** Begin Patch\n\nSuccess"],
    ["tool", "exec · git status --short", 'const r = await tools.exec_command({cmd:"git status --short", yield_time_ms: 1000});\ntext(r)'],
    ["assistant", "Codex", "One file."],
  ]);
});
