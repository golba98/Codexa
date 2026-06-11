import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentToolCall } from "./protocol.js";

test("parses a valid single tool call block", () => {
  const result = parseAgentToolCall('<tool_call>{"name":"read_file","arguments":{"path":"src/app.tsx"}}</tool_call>');

  assert.equal(result.kind, "tool_call");
  if (result.kind !== "tool_call") return;
  assert.equal(result.name, "read_file");
  assert.deepEqual(result.arguments, { path: "src/app.tsx" });
});

test("malformed JSON becomes a tool error parse result", () => {
  const result = parseAgentToolCall('<tool_call>{"name":"read_file",</tool_call>');

  assert.equal(result.kind, "malformed_tool_call");
  if (result.kind !== "malformed_tool_call") return;
  assert.match(result.error, /JSON|Expected|position/i);
});

test("assistant text without a tool call is final", () => {
  const result = parseAgentToolCall("Done. I changed the file.");

  assert.deepEqual(result, { kind: "final", text: "Done. I changed the file." });
});
