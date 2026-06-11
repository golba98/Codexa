import type { BackendRunHandlers } from "../providers/types.js";
import type { ProviderChatRequest } from "../providerRuntime/types.js";
import { executeAgentTool, type AgentToolResult } from "./tools.js";
import { parseAgentToolCall, serializeToolResult } from "./protocol.js";

export interface AgentChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface AgentChatResponse {
  text: string;
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

function localAgentSystemPrompt(request: ProviderChatRequest): string {
  return [
    `You are an autonomous coding assistant running inside this workspace: ${request.workspaceRoot}`,
    "You must inspect files with tools before claiming you cannot see them.",
    "Use tools to create, edit, build, and test when the user asks for workspace changes.",
    "Do not ask vague clarification questions when the user's intent has an obvious safe implementation.",
    "Use exactly one tool call at a time in this format:",
    '<tool_call>{"name":"read_file","arguments":{"path":"src/index.tsx"}}</tool_call>',
    "Available tools: list_files, read_file, write_file, apply_patch, run_shell, get_workspace_info.",
    "Summarize changed files and commands run in your final answer.",
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

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<string> {
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const messages = buildInitialMessages(options.request, options.includeSystemPrompt);

  for (let index = 0; index <= maxToolCalls; index += 1) {
    if (options.signal?.aborted) {
      throw new Error("Local agent run was canceled.");
    }

    const response = await options.sendMessages(messages, index);
    const parsed = parseAgentToolCall(response.text);

    if (parsed.kind === "final") {
      return parsed.text.trim();
    }

    messages.push({ role: "assistant", content: response.text });

    if (index >= maxToolCalls) {
      throw new Error(`Local agent stopped after ${maxToolCalls} tool calls without a final answer.`);
    }

    if (parsed.kind === "malformed_tool_call") {
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

    const activityId = `local-agent-${index}-${parsed.name}`;
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

    messages.push({
      role: "user",
      content: serializeToolResult(result),
    });
  }

  throw new Error(`Local agent stopped after ${maxToolCalls} tool calls without a final answer.`);
}
