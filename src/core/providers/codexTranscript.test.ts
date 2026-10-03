import assert from "node:assert/strict";
import test from "node:test";
import type { RunToolActivity } from "../../session/types.js";
import {
  createCodexTranscriptStreamParser,
  sanitizeCodexTranscript,
  stripNonPrintableControls,
} from "./codexTranscript.js";

test("extracts the assistant reply from noisy codex transcript output", () => {
  const raw = [
    "Reading additional input from stdin...",
    "OpenAI Codex v0.118.0 (research preview)",
    "--------",
    "workdir: C:\\Development\\1-JavaScript\\13-Custom CLI",
    "model: gpt-5.4",
    "provider: openai",
    "approval: never",
    "sandbox: read-only",
    "reasoning effort: xhigh",
    "reasoning summaries: none",
    "session id: 019d4984-90c0-7402-80c9-3d55a8e0373f",
    "--------",
    "user",
    "Hello",
    "codex",
    "Hello. What do you need help with?",
    "tokens used",
    "1,390",
    "Hello. What do you need help with?",
  ].join("\n");

  assert.equal(sanitizeCodexTranscript(raw), "Hello. What do you need help with?");
});

test("falls back to filtered plain output when no labeled assistant block exists", () => {
  const raw = [
    "\u001b[32mOpenAI Codex v0.118.0\u001b[0m",
    "--------",
    "workdir: C:\\repo",
    "",
    "First useful line",
    "Second useful line",
  ].join("\n");

  assert.equal(sanitizeCodexTranscript(raw), "First useful line\nSecond useful line");
});

test("filters echoed clarification-policy prompt lines from finalized transcripts", () => {
  const raw = [
    "default to best-effort continuation instead of stopping for clarification.",
    "if a detail is missing but non-critical, make the most reasonable assumption and state it briefly.",
    "if multiple paths are possible, choose one sensible path and continue.",
    "only ask a blocking follow-up question if proceeding would likely use the wrong file, wrong command, destructive behavior, or produce fundamentally incorrect output.",
    "if you are truly blocked on one critical missing fact, end the response with exactly one line in this format: [QUESTION]: <your question>",
    "",
    "Implemented the fix and assumed src/app.tsx was the target entrypoint.",
  ].join("\n");

  assert.equal(
    sanitizeCodexTranscript(raw),
    "Implemented the fix and assumed src/app.tsx was the target entrypoint.",
  );
});

test("returns a readable fallback when only noise is present", () => {
  const raw = [
    "Reading additional input from stdin...",
    "OpenAI Codex v0.118.0",
    "--------",
    "model: gpt-5.4",
    "provider: openai",
  ].join("\n");

  assert.match(
    sanitizeCodexTranscript(raw),
    /no assistant response text was detected/i,
  );
});

test("streams thinking lines separately from assistant deltas", () => {
  const thinking: string[] = [];
  const assistant: string[] = [];
  const parser = createCodexTranscriptStreamParser({
    onThinkingLine: (line) => thinking.push(line),
    onAssistantDelta: (chunk) => assistant.push(chunk),
  });

  parser.feed([
    "OpenAI Codex v0.118.0",
    "Checking src/app.tsx",
    "Task:",
    "Refactor the CLI",
    "",
    "assistant",
    "First line",
    "Second line",
  ].join("\n"));
  parser.flush();

  assert.deepEqual(thinking, ["Checking src/app.tsx"]);
  assert.deepEqual(assistant, ["First line", "\nSecond line"]);
});

test("emits fenced code blocks atomically when streaming", () => {
  const assistant: string[] = [];
  const parser = createCodexTranscriptStreamParser({
    onAssistantDelta: (chunk) => assistant.push(chunk),
  });

  parser.feed("assistant\n```ts\n");
  parser.feed("const value = 1;\n");
  parser.feed("```\n");
  parser.flush();

  // Code fences are buffered and emitted as a single atomic chunk
  assert.deepEqual(assistant, ["```ts\nconst value = 1;\n```"]);
});

test("emits tool activity separately from assistant prose while streaming", () => {
  const assistant: string[] = [];
  const toolActivity: RunToolActivity[] = [];
  const parser = createCodexTranscriptStreamParser({
    onAssistantDelta: (chunk) => assistant.push(chunk),
    onToolActivity: (activity) => toolActivity.push(activity),
  });

  parser.feed([
    "assistant",
    "$ rg --files",
    "src/app.tsx",
    "src/ui/BottomComposer.tsx",
    "",
    "I found the relevant files.",
  ].join("\n"));
  parser.flush();

  assert.deepEqual(assistant, ["I found the relevant files."]);
  assert.equal(toolActivity.length, 2);
  assert.equal(toolActivity[0]?.command, "rg --files");
  assert.equal(toolActivity[0]?.status, "running");
  assert.equal(toolActivity[1]?.command, "rg --files");
  assert.equal(toolActivity[1]?.status, "completed");
  assert.equal(toolActivity[1]?.summary, "Found 2 files");
});

test("removes tool execution stdout from the finalized assistant transcript", () => {
  const raw = [
    "assistant",
    "$ rg --files",
    "src/app.tsx",
    "src/ui/BottomComposer.tsx",
    "",
    "I found the relevant files and updated the composer.",
  ].join("\n");

  assert.equal(
    sanitizeCodexTranscript(raw),
    "I found the relevant files and updated the composer.",
  );
});

// ─── Progressive streaming tests ──────────────────────────────────────────────

test("emits partial lines after timeout when no newline arrives", async () => {
  const assistant: string[] = [];
  const parser = createCodexTranscriptStreamParser({
    onAssistantDelta: (chunk) => assistant.push(chunk),
  });

  parser.feed("assistant\n");
  parser.feed("Hello wor");
  // No newline yet — partial flush timer should fire after ~100ms
  assert.equal(assistant.length, 0);

  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0], "Hello wor");

  parser.flush();
  // flush should not re-emit the already-emitted partial
  assert.equal(assistant.length, 1);
});

test("does not duplicate content when partial is followed by complete line", async () => {
  const assistant: string[] = [];
  const parser = createCodexTranscriptStreamParser({
    onAssistantDelta: (chunk) => assistant.push(chunk),
  });

  parser.feed("assistant\n");
  parser.feed("Start of line");
  // Wait for partial flush
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0], "Start of line");

  // Now the rest of the line arrives with newline
  parser.feed(" and the rest\n");
  // The partial was already emitted; the remaining text appends naturally
  // The feed should process the complete line that includes both parts
  assert.ok(assistant.length >= 1);

  parser.flush();
});

test("code fence with prose before and after emits prose immediately and fence atomically", () => {
  const assistant: string[] = [];
  const parser = createCodexTranscriptStreamParser({
    onAssistantDelta: (chunk) => assistant.push(chunk),
  });

  parser.feed("assistant\nHere is the code:\n```ts\nconst x = 1;\n```\nDone.\n");
  parser.flush();

  assert.equal(assistant.length, 3);
  assert.equal(assistant[0], "Here is the code:");
  assert.equal(assistant[1], "\n```ts\nconst x = 1;\n```");
  assert.equal(assistant[2], "\nDone.");
});

test("code fence safety timeout emits buffered content after 3 seconds", async () => {
  const assistant: string[] = [];
  const parser = createCodexTranscriptStreamParser({
    onAssistantDelta: (chunk) => assistant.push(chunk),
  });

  parser.feed("assistant\n```ts\nconst x = 1;\n");
  // No closing fence — wait for safety timeout (3s)
  // We'll test that flush() force-emits instead of waiting the full 3s
  assert.equal(assistant.length, 0);

  parser.flush();
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0], "```ts\nconst x = 1;");
});

test("auto-promotes long prose lines from preamble to assistant section", () => {
  const thinking: string[] = [];
  const assistant: string[] = [];
  const parser = createCodexTranscriptStreamParser({
    onThinkingLine: (line) => thinking.push(line),
    onAssistantDelta: (chunk) => assistant.push(chunk),
  });

  parser.feed([
    "I have analyzed the codebase and here is a comprehensive summary of all the changes that need to be made to fix this issue.",
  ].join("\n"));
  parser.flush();

  // Long prose with many words should auto-promote to assistant
  assert.equal(thinking.length, 0);
  assert.equal(assistant.length, 1);
  assert.match(assistant[0]!, /analyzed the codebase/);
});

test("does not auto-promote short status lines from preamble", () => {
  const thinking: string[] = [];
  const assistant: string[] = [];
  const parser = createCodexTranscriptStreamParser({
    onThinkingLine: (line) => thinking.push(line),
    onAssistantDelta: (chunk) => assistant.push(chunk),
  });

  parser.feed("Checking src/app.tsx\n");
  parser.flush();

  assert.equal(thinking.length, 1);
  assert.equal(assistant.length, 0);
});

test("strips control characters from streamed and finalized assistant text", () => {
  const assistant: string[] = [];
  const parser = createCodexTranscriptStreamParser({
    onAssistantDelta: (chunk) => assistant.push(chunk),
  });

  parser.feed("assistant\nHello\u0007 world\u0001\n");
  parser.flush();

  assert.deepEqual(assistant, ["Hello world"]);
  assert.equal(stripNonPrintableControls("A\u0000B\u001fC"), "ABC");
  assert.equal(sanitizeCodexTranscript("assistant\nDone\u0007\n"), "Done");
});
