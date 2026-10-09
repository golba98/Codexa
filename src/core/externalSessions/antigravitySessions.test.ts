import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { listAntigravitySessions, readAntigravityTranscript } from "./antigravitySessions.js";

const { Database } = require("bun:sqlite") as {
  Database: new (
    path: string,
  ) => { run: (sql: string, ...params: unknown[]) => unknown; close: () => void };
};

const workspace = "/work/my app";

function agyHome(): { home: string; root: string } {
  const home = mkdtempSync(join(tmpdir(), "ubume-agy-sessions-"));
  const root = join(home, ".gemini", "antigravity-cli");
  mkdirSync(join(root, "conversations"), { recursive: true });
  return { home, root };
}

function varint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return bytes;
}
function field(fieldNumber: number, payload: number[] | string): number[] {
  const bytes = typeof payload === "string" ? [...new TextEncoder().encode(payload)] : payload;
  return [...varint((fieldNumber << 3) | 2), ...varint(bytes.length), ...bytes];
}
function message(...strings: Array<string | number[]>): Uint8Array {
  return new Uint8Array(strings.flatMap((value, index) => field(index + 1, value)));
}

const uuid = "3bbf88f9-ca08-4a09-ae3f-178193e8c5e3";

function writeSummaries(root: string, rows: Array<Record<string, unknown>>): void {
  const database = new Database(join(root, "conversation_summaries.db"));
  database.run(
    "CREATE TABLE conversation_summaries (conversation_id text, title text NOT NULL DEFAULT '', preview text NOT NULL DEFAULT '', step_count integer NOT NULL DEFAULT 0, last_modified_time datetime NOT NULL, workspace_uris text NOT NULL, nesting_depth integer NOT NULL DEFAULT 0, killed numeric NOT NULL DEFAULT false, PRIMARY KEY (conversation_id))",
  );
  for (const row of rows) {
    database.run(
      "INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      row.id,
      row.title ?? "",
      row.preview ?? "",
      row.steps ?? 3,
      row.time,
      JSON.stringify((row.folders as string[]).map((folder) => pathToFileURL(folder).href)),
      row.depth ?? 0,
      row.killed ?? 0,
    );
  }
  database.close();
}

function writeSteps(root: string, id: string, steps: Array<[number, Uint8Array]>): void {
  const database = new Database(join(root, "conversations", `${id}.db`));
  database.run(
    "CREATE TABLE steps (idx integer, step_type integer NOT NULL DEFAULT 0, status integer NOT NULL DEFAULT 0, step_payload blob, PRIMARY KEY (idx))",
  );
  steps.forEach(([type, payload], index) =>
    database.run(
      "INSERT INTO steps (idx, step_type, step_payload) VALUES (?, ?, ?)",
      index,
      type,
      payload,
    ),
  );
  database.close();
}

test("listAntigravitySessions reads conversation summaries for this folder", async () => {
  const { home, root } = agyHome();
  writeSummaries(root, [
    {
      id: "a1",
      title: "Model identity",
      time: "2026-09-30 02:59:07.896083311+00:00",
      folders: [workspace],
    },
    {
      id: "a2",
      title: "",
      preview: "Preview title",
      time: "2026-09-30 04:00:00.5+00:00",
      folders: ["/other", workspace],
    },
    { id: "a3", title: "Elsewhere", time: "2026-09-30 05:00:00+00:00", folders: ["/other"] },
    {
      id: "empty",
      title: "Nothing",
      steps: 0,
      time: "2026-09-30 06:00:00+00:00",
      folders: [workspace],
    },
    {
      id: "sub",
      title: "Subagent",
      depth: 1,
      time: "2026-09-30 06:00:00+00:00",
      folders: [workspace],
    },
    {
      id: "killed",
      title: "Killed",
      killed: 1,
      time: "2026-09-30 06:00:00+00:00",
      folders: [workspace],
    },
  ]);

  const here = await listAntigravitySessions(
    { kind: "workspace", root: workspace },
    { home, env: {} },
  );
  assert.deepEqual(
    here.map((session) => [session.id, session.title, session.cwd, session.updatedAt]),
    [
      ["a2", "Preview title", workspace, "2026-09-30T04:00:00.500Z"],
      ["a1", "Model identity", workspace, "2026-09-30T02:59:07.896Z"],
    ],
  );
  const all = await listAntigravitySessions({ kind: "all" }, { home, env: {} });
  assert.deepEqual(
    all.map((session) => [session.id, session.cwd]),
    [
      ["a3", "/other"],
      ["a2", "/other"],
      ["a1", workspace],
    ],
  );
});

test("listAntigravitySessions returns nothing without an Antigravity store", async () => {
  assert.deepEqual(
    await listAntigravitySessions(
      { kind: "all" },
      { home: mkdtempSync(join(tmpdir(), "ubume-agy-none-")), env: {} },
    ),
    [],
  );
});

test("readAntigravityTranscript extracts prompts, replies and tool calls from step payloads", async () => {
  const { home, root } = agyHome();
  writeSteps(root, "a1", [
    [
      14,
      message(
        uuid,
        `\n$${uuid}"$${uuid}`,
        "hello there",
        "hello there",
        "command(*)",
        "command_assessor",
        "command_assessor",
      ),
    ],
    // A planning step that only calls a tool has no reply text of its own.
    [
      15,
      message(
        "bot-d1cc57b2",
        "sessionID",
        "-3750763034362895579",
        uuid,
        "call_1170319",
        "run_command",
        '{"CommandLine":"ls"}',
      ),
    ],
    [
      132,
      message(
        "call_1170319",
        "run_command",
        '{"CommandLine":"ls","Cwd":"/work"}',
        uuid,
        "toolSummary",
        "List directory contents",
        "\nThe command exited with code 0.\nOutput:\na.txt",
        "type.googleapis.com/gemini_coder.Step",
      ),
    ],
    [101, message("internal bookkeeping", "internal bookkeeping")],
    [
      15,
      message(
        "bot-d1cc57b2",
        "sessionID",
        uuid,
        "I'm running on **GPT**.",
        "User asks which model; the reasoning is longer than the reply itself.",
        "I'm running on **GPT**.",
      ),
    ],
    // Slash commands store the typed text once and an expanded copy for the model.
    [
      14,
      message(
        uuid,
        "/plan Rename the project",
        "plan",
        "<PLAN>expanded instructions</PLAN>",
        " Rename the project",
        "command(*)",
      ),
    ],
  ]);
  const summary = {
    source: "antigravity" as const,
    id: "a1",
    title: "t",
    cwd: workspace,
    updatedAt: "2026-09-30T00:00:00.000Z",
  };

  const transcript = await readAntigravityTranscript(summary, { home, env: {} });
  assert.deepEqual(
    transcript.entries.map((entry) => [entry.kind, entry.title, entry.text]),
    [
      ["user", "You", "hello there"],
      [
        "tool",
        "run_command · List directory contents",
        "ls\n\nThe command exited with code 0.\nOutput:\na.txt",
      ],
      ["assistant", "Antigravity", "I'm running on **GPT**."],
      ["user", "You", "/plan Rename the project"],
    ],
  );
  assert.match(transcript.notice ?? "", /best-effort/);
});

test("readAntigravityTranscript falls back to prompt history for conversations without a step database", async () => {
  const { home, root } = agyHome();
  writeFileSync(join(root, "conversations", "old.pb"), "binary");
  writeFileSync(
    join(root, "history.jsonl"),
    [
      {
        display: "First prompt",
        timestamp: Date.parse("2026-09-30T10:00:00.000Z"),
        workspace,
        conversationId: "old",
      },
      {
        display: "/btw hello",
        timestamp: Date.parse("2026-09-30T10:01:00.000Z"),
        workspace,
        conversationId: "old",
        type: "slash_command",
      },
      {
        display: "Other conversation",
        timestamp: Date.parse("2026-09-30T10:02:00.000Z"),
        workspace,
        conversationId: "other",
      },
      {
        display: "Second prompt",
        timestamp: Date.parse("2026-09-30T10:03:00.000Z"),
        workspace,
        conversationId: "old",
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n"),
  );

  const transcript = await readAntigravityTranscript(
    {
      source: "antigravity",
      id: "old",
      title: "t",
      cwd: workspace,
      updatedAt: "2026-09-30T00:00:00.000Z",
    },
    { home, env: {} },
  );
  assert.deepEqual(
    transcript.entries.map((entry) => [entry.kind, entry.text, entry.timestamp]),
    [
      ["user", "First prompt", "2026-09-30T10:00:00.000Z"],
      ["user", "Second prompt", "2026-09-30T10:03:00.000Z"],
    ],
  );
  assert.match(transcript.notice ?? "", /prompts only/i);
});
