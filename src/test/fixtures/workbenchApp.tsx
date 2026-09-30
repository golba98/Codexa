import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { inspectOwnership } from "../../core/workspace/ownership.js";
import assert from "node:assert/strict";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { App } from "../../app.js";
import { parseLaunchArgs } from "../../config/launchArgs.js";
import { ConversationStore } from "../../core/workspace/conversationStore.js";
import { resolveUbumeConversationDir } from "../../core/workspace/appData.js";
import type { BackendProvider, BackendRunHandlers } from "../../core/providers/types.js";

class Input extends PassThrough {
  isTTY = true;
  setRawMode() { return this; }
  ref() { return this; }
  unref() { return this; }
}
class Output extends PassThrough { isTTY = true; columns = 100; rows = 32; }
let cleanupPending = false;
const runs: { prompt: string; handlers: BackendRunHandlers; stopped: () => void; history: readonly { content: string }[]; mode: string; planMode: boolean }[] = [];
const provider: BackendProvider = {
  id: "codex-subprocess", label: "Test", description: "test", authState: "delegated", authLabel: "test", statusMessage: "test", supportsModels: () => true,
  run(prompt, options, handlers) {
    assert.equal(cleanupPending, false, "new run overlapped provider cleanup");
    let stop!: () => void; let ended = false;
    const stopped = new Promise<void>((resolve) => { stop = () => { ended = true; resolve(); }; });
    handlers.onRunControl?.({ stopped });
    runs.push({ prompt, handlers, stopped: stop, history: options.conversationHistory ?? [], mode: options.runtime.mode, planMode: options.runtime.planMode });
    return () => { if (ended) return; cleanupPending = true; setTimeout(() => { cleanupPending = false; stop(); }, 50); };
  },
};
const parsed = parseLaunchArgs(["--model", "gpt-5.4", "--no-clear"]);
assert(parsed.ok);
const delay = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}`); await delay(25); }
}
function mount() {
  const stdin = new Input(); const stdout = new Output(); let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });
  const instance = render(<App launchArgs={parsed.ok ? parsed.value : never()} providerOverride={provider} />, { stdin: stdin as never, stdout: stdout as never, stderr: stdout as never, exitOnCtrlC: false, patchConsole: false, debug: true });
  return { stdin, instance, output: () => output };
}
function never(): never { throw new Error("arguments"); }
const store = new ConversationStore(process.cwd());
const scenario = process.argv[2];
if (scenario === "cancel-start") for (let i = 0; i < 800; i++) writeFileSync(`file-${i}.txt`, "checkpoint fixture");
const terminal = mount();
await delay(350);
if (scenario === "plan-actions") {
  terminal.stdin.write("/plan on"); await delay(); terminal.stdin.write("\r"); await delay(200);
  terminal.stdin.write("Plan a safe fix"); await delay(); terminal.stdin.write("\r");
  await until(() => runs.length === 1, "planning run");
  runs[0]!.stopped(); runs[0]!.handlers.onResponse("1. Inspect the code.\n2. Fix the error.\n3. Run tests.");
  await until(() => terminal.output().includes("[R] Redo plan"), "plan actions");
  await delay(150);
  terminal.stdin.write("r");
  await until(() => runs.length === 2, "redo without feedback modal");
  assert.equal(runs[1]!.mode, "suggest");
  assert.match(runs[1]!.prompt, /Plan a safe fix/);
  assert.match(runs[1]!.prompt, /Redo the plan/);
  runs[1]!.stopped(); runs[1]!.handlers.onResponse("1. Inspect.\n2. Correct the error with tests.");
  await until(() => { const output = terminal.output(); const index = output.lastIndexOf("Correct the error with tests."); return index >= 0 && output.slice(index).includes("[R] Redo plan"); }, "revised plan actions rendered");
  await delay(150);
  terminal.stdin.write("i");
  await until(() => runs.length === 3, "implement in Auto");
  assert.equal(runs[2]!.mode, "auto-edit"); assert.equal(runs[2]!.planMode, false);
  terminal.stdin.write("i");
  terminal.stdin.write("\x03"); await delay(200);
  assert.equal(runs.length, 3, "double action must not start twice");
  terminal.instance.unmount(); await delay(); process.exit(0);
} else if (scenario === "save") {
  terminal.stdin.write("first instruction"); await delay(); terminal.stdin.write("\r");
  await until(() => runs.length === 1, "first run");
  runs[0]!.handlers.onAssistantDelta?.("partial reply");
  terminal.stdin.write("queued instruction"); await delay(); terminal.stdin.write("\r"); await delay(250);
  terminal.stdin.write("unsent draft"); await delay(1100);
  const entry = store.list()[0]; assert(entry);
  const loaded = store.load(entry.id); assert(loaded?.session);
  assert.equal(loaded.session.draft, "unsent draft"); assert.equal(loaded.session.queue.length, 1);
  assert.equal(loaded.session.queue[0]?.submitted, "queued instruction");
  assert.equal(loaded.messages[0]?.submittedContent, "first instruction");
  assert(loaded.session.events.some((event) => event.type === "assistant" && event.contentChunks.join("").includes("partial reply")));
  // Abrupt exit exercises resume of a snapshot captured during a live run.
  process.exit(0);
} else if (scenario === "draft-only") {
  // A fresh start that never sends a prompt must not leave a /resume entry.
  terminal.stdin.write("/model"); await delay(); terminal.stdin.write("\u0001"); await delay(); terminal.stdin.write("\u000b"); await delay();
  terminal.stdin.write("unsent draft only"); await delay(1100);
  terminal.instance.unmount(); await delay(350);
  const conversationDir = resolveUbumeConversationDir(process.cwd());
  assert.deepEqual(existsSync(conversationDir) ? readdirSync(conversationDir) : [], []);
  assert.equal(store.list().length, 0);
  process.exit(0);
} else if (scenario === "cancel-start") {
  terminal.stdin.write("cancel during preparation"); await delay(); terminal.stdin.write("\r");
  await delay(10); terminal.stdin.write("\x03"); await delay(500);
  await until(() => !inspectOwnership(process.cwd(), "execution").locked, "preparation lock released");
  assert.equal(runs.length, 0, "canceled preparation must not launch the provider");
  terminal.instance.unmount(); await delay(); process.exit(0);
} else if (scenario === "flow") {
  const send = async (value: string) => { terminal.stdin.write(value); await delay(); terminal.stdin.write("\r"); await delay(); };
  await send("first"); await until(() => runs.length === 1, "first running");
  await send("second"); await until(() => store.load(store.list()[0]!.id)?.session?.queue.length === 1 && store.load(store.list()[0]!.id)?.session?.draft === "", "second queued and composer reset"); terminal.stdin.write("independent draft"); await delay();
  assert.equal(runs.length, 1);
  runs[0]!.stopped(); runs[0]!.handlers.onResponse("first response");
  await until(() => runs.length === 2, "FIFO automatic continuation");
  assert.equal(runs[1]?.prompt, "second");
  await delay(350);
  assert.equal(store.load(store.list()[0]!.id)?.session?.draft, "independent draft");
  terminal.stdin.write("\u0001"); await delay(); terminal.stdin.write("\u000b"); await delay();
  await send("third"); await until(() => store.load(store.list()[0]!.id)?.session?.queue.length === 1 && store.load(store.list()[0]!.id)?.session?.draft === "", "third queued and composer reset"); terminal.stdin.write("fourth"); await delay();
  terminal.stdin.write("\u0018"); await delay(); terminal.stdin.write("\u0013");
  await until(() => runs.length === 3, "interrupt and continue");
  assert.equal(runs[2]?.prompt, "third\n\nfourth");
  // Late callbacks from the canceled run must not append an answer or clear the new draft.
  runs[1]!.handlers.onResponse("stale answer");
  terminal.stdin.write("retained after interrupt"); await delay();
  runs[2]!.handlers.onAssistantDelta?.("last buffered partial reply");
  terminal.stdin.write("\u000f"); await delay();
  assert(terminal.output().includes("TRANSCRIPT"));
  terminal.stdin.write("\u0003"); await delay(350);
  const record = store.load(store.list()[0]!.id); assert(record?.session);
  assert.equal(record.session.draft, "retained after interrupt");
  assert(record.session.events.some((event) => event.type === "assistant" && (event.content + event.contentChunks.join("")).includes("last buffered partial reply")));
  assert(!record.messages.some((message) => message.content === "stale answer"));
  terminal.instance.unmount(); await delay(); process.exit(0);
} else {
  const original = store.list()[0]; assert(original);
  terminal.stdin.write(`/resume ${original.id}`); await delay(); terminal.stdin.write("\r"); await until(() => terminal.output().includes("Conversation resumed"), "resume ready");
  assert.equal(runs.length, 0, "resuming must not dispatch queued work");
  const restored = store.load(original.id); assert.equal(restored?.session?.draft, "unsent draft");
  assert(terminal.output().includes("partial reply"));
  terminal.stdin.write("\u0001"); await delay(); terminal.stdin.write("\u000b"); await delay(); // clear restored draft with conventional editing
  terminal.stdin.write("/queue"); await delay(); terminal.stdin.write("\r"); await until(() => terminal.output().includes("QUEUE · paused"), "queue panel ready"); await delay();
  terminal.stdin.write("s");
  await until(() => runs.length === 1, "continued queue");
  assert.equal(runs[0]?.prompt, "queued instruction");
  assert(runs[0]?.history.some((message) => message.content.includes("partial reply")));
  runs[0]!.stopped(); runs[0]!.handlers.onResponse("completed queued instruction");
  await until(() => store.load(original.id)?.session?.queue.length === 0, "queue persisted removal");
  terminal.instance.unmount(); await delay();
  process.exit(0);
}
