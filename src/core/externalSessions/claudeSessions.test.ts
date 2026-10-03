import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  encodeClaudeProjectDir,
  listClaudeSessions,
  readClaudeTranscript,
} from "./claudeSessions.js";

const workspace = "/work/my app";

function fixtureHome(): string {
  return mkdtempSync(join(tmpdir(), "ubume-claude-sessions-"));
}

function writeSession(
  home: string,
  cwd: string,
  id: string,
  records: object[],
  mtime: string,
): string {
  const dir = join(home, ".claude", "projects", encodeClaudeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  const time = new Date(mtime);
  utimesSync(path, time, time);
  return path;
}

const user = (cwd: string, id: string, content: unknown, extra: object = {}) => ({
  type: "user",
  cwd,
  sessionId: id,
  entrypoint: "cli",
  timestamp: "2026-09-30T10:00:00.000Z",
  message: { role: "user", content },
  ...extra,
});
const assistant = (id: string, content: unknown[]) => ({
  type: "assistant",
  sessionId: id,
  timestamp: "2026-09-30T10:00:05.000Z",
  message: { role: "assistant", model: "claude-opus-5-5", content },
});

test("encodeClaudeProjectDir matches Claude Code's project folder naming", () => {
  assert.equal(
    encodeClaudeProjectDir("/home/k9-vortex/Development/2-TypeScript/8-Ubume CLI"),
    "-home-k9-vortex-Development-2-TypeScript-8-Ubume-CLI",
  );
});

test("listClaudeSessions lists this folder's sessions with the best available title", async () => {
  const home = fixtureHome();
  writeSession(
    home,
    workspace,
    "aaa",
    [
      user(workspace, "aaa", "<local-command-caveat>ignored</local-command-caveat>", {
        isMeta: true,
      }),
      user(workspace, "aaa", "Fix the flaky resume test please"),
      assistant("aaa", [{ type: "text", text: "Looking." }]),
      { type: "ai-title", aiTitle: "Fix flaky resume test", sessionId: "aaa" },
    ],
    "2026-09-30T10:00:00.000Z",
  );
  writeSession(
    home,
    workspace,
    "bbb",
    [
      user(workspace, "bbb", [{ type: "text", text: "Rename the package" }]),
      { type: "ai-title", aiTitle: "Rename package", sessionId: "bbb" },
      { type: "custom-title", customTitle: "My rename", sessionId: "bbb" },
    ],
    "2026-09-30T12:00:00.000Z",
  );
  writeSession(
    home,
    workspace,
    "meta-only",
    [user(workspace, "meta-only", "<command-name>/clear</command-name>")],
    "2026-09-30T13:00:00.000Z",
  );
  writeSession(
    home,
    workspace,
    "print-run",
    [user(workspace, "print-run", "Ubume headless prompt", { entrypoint: "sdk-cli" })],
    "2026-09-30T14:00:00.000Z",
  );
  writeSession(
    home,
    "/elsewhere",
    "ccc",
    [user("/elsewhere", "ccc", "Other project")],
    "2026-09-30T15:00:00.000Z",
  );

  const sessions = await listClaudeSessions(
    { kind: "workspace", root: workspace },
    { home, env: {} },
  );
  assert.deepEqual(
    sessions.map((session) => [session.id, session.title]),
    [
      ["print-run", "Ubume headless prompt"],
      ["bbb", "My rename"],
      ["aaa", "Fix flaky resume test"],
    ],
  );
  assert.equal(sessions[2]?.model, "claude-opus-5-5");
  assert.equal(sessions[2]?.cwd, workspace);
  assert.equal(sessions[2]?.updatedAt, "2026-09-30T10:00:00.000Z");
});

test("listClaudeSessions all-projects scope spans folders and honors CLAUDE_CONFIG_DIR", async () => {
  const home = fixtureHome();
  const configHome = join(home, "custom");
  writeSession(
    home,
    workspace,
    "default-dir",
    [user(workspace, "default-dir", "Should not be read")],
    "2026-09-30T10:00:00.000Z",
  );
  const customDir = join(configHome, "projects", encodeClaudeProjectDir("/elsewhere"));
  mkdirSync(customDir, { recursive: true });
  writeFileSync(
    join(customDir, "ccc.jsonl"),
    `${JSON.stringify(user("/elsewhere", "ccc", "Other project"))}\n`,
  );
  mkdirSync(join(customDir, "memory"));

  const sessions = await listClaudeSessions(
    { kind: "all" },
    { home, env: { CLAUDE_CONFIG_DIR: configHome } },
  );
  assert.deepEqual(
    sessions.map((session) => [session.id, session.title, session.cwd]),
    [["ccc", "Other project", "/elsewhere"]],
  );
});

test("listClaudeSessions returns nothing when Claude Code has no store", async () => {
  assert.deepEqual(await listClaudeSessions({ kind: "all" }, { home: fixtureHome(), env: {} }), []);
});

test("readClaudeTranscript pairs tool calls with results and skips injected context", async () => {
  const home = fixtureHome();
  const path = writeSession(
    home,
    workspace,
    "ddd",
    [
      user(
        workspace,
        "ddd",
        "<command-name>/model</command-name>\n<command-message>model</command-message>",
      ),
      user(workspace, "ddd", "<local-command-stdout>Set model</local-command-stdout>"),
      user(workspace, "ddd", [
        { type: "text", text: "<system-reminder>injected</system-reminder>" },
        { type: "text", text: "List the files" },
      ]),
      assistant("ddd", [
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "Sure." },
      ]),
      assistant("ddd", [
        {
          type: "tool_use",
          id: "tool-1",
          name: "Bash",
          input: { command: "ls -la", description: "List files" },
        },
      ]),
      user(workspace, "ddd", [
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: [{ type: "text", text: "a.txt\nb.txt" }],
        },
      ]),
      { ...assistant("ddd", [{ type: "text", text: "side work" }]), isSidechain: true },
      assistant("ddd", [{ type: "text", text: "Two files." }]),
      assistant("ddd", [{ type: "text", text: "Done." }]),
      assistant("ddd", [
        {
          type: "tool_use",
          id: "tool-2",
          name: "Skill",
          input: { skill: "superpowers:brainstorming", args: 3 },
        },
      ]),
    ],
    "2026-09-30T10:00:00.000Z",
  );

  const transcript = await readClaudeTranscript({
    source: "claude",
    id: "ddd",
    title: "t",
    cwd: workspace,
    updatedAt: "2026-09-30T10:00:00.000Z",
    filePath: path,
  });
  assert.deepEqual(
    transcript.entries.map((entry) => [entry.kind, entry.title, entry.text]),
    [
      ["note", "Command", "/model"],
      ["user", "You", "List the files"],
      ["assistant", "Claude", "Sure."],
      ["tool", "Bash · List files", "ls -la\n\na.txt\nb.txt"],
      ["assistant", "Claude", "Two files.\n\nDone."],
      [
        "tool",
        "Skill · superpowers:brainstorming",
        '{\n  "skill": "superpowers:brainstorming",\n  "args": 3\n}',
      ],
    ],
  );
  assert.equal(transcript.entries[1]?.timestamp, "2026-09-30T10:00:00.000Z");
});
