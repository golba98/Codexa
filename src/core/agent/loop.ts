import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BackendRunHandlers } from "../providers/types.js";
import type { ProviderChatRequest } from "../providerRuntime/types.js";
import { executeAgentTool, type AgentToolResult } from "./tools.js";
import { parseAgentToolCall, serializeToolResult, type NormalizedAgentToolCall } from "./protocol.js";

export interface AgentChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface AgentChatResponse {
  text: string;
  toolCalls?: readonly NormalizedAgentToolCall[];
}

export interface RunAgentLoopOptions {
  request: ProviderChatRequest;
  handlers: BackendRunHandlers;
  sendMessages: (messages: readonly AgentChatMessage[], turnIndex: number) => Promise<AgentChatResponse>;
  includeSystemPrompt: boolean;
  signal?: AbortSignal;
  maxToolCalls?: number;
}

const DEFAULT_MAX_TOOL_CALLS = 10;

function workspaceSummary(workspaceRoot: string): string {
  const lines = [`Workspace root: ${workspaceRoot}`];
  try {
    const entries = readdirSync(workspaceRoot, { withFileTypes: true })
      .filter((entry) => ![".git", "node_modules", "dist", "build", "coverage"].includes(entry.name))
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
      .sort()
      .slice(0, 20);
    if (entries.length > 0) lines.push(`Top-level entries: ${entries.join(", ")}`);
  } catch {
    // Tool-based inspection remains available when a shallow summary is unavailable.
  }

  try {
    const packageJsonPath = path.join(workspaceRoot, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
      const name = typeof packageJson.name === "string" ? packageJson.name : null;
      const description = typeof packageJson.description === "string" ? packageJson.description : null;
      if (name) lines.push(`Package: ${name}${description ? ` - ${description}` : ""}`);
    }
  } catch {
    // A malformed package.json should not prevent a local chat request.
  }

  return lines.join("\n");
}

function localAgentSystemPrompt(request: ProviderChatRequest): string {
  const hasCargoToml = existsSync(path.join(request.workspaceRoot, "Cargo.toml"));
  return [
    `You are an autonomous coding assistant running inside this workspace: ${request.workspaceRoot}`,
    "You must inspect files with tools before claiming you cannot see them.",
    "For broad questions about the repository, use the workspace summary below, then inspect with get_workspace_info or list_files before answering when more detail is needed.",
    "Use tools to create, edit, build, and test when the user asks for workspace changes.",
    "Do not ask vague clarification questions when the user's intent has an obvious safe implementation.",
    hasCargoToml
      ? "Rust workspace note: Cargo.toml exists. Prefer src/main.rs for simple binaries, use cargo check for validation, use cargo run for running, and do not use rustc main.rs unless main.rs is truly at the workspace root."
      : null,
    "Use exactly one tool call at a time in this format:",
    '<tool_call>{"name":"read_file","arguments":{"path":"src/index.tsx"}}</tool_call>',
    "Available tools: list_files, read_file, write_file, apply_patch, run_shell, get_workspace_info.",
    "Summarize changed files and commands run in your final answer.",
    `Workspace summary:\n${workspaceSummary(request.workspaceRoot)}`,
    request.projectInstructions?.content
      ? ["Project instructions:", request.projectInstructions.content].join("\n")
      : null,
  ].filter(Boolean).join("\n\n");
}

function buildInitialMessages(request: ProviderChatRequest, includeSystemPrompt: boolean): AgentChatMessage[] {
  const systemPrompt = localAgentSystemPrompt(request);
  if (includeSystemPrompt) {
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: request.prompt },
    ];
  }

  return [
    { role: "user", content: `${systemPrompt}\n\nUser request:\n${request.prompt}` },
  ];
}

function toolActivityCommand(result: Pick<AgentToolResult, "tool" | "path" | "paths" | "command">): string {
  if (result.command) return `${result.tool}: ${result.command}`;
  if (result.path) return `${result.tool}: ${result.path}`;
  if (result.paths && result.paths.length > 0) return `${result.tool}: ${result.paths.join(", ")}`;
  return result.tool;
}

interface ExecutedCommand {
  command: string;
  success: boolean;
  exitCode?: number | null;
  durationMs?: number;
}

interface AgentLoopSummary {
  changedFiles: Set<string>;
  commands: ExecutedCommand[];
  toolResults: AgentToolResult[];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function toolCallSignature(call: Pick<NormalizedAgentToolCall, "name" | "arguments">): string {
  return `${call.name}:${stableJson(call.arguments)}`;
}

function recordToolResult(summary: AgentLoopSummary, result: AgentToolResult): void {
  for (const file of result.paths ?? []) {
    if (file) summary.changedFiles.add(file);
  }
  if (result.path && (result.tool === "write_file" || result.tool === "apply_patch")) {
    summary.changedFiles.add(result.path);
  }
  if (result.command) {
    summary.commands.push({
      command: result.command,
      success: result.success,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
  }
  summary.toolResults.push(result);
}

function commandStatus(command: ExecutedCommand): string {
  const status = command.success ? "succeeded" : "failed";
  const exitCode = command.exitCode === undefined ? "" : `, exit ${command.exitCode ?? "n/a"}`;
  return `- ${command.command}: ${status}${exitCode}`;
}

function nextCommand(request: ProviderChatRequest, summary: AgentLoopSummary): string {
  if (existsSync(path.join(request.workspaceRoot, "Cargo.toml"))) return "cargo run";
  const lastValidation = [...summary.commands].reverse().find((item) =>
    /\b(?:cargo check|cargo run|bun test|npm test|bun run typecheck|tsc)\b/.test(item.command)
  );
  if (lastValidation) return lastValidation.command;
  return "bun test";
}

function synthesizeFinalMessage(request: ProviderChatRequest, summary: AgentLoopSummary, reason: string): string {
  const files = [...summary.changedFiles].sort();
  const commandLines = summary.commands.map(commandStatus);
  return [
    reason,
    "",
    "Files changed:",
    files.length > 0 ? files.map((file) => `- ${file}`).join("\n") : "- None detected",
    "",
    "Commands run:",
    commandLines.length > 0 ? commandLines.join("\n") : "- None",
    "",
    `Next command: ${nextCommand(request, summary)}`,
  ].join("\n").trim();
}

async function requestFinalAnswer(options: RunAgentLoopOptions, messages: AgentChatMessage[], toolCallCount: number, reason: string): Promise<string | null> {
  messages.push({
    role: "user",
    content: [
      reason,
      "Stop calling tools now. Write the final answer using the tool results already provided.",
      "Include files changed, commands run, whether they succeeded, and the next command the user can run.",
    ].join("\n"),
  });
  const response = await options.sendMessages(messages, toolCallCount);
  const parsed = parseAgentToolCall(response.text);
  return parsed.kind === "final" && parsed.text.trim() ? parsed.text.trim() : null;
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<string> {
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const messages = buildInitialMessages(options.request, options.includeSystemPrompt);
  let toolCallCount = 0;
  let previousToolSignature: string | null = null;
  const summary: AgentLoopSummary = {
    changedFiles: new Set(),
    commands: [],
    toolResults: [],
  };

  while (true) {
    if (options.signal?.aborted) {
      throw new Error("Local agent run was canceled.");
    }

    const response = await options.sendMessages(messages, toolCallCount);
    const structuredToolCall = response.toolCalls?.[0] ?? null;
    const parsed = structuredToolCall
      ? { kind: "tool_call" as const, ...structuredToolCall, raw: JSON.stringify(structuredToolCall) }
      : parseAgentToolCall(response.text);

    if (parsed.kind === "final") {
      return parsed.text.trim();
    }

    if (toolCallCount >= maxToolCalls) {
      const reason = `Local agent reached ${maxToolCalls} tool calls without a final answer.`;
      const final = await requestFinalAnswer(options, messages, toolCallCount, reason);
      return final ?? synthesizeFinalMessage(options.request, summary, reason);
    }

    if (parsed.kind === "malformed_tool_call") {
      messages.push({ role: "assistant", content: response.text });
      toolCallCount += 1;
      messages.push({
        role: "user",
        content: serializeToolResult({
          success: false,
          error: `Malformed tool call: ${parsed.error}`,
          raw: parsed.raw,
        }),
      });
      continue;
    }

    const signature = toolCallSignature(parsed);
    if (signature === previousToolSignature) {
      const reason = `Local agent repeated the same ${parsed.name} tool call with identical arguments.`;
      const final = await requestFinalAnswer(options, messages, toolCallCount, reason);
      return final ?? synthesizeFinalMessage(options.request, summary, reason);
    }

    messages.push({ role: "assistant", content: response.text || parsed.raw });
    previousToolSignature = signature;
    toolCallCount += 1;
    const activityId = `local-agent-${toolCallCount}-${parsed.name}`;
    const startedAt = Date.now();
    const runningCommand = toolActivityCommand({
      tool: parsed.name,
      path: typeof parsed.arguments.path === "string" ? parsed.arguments.path : undefined,
      command: typeof parsed.arguments.command === "string" ? parsed.arguments.command : undefined,
    });
    options.handlers.onToolActivity?.({
      id: activityId,
      command: runningCommand,
      status: "running",
      startedAt,
    });

    const result = await executeAgentTool(parsed.name, parsed.arguments, {
      workspaceRoot: options.request.workspaceRoot,
      runtime: options.request.runtime,
      signal: options.signal,
    });
    const completedCommand = toolActivityCommand(result);
    options.handlers.onToolActivity?.({
      id: activityId,
      command: completedCommand,
      status: result.success ? "completed" : "failed",
      startedAt,
      completedAt: Date.now(),
      summary: result.summary ?? result.error ?? null,
    });
    recordToolResult(summary, result);

    messages.push({
      role: "user",
      content: serializeToolResult(result),
    });
  }

  throw new Error(`Local agent stopped after ${maxToolCalls} tool calls without a final answer.`);
}
