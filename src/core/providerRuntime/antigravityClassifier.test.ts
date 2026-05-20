import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLine,
  classifyLines,
  extractAssistantOutput,
  makeClassifierState,
} from "./antigravityClassifier.js";

// ─── classifyLine ──────────────────────────────────────────────────────────────

test("classifies task_progress open tag", () => {
  const { classification, nextState } = classifyLine("<task_progress>", makeClassifierState());
  assert.equal(classification, "provider_task_progress");
  assert.equal(nextState.insideTaskProgress, true);
});

test("classifies task_progress close tag and exits block", () => {
  const state = { ...makeClassifierState(), insideTaskProgress: true };
  const { classification, nextState } = classifyLine("</task_progress>", state);
  assert.equal(classification, "provider_task_progress");
  assert.equal(nextState.insideTaskProgress, false);
});

test("classifies lines inside task_progress block as provider_task_progress", () => {
  const state = { ...makeClassifierState(), insideTaskProgress: true };
  const { classification } = classifyLine("Some internal progress message", state);
  assert.equal(classification, "provider_task_progress");
});

test("classifies line after task_progress close as assistant_output", () => {
  const stateOpen = makeClassifierState();
  const { nextState: stateInsideOpen } = classifyLine("<task_progress>", stateOpen);
  const { nextState: stateAfterClose } = classifyLine("</task_progress>", stateInsideOpen);
  const { classification } = classifyLine("Hello user!", stateAfterClose);
  assert.equal(classification, "assistant_output");
});

test("classifies Standard Output: header inside task_progress as provider_tool_stdout", () => {
  const state = { ...makeClassifierState(), insideTaskProgress: true };
  const { classification, nextState } = classifyLine("Standard Output:", state);
  assert.equal(classification, "provider_tool_stdout");
  assert.equal(nextState.insideStandardOutput, true);
});

test("classifies Standard Error: header inside task_progress as provider_tool_stderr", () => {
  const state = { ...makeClassifierState(), insideTaskProgress: true };
  const { classification, nextState } = classifyLine("Standard Error:", state);
  assert.equal(classification, "provider_tool_stderr");
  assert.equal(nextState.insideStandardError, true);
});

test("classifies thought open tag as hidden_reasoning", () => {
  const { classification, nextState } = classifyLine("<thought>", makeClassifierState());
  assert.equal(classification, "hidden_reasoning");
  assert.equal(nextState.insideThought, true);
});

test("classifies lines inside thought block as hidden_reasoning", () => {
  const state = { ...makeClassifierState(), insideThought: true };
  const { classification } = classifyLine("Internal chain-of-thought step", state);
  assert.equal(classification, "hidden_reasoning");
});

test("classifies thought close tag and exits block", () => {
  const state = { ...makeClassifierState(), insideThought: true };
  const { classification, nextState } = classifyLine("</thought>", state);
  assert.equal(classification, "hidden_reasoning");
  assert.equal(nextState.insideThought, false);
});

test("classifies <<thought>> open tag as hidden_reasoning", () => {
  const { classification, nextState } = classifyLine("<<thought>>", makeClassifierState());
  assert.equal(classification, "hidden_reasoning");
  assert.equal(nextState.insideThought, true);
});

test("classifies Background task line as provider_task_progress", () => {
  const { classification } = classifyLine("Background task abc123 started", makeClassifierState());
  assert.equal(classification, "provider_task_progress");
});

test("classifies standalone Standard Output: as provider_tool_stdout", () => {
  const { classification, nextState } = classifyLine("Standard Output:", makeClassifierState());
  assert.equal(classification, "provider_tool_stdout");
  assert.equal(nextState.insideStandardOutput, true);
});

test("classifies content inside Standard Output section", () => {
  const state = { ...makeClassifierState(), insideStandardOutput: true };
  const { classification } = classifyLine("some tool output line", state);
  assert.equal(classification, "provider_tool_stdout");
});

test("classifies standalone Standard Error: as provider_tool_stderr", () => {
  const { classification, nextState } = classifyLine("Standard Error:", makeClassifierState());
  assert.equal(classification, "provider_tool_stderr");
  assert.equal(nextState.insideStandardError, true);
});

test("classifies content inside Standard Error section", () => {
  const state = { ...makeClassifierState(), insideStandardError: true };
  const { classification } = classifyLine("stderr output line", state);
  assert.equal(classification, "provider_tool_stderr");
});

test("classifies An event occurred. as provider_protocol", () => {
  const { classification } = classifyLine("An event occurred.", makeClassifierState());
  assert.equal(classification, "provider_protocol");
});

test("classifies Authentication required as provider_auth", () => {
  const { classification } = classifyLine("Authentication required", makeClassifierState());
  assert.equal(classification, "provider_auth");
});

test("classifies Waiting for authentication as provider_auth", () => {
  const { classification } = classifyLine("Waiting for authentication...", makeClassifierState());
  assert.equal(classification, "provider_auth");
});

test("classifies paste the authorization code as provider_auth", () => {
  const { classification } = classifyLine("paste the authorization code here", makeClassifierState());
  assert.equal(classification, "provider_auth");
});

test("classifies Authenticated alone as provider_auth", () => {
  const { classification } = classifyLine("Authenticated", makeClassifierState());
  assert.equal(classification, "provider_auth");
});

test("classifies accounts.google.com URL as sensitive_auth_url", () => {
  const { classification } = classifyLine("Please visit https://accounts.google.com/oauth/...", makeClassifierState());
  assert.equal(classification, "sensitive_auth_url");
});

test("classifies READY (exact) as provider_probe", () => {
  const { classification } = classifyLine("READY", makeClassifierState());
  assert.equal(classification, "provider_probe");
});

test("classifies MODEL=...; REASONING=... as provider_probe", () => {
  const { classification } = classifyLine("MODEL=Gemini 3.5 Flash; REASONING=High", makeClassifierState());
  assert.equal(classification, "provider_probe");
});

test("classifies MODEL probe with Medium as provider_probe", () => {
  const { classification } = classifyLine("MODEL=gemini-2.5-pro; REASONING=Medium", makeClassifierState());
  assert.equal(classification, "provider_probe");
});

test("classifies MODEL probe with Low as provider_probe", () => {
  const { classification } = classifyLine("MODEL=some-model; REASONING=Low", makeClassifierState());
  assert.equal(classification, "provider_probe");
});

test("classifies MODEL probe with Thinking as provider_probe", () => {
  const { classification } = classifyLine("MODEL=gemini-3; REASONING=Thinking", makeClassifierState());
  assert.equal(classification, "provider_probe");
});

test("classifies MODEL probe with Unknown as provider_probe", () => {
  const { classification } = classifyLine("MODEL=external; REASONING=Unknown", makeClassifierState());
  assert.equal(classification, "provider_probe");
});

test("classifies normal prose as assistant_output", () => {
  const { classification } = classifyLine("Here is the answer to your question.", makeClassifierState());
  assert.equal(classification, "assistant_output");
});

test("suppresses prompt echo when promptToSuppress matches", () => {
  const state = makeClassifierState("Hello world");
  const { classification } = classifyLine("Hello world", state);
  assert.equal(classification, "provider_protocol");
});

test("does not suppress non-matching lines with promptToSuppress set", () => {
  const state = makeClassifierState("Hello world");
  const { classification } = classifyLine("Some other text", state);
  assert.equal(classification, "assistant_output");
});

// ─── extractAssistantOutput ────────────────────────────────────────────────────

test("extractAssistantOutput returns only assistant lines joined", () => {
  const classified = [
    { line: "<task_progress>", classification: "provider_task_progress" as const },
    { line: "internal", classification: "provider_task_progress" as const },
    { line: "</task_progress>", classification: "provider_task_progress" as const },
    { line: "Hello! Here is your answer.", classification: "assistant_output" as const },
    { line: "It has two parts.", classification: "assistant_output" as const },
  ];
  const result = extractAssistantOutput(classified);
  assert.equal(result, "Hello! Here is your answer.\nIt has two parts.");
});

test("extractAssistantOutput returns null when no assistant lines present", () => {
  const classified = [
    { line: "READY", classification: "provider_probe" as const },
    { line: "<task_progress>", classification: "provider_task_progress" as const },
    { line: "</task_progress>", classification: "provider_task_progress" as const },
  ];
  const result = extractAssistantOutput(classified);
  assert.equal(result, null);
});

test("extractAssistantOutput returns null for empty input", () => {
  assert.equal(extractAssistantOutput([]), null);
});

// ─── classifyLines (full pipeline) ────────────────────────────────────────────

test("classifyLines processes mixed protocol+assistant output correctly", () => {
  const lines = [
    "<task_progress>",
    "Background task abc123",
    "Standard Output:",
    "tool result here",
    "</task_progress>",
    "Here is the final answer.",
    "It continues here.",
  ];
  const classified = classifyLines(lines, makeClassifierState());
  const assistantLines = classified.filter((c) => c.classification === "assistant_output");
  const internalLines = classified.filter((c) => c.classification !== "assistant_output");

  assert.equal(assistantLines.length, 2);
  assert.equal(assistantLines[0]!.line, "Here is the final answer.");
  assert.equal(assistantLines[1]!.line, "It continues here.");
  assert.equal(internalLines.length > 0, true);
});

test("probe output never reaches assistant_output classification", () => {
  const lines = [
    "READY",
    "MODEL=Gemini 3.5 Flash; REASONING=High",
    "Authentication required",
  ];
  const classified = classifyLines(lines, makeClassifierState());
  const assistantLines = classified.filter((c) => c.classification === "assistant_output");
  assert.equal(assistantLines.length, 0);
});
