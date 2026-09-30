import assert from "node:assert/strict";
import { test } from "node:test";
// The shipped Harness plugin is JavaScript because the child runs it directly with Node.
// @ts-expect-error no declaration file is needed for this private bridge module
import { notifyBounded, policyArguments, projectHarnessEvent } from "../../../../bin/ubume-local-harness-bridge.js";

test("bridge drops unused events and does not copy large tool results", () => {
  assert.equal(projectHarnessEvent({ type: "step/start", data: { large: "x".repeat(100_000) } }), null);
  const projected = projectHarnessEvent({
    type: "tool/result",
    seq: 4,
    data: { message: { source: { callId: "call-1" }, content: [{ type: "text", text: "x".repeat(100_000) }] } },
  });
  assert.equal(projected.data.message.content[0].text.length, 2_000);
  assert.equal(projected.data.message.source.callId, "call-1");
  assert.ok(JSON.stringify(projected).length < 3_000);
});

test("bridge preserves streamed text and final output while omitting final reasoning", () => {
  const delta = { type: "assistant/chunk", data: { step: 2, chunk: { type: "text-delta", text: "answer" } } };
  assert.deepEqual(projectHarnessEvent(delta), delta);
  const projected = projectHarnessEvent({
    type: "assistant/message",
    data: { message: { content: [{ type: "reasoning", text: "x".repeat(100_000) }, { type: "output_text", text: "answer" }] } },
  });
  assert.deepEqual(projected.data.message.content, [{ type: "output_text", text: "answer" }]);
});

test("bridge limits tool-call display arguments and excludes tool content from policy requests", () => {
  const projected = projectHarnessEvent({
    type: "tool/call",
    data: { callId: "call-2", name: "bash", arguments: JSON.stringify({ command: "x".repeat(100_000), secret: "hidden" }) },
  });
  const args = JSON.parse(projected.data.arguments);
  assert.equal(args.command.length, 2_000);
  assert.equal(args.secret, undefined);
  assert.deepEqual(policyArguments({ command: "git status", path: "src/app.tsx", content: "x".repeat(100_000) }), {
    command: "git status",
    path: "src/app.tsx",
  });
});

test("bridge stops when pending stdout exceeds its 16 MiB buffer", () => {
  const sent: string[] = [];
  const exits: number[] = [];
  const transport = { notify: (method: string) => sent.push(method) };
  notifyBounded(transport, "session.event", {}, { writableLength: 16 * 1024 * 1024 }, (code: number) => exits.push(code));
  assert.equal(exits.length, 0);
  notifyBounded(transport, "session.event", {}, { writableLength: 16 * 1024 * 1024 + 1 }, (code: number) => exits.push(code));
  assert.deepEqual(sent, ["session.event", "session.event"]);
  assert.deepEqual(exits, [86]);
});

test("bridge forwards compaction failures, turn error codes, and retry progress", () => {
  assert.deepEqual(projectHarnessEvent({ type: "compaction/start", data: { compactionId: "c-1", turn: 1 } }), { type: "compaction/start" });
  assert.deepEqual(projectHarnessEvent({ type: "compaction/end", data: { compactionId: "c-1", turn: 1 } }), { type: "compaction/end" });
  const failedCompaction = projectHarnessEvent({
    type: "compaction/end",
    data: { compactionId: "c-2", turn: 1, error: `pi-ai stream idle timeout after 300000ms${"x".repeat(10_000)}` },
  });
  assert.equal(failedCompaction.type, "compaction/end");
  assert.match(failedCompaction.data.error, /^pi-ai stream idle timeout after 300000ms/);
  assert.equal(failedCompaction.data.error.length, 4_000);

  const turnEnd = projectHarnessEvent({
    type: "turn/end",
    data: { turn: 1, reason: { kind: "error", error: { message: "pi-ai stream idle timeout after 300000ms", code: "TIMEOUT" } } },
  });
  assert.deepEqual(turnEnd.data.reason.error, { message: "pi-ai stream idle timeout after 300000ms", code: "TIMEOUT" });

  const retry = projectHarnessEvent({
    type: "llm/retry",
    data: {
      retryId: "r-1",
      turn: 1,
      step: 57,
      provider: "ubume-local",
      mode: "normal",
      policyKey: "[\"normal\",5]",
      retry: 2,
      maxRetries: 5,
      delayMs: 989.3,
      failure: { message: "503 Service Unavailable", code: "SERVER" },
    },
  });
  assert.deepEqual(retry, {
    type: "llm/retry",
    data: { retry: 2, maxRetries: 5, delayMs: 989.3, failure: { message: "503 Service Unavailable", code: "SERVER" } },
  });
});

async function server(flush: () => Promise<boolean> = async () => true) {
  const path = new URL("../../../../bin/ubume-local-harness-bridge.js", import.meta.url).href;
  const { UbumeHarnessServer } = await import(path);
  return new UbumeHarnessServer({ on: () => () => undefined, sessions: { get: () => ({ id: "session" }), flush } }, {});
}

test("bridge checkpoint requires a successful durable flush and propagates I/O errors", async () => {
  let persisted = false;
  const bridge = await server(async () => { persisted = true; return true; });
  assert.deepEqual(await bridge.flush({ sessionId: "session" }), { durable: true }); assert.equal(persisted, true);
  await assert.rejects((await server(async () => false)).flush({ sessionId: "session" }), /no session persistence/);
  await assert.rejects((await server(async () => { throw new Error("EIO saving journal"); })).flush({ sessionId: "session" }), /EIO/);
});

test("bridge classifies only missing and unsupported sessions as recoverable", async () => {
  const bridge = await server();
  for (const [error, expected] of [[new Error('session "lost" not found'), "missing"], [Object.assign(new Error("version mismatch"), { name: "SessionFormatUnsupportedError" }), "incompatible"]] as const) {
    bridge.getOrCreate = async () => { throw error; };
    assert.deepEqual(await bridge.open({ sessionId: "lost", resume: true }), { resumeUnavailable: expected });
  }
  bridge.getOrCreate = async () => { throw new Error("EACCES reading journal"); };
  await assert.rejects(bridge.open({ sessionId: "lost", resume: true }), /EACCES/);
  bridge.getOrCreate = async () => { throw new Error("corrupt session journal"); };
  await assert.rejects(bridge.open({ sessionId: "lost", resume: true }), /corrupt/);
});
