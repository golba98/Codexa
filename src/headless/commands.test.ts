import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runTerminalCommand } from "./commands.js";
import { redact } from "./diagnostics.js";
import { parseHeadlessExecArgs } from "./execArgs.js";

const launcher = fileURLToPath(new URL("../../bin/ubume.js", import.meta.url));
const provider = fileURLToPath(new URL("../test/fixtures/headlessProvider.mjs", import.meta.url));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ubume-cli-test-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const key = createHash("sha256").update(workspace).digest("hex").slice(0, 16);
  const chatRoot = join(root, "data/chats", key);
  const dataRoot = join(root, "data/workspaces", key);
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(join(workspace, "demo.ts"), "export const result = 0;\n");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    UBUME_DATA_DIR: join(root, "data"),
    CODEXA_DATA_DIR: join(root, "legacy"),
    CODEX_HOME: join(root, "codex"),
    UBUME_DEV_MODE: "0",
    CODEX_EXECUTABLE: provider,
    UBUME_TEST_PROMPT_LOG: join(root, "prompts.jsonl"),
    UBUME_TEST_PID_FILE: join(root, "pid"),
    UBUME_EXEC_TIMING: "0",
  };
  const run = (args: string[], input?: string) =>
    spawnSync("node", [launcher, ...args], {
      cwd: workspace,
      env,
      encoding: "utf8",
      input,
      timeout: 20000,
    });
  return {
    root,
    workspace,
    dataRoot,
    chatRoot,
    env,
    run,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
function tree(path: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!existsSync(path)) return files;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else files[file] = readFileSync(file).toString("base64");
    }
  };
  walk(path);
  return files;
}
test("new exec options parse after the prompt and prompt sources conflict clearly", () => {
  const parsed = parseHeadlessExecArgs([
    "hello",
    "--json",
    "--file",
    "demo.ts",
    "--provider",
    "anthropic",
  ]);
  assert(parsed.ok);
  assert.equal(parsed.value.json, true);
  assert.deepEqual(parsed.value.files, ["demo.ts"]);
  assert.equal(parseHeadlessExecArgs(["--stdin", "hello"]).ok, false);
  assert.equal(parseHeadlessExecArgs(["--resume", "chat_example", "--no-save", "hello"]).ok, false);
});
test("diagnostic redaction removes key fields, URL credentials, and known secret values", () => {
  const result = JSON.stringify(
    redact(
      {
        apiKey: "example-secret",
        message: "example-secret",
        endpoint: "https://user:password@host/v1?token=hidden",
      },
      ["example-secret"],
    ),
  );
  assert.doesNotMatch(result, /example-secret|user:password|hidden/);
});
test("all inspection commands work without TTY and leave disk unchanged", () => {
  const f = fixture();
  try {
    const before = tree(f.root);
    for (const command of [
      ["status"],
      ["config"],
      ["providers"],
      ["models"],
      ["sessions", "list"],
      ["doctor"],
    ]) {
      const result = f.run([...command, "--json"]);
      assert.equal(result.status, 0, `${command}: ${result.stderr}`);
      const value = JSON.parse(result.stdout);
      assert.equal(value.schemaVersion, 1);
      assert.equal(value.ok, true);
      assert.doesNotMatch(result.stdout, /\x1b/);
    }
    assert.deepEqual(tree(f.root), before);
    const probe = f.run(["doctor", "--probe", "--json"]);
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(
      existsSync(join(f.root, "prompts.jsonl")),
      false,
      "doctor submitted an inference prompt",
    );
  } finally {
    f.close();
  }
});
test("exec saves, resumes across processes, exposes transcript/diff and preserves draft/queue", () => {
  const f = fixture();
  try {
    const first = f.run(["exec", "CHANGE_FILE", "--json", "--file", "demo.ts"]);
    assert.equal(first.status, 0, first.stderr);
    const result = JSON.parse(first.stdout);
    assert.equal(result.data.text, "fixture final answer");
    const id = result.data.sessionId as string;
    const snapshotPath = join(f.chatRoot, "conversations", id, "snapshot.json");
    const saved = JSON.parse(readFileSync(snapshotPath, "utf8"));
    saved.session.draft = "unsent draft";
    saved.session.cursor = 3;
    saved.session.queue = [
      {
        id: "queued",
        display: "queued draft",
        submitted: "queued draft",
        images: [],
        createdAt: 1,
      },
    ];
    writeFileSync(snapshotPath, JSON.stringify(saved));
    const before = tree(f.root);
    const transcript = f.run(["sessions", "transcript", id, "--json"]);
    assert.equal(transcript.status, 0);
    assert.match(transcript.stdout, /fixture output/);
    const diff = f.run(["sessions", "diff", id]);
    assert.equal(diff.status, 0, diff.stderr);
    assert.match(diff.stdout, /\+export const result = 1/);
    assert.deepEqual(tree(f.root), before);
    const resumed = f.run(["exec", "--resume", id, "continue", "--json"]);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).data.sessionId, id);
    const next = JSON.parse(readFileSync(snapshotPath, "utf8"));
    assert.equal(next.messages.length, 4);
    assert.equal(next.session.draft, "unsent draft");
    assert.equal(next.session.cursor, 3);
    assert.equal(next.session.queue[0].id, "queued");
    const prompts = readFileSync(join(f.root, "prompts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /Previous conversation:/);
    assert.match(prompts[1], /fixture final answer/);
    const transient = f.run(["exec", "--stdin", "--no-save", "--json"], "stdin instruction");
    assert.equal(transient.status, 0, transient.stderr);
    assert.equal(JSON.parse(transient.stdout).data.sessionId, null);
    assert.equal(readdirSync(join(f.chatRoot, "conversations")).length, 1);
    const legacy = spawnSync("node", [resolve(launcher, "../codexa.js"), "status", "--json"], {
      cwd: f.workspace,
      env: f.env,
      encoding: "utf8",
      timeout: 20000,
    });
    assert.equal(legacy.status, 0);
    assert.equal(JSON.parse(legacy.stdout).ok, true);
  } finally {
    f.close();
  }
});
test("JSON errors, explicit unavailable provider, cwd selection and help are predictable", () => {
  const f = fixture();
  try {
    for (const args of [
      ["exec", "--stdin", "also positional", "--json"],
      ["sessions", "show", "../bad", "--json"],
      ["status", "--probe", "--json"],
      ["status", "--cwd", join(f.root, "absent"), "--json"],
    ]) {
      const result = f.run(args);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(JSON.parse(result.stdout).ok, false);
    }
    const unavailable = f.run(["exec", "--provider", "google", "hello", "--json"]);
    assert.equal(unavailable.status, 3);
    assert.equal(JSON.parse(unavailable.stdout).ok, false);
    const cwd = f.run(["--cwd", "..", "status", "--json"]);
    assert.equal(cwd.status, 0);
    assert.equal(JSON.parse(cwd.stdout).data.workspace, f.root);
    const help = f.run(["exec", "--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--resume/);
    const empty = f.run(["exec", "--stdin", "--json"], "");
    assert.equal(empty.status, 2);
  } finally {
    f.close();
  }
});
test("interrupt through installed launcher stops provider and saves partial answer", async () => {
  const f = fixture();
  const child = spawn("node", [launcher, "exec", "WAIT_FOR_INTERRUPT", "--json"], {
    cwd: f.workspace,
    env: f.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const completed = new Promise<number | null>((resolve) => child.once("close", resolve));
  try {
    const deadline = Date.now() + 10000;
    while (!existsSync(join(f.root, "pid"))) {
      if (Date.now() > deadline) throw new Error(`Provider did not start: ${stderr}`);
      await new Promise((r) => setTimeout(r, 25));
    }
    const pid = Number(readFileSync(join(f.root, "pid"), "utf8"));
    child.kill("SIGINT");
    assert.equal(await completed, 130, stderr);
    const result = JSON.parse(stdout);
    assert.equal(result.error.code, "INTERRUPTED");
    assert.equal(result.data.text, "partial reply");
    const saved = JSON.parse(
      readFileSync(
        join(f.chatRoot, "conversations", result.data.sessionId, "snapshot.json"),
        "utf8",
      ),
    );
    assert.equal(
      saved.session.events.find((event: { type: string }) => event.type === "run").status,
      "canceled",
    );
    assert.match(saved.messages.at(-1).content, /partial reply/);
    assert.throws(() => process.kill(pid, 0));
    assert.equal(readdirSync(join(f.dataRoot, "locks")).length, 0);
  } finally {
    child.kill("SIGKILL");
    f.close();
  }
});

test("busy session/workspace refuse writes; dead local ownership can be reclaimed", () => {
  const f = fixture();
  try {
    const first = f.run(["exec", "hello", "--json"]);
    assert.equal(first.status, 0, first.stderr);
    const id = JSON.parse(first.stdout).data.sessionId;
    const snapshot = join(f.chatRoot, "conversations", id, "snapshot.json");
    const before = readFileSync(snapshot, "utf8");
    const locks = join(f.dataRoot, "locks");
    const owner = {
      pid: process.pid,
      host: hostname(),
      token: "owner",
      createdAt: new Date().toISOString(),
    };
    const sessionLock = join(locks, `${id}.lock`);
    mkdirSync(sessionLock);
    writeFileSync(join(sessionLock, "owner.json"), JSON.stringify(owner));
    const refused = f.run(["exec", "--resume", id, "more", "--json"]);
    assert.equal(refused.status, 3);
    assert.match(refused.stdout, /busy/);
    assert.equal(readFileSync(snapshot, "utf8"), before);
    rmSync(sessionLock, { recursive: true });
    const executionLock = join(locks, "execution.lock");
    mkdirSync(executionLock);
    writeFileSync(join(executionLock, "owner.json"), JSON.stringify(owner));
    const executionRefused = f.run(["exec", "hello", "--json"]);
    assert.equal(executionRefused.status, 3);
    const status = f.run(["status", "--json"]);
    assert.equal(status.status, 0);
    assert.equal(JSON.parse(status.stdout).data.execution.locked, true);
    const dead = spawnSync("node", ["-e", "process.exit(0)"]);
    assert(dead.pid);
    writeFileSync(join(executionLock, "owner.json"), JSON.stringify({ ...owner, pid: dead.pid }));
    const recovered = f.run(["exec", "--resume", id, "after crash", "--json"]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(readdirSync(locks).length, 0);
  } finally {
    f.close();
  }
});

test("headless execution honors workspace provider selection and saved routes", () => {
  const f = fixture();
  try {
    f.env.ANTHROPIC_API_KEY = "";
    const config = {
      activeRoute: { providerId: "anthropic", modelId: "sonnet", backendKind: "claude-code-auth" },
      providers: { anthropic: { claudeCommandPath: provider } },
    };
    writeFileSync(join(f.dataRoot, "providers.json"), JSON.stringify(config));
    const first = f.run(["exec", "first", "--json"]);
    assert.equal(first.status, 0, first.stderr);
    const result = JSON.parse(first.stdout);
    assert.equal(result.data.text, "anthropic fixture answer");
    writeFileSync(
      join(f.dataRoot, "providers.json"),
      JSON.stringify({
        ...config,
        activeRoute: { providerId: "openai", modelId: "gpt-5.4", backendKind: "codex-cli-auth" },
      }),
    );
    const resumed = f.run(["exec", "--resume", result.data.sessionId, "second", "--json"]);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).data.text, "anthropic fixture answer");
    const explicit = f.run(["exec", "--provider", "openai", "third", "--json"]);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(JSON.parse(explicit.stdout).data.text, "fixture final answer");
  } finally {
    f.close();
  }
});

test("pending restore journals are inspectable and block new execution", () => {
  const f = fixture();
  try {
    const directory = join(f.dataRoot, "checkpoints", "chat_interrupted");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "restore.json"), JSON.stringify({ version: 1, operations: [] }));
    const before = tree(f.root);
    const status = f.run(["status", "--json"]);
    assert.equal(status.status, 0);
    assert.deepEqual(JSON.parse(status.stdout).data.pendingRecoverySessions, ["chat_interrupted"]);
    assert.deepEqual(tree(f.root), before);
    const blocked = f.run(["exec", "hello", "--json"]);
    assert.equal(blocked.status, 3);
    assert.match(blocked.stdout, /Pending file recovery/);
    assert.equal(existsSync(join(f.root, "prompts.jsonl")), false);
  } finally {
    f.close();
  }
});

test("explicit quoted executable paths remain usable in headless execution", () => {
  const f = fixture();
  try {
    f.env.CODEX_EXECUTABLE = `"${provider}"`;
    const result = f.run(["exec", "hello", "--no-save", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).data.text, "fixture final answer");
  } finally {
    f.close();
  }
});

test("command API interrupts idle custom stdin without waiting for another chunk", async () => {
  const controller = new AbortController();
  const input: AsyncIterable<Buffer> = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
  };
  let stdout = "";
  const result = runTerminalCommand(
    ["exec", "--stdin", "--json"],
    {
      stdout: {
        write: (text: string) => {
          stdout += text;
          return true;
        },
      },
      stderr: { write: () => true },
    },
    { signal: controller.signal, stdin: input },
  );
  controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    assert.equal(
      await Promise.race([
        result,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve("timeout"), 1000);
        }),
      ]),
      130,
    );
    assert.equal(JSON.parse(stdout).error.code, "INTERRUPTED");
  } finally {
    if (timer) clearTimeout(timer);
  }
});
