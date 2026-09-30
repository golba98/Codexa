import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { ThemeProvider } from "../theme.js";
import { WorkbenchPanel } from "./WorkbenchPanel.js";
import { queuedPrompt } from "../../session/workbench.js";
import type { FileCheckpoint } from "../../core/workspace/checkpoints.js";

class Input extends PassThrough { isTTY = true; setRawMode() { return this; } ref() { return this; } unref() { return this; } }
class Output extends PassThrough { isTTY = true; columns = 100; rows = 30; }
const delay = () => new Promise((resolve) => setTimeout(resolve, 50));
function harness(node: React.ReactElement) {
  const stdin = new Input(); const stdout = new Output(); let text = "";
  stdout.on("data", (chunk) => { text += chunk.toString(); });
  const instance = render(<ThemeProvider theme="purple">{node}</ThemeProvider>, { stdin: stdin as never, stdout: stdout as never, stderr: stdout as never, debug: true, patchConsole: false, exitOnCtrlC: false });
  return { instance, async key(value: string) { text = ""; stdin.write(value); await delay(); }, frame: () => text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "") };
}
const empty = { events: [], queue: [], paused: true, checkpoints: [], store: null, onQueueAction() {}, async onRewind() {}, onClose() {} };
test("transcript search stays filtered after acceptance and expands the matched output", async () => {
  const terminal = harness(<WorkbenchPanel {...empty} view="transcript" events={[
    { id: 1, type: "system", createdAt: 1, title: "needle", content: "detail retained" },
    { id: 2, type: "system", createdAt: 2, title: "unrelated", content: "other output" },
  ]} />);
  try {
    await delay(); await terminal.key("/"); await terminal.key("needle"); await terminal.key("\r");
    assert.match(terminal.frame(), /needle/); assert.doesNotMatch(terminal.frame(), /unrelated/);
    await terminal.key("\r"); assert.match(terminal.frame(), /detail retained/);
  } finally { terminal.instance.unmount(); }
});
test("rewind previews the selected mode and only applies after a second Enter", async () => {
  const checkpoint: FileCheckpoint = { id: "1", turnId: 1, messageCount: 0, prompt: "original instruction", before: { files: {}, complete: true, skipped: [] } };
  let applied = 0;
  const terminal = harness(<WorkbenchPanel {...empty} view="rewind" checkpoints={[checkpoint]} onRewind={async (point, mode, operations) => { assert.equal(point.id, "1"); assert.equal(mode, "conversation"); assert.deepEqual(operations, []); applied++; }} />);
  try {
    await delay(); await terminal.key("c"); assert.equal(applied, 0); assert.match(terminal.frame(), /Press Enter to apply/);
    await terminal.key("\r"); assert.equal(applied, 1);
  } finally { terminal.instance.unmount(); }
});
test("queue navigation targets the selected instruction for edit, reorder and delete", async () => {
  const first = queuedPrompt("first", "first"); const second = queuedPrompt("second", "second");
  const actions: string[] = [];
  const terminal = harness(<WorkbenchPanel {...empty} view="queue" queue={[first, second]} onQueueAction={(action, id) => actions.push(`${action}:${id}`)} />);
  try {
    await delay(); await terminal.key("\u001b[B"); await terminal.key("e"); await terminal.key("["); await terminal.key("d");
    assert.deepEqual(actions, [`edit:${second.id}`, `up:${second.id}`, `remove:${second.id}`]);
  } finally { terminal.instance.unmount(); }
});

test("Ctrl+C cannot select conversation rewind or a plain-letter panel action", async () => {
  const checkpoint: FileCheckpoint = { id: "1", turnId: 1, messageCount: 0, prompt: "instruction", before: { files: {}, complete: true, skipped: [] } };
  const terminal = harness(<WorkbenchPanel {...empty} view="rewind" checkpoints={[checkpoint]} />);
  try { await delay(); await terminal.key("\x03"); assert.doesNotMatch(terminal.frame(), /Press Enter to apply/); }
  finally { terminal.instance.unmount(); }
});
