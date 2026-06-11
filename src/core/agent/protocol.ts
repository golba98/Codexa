export type AgentToolName =
  | "list_files"
  | "read_file"
  | "write_file"
  | "apply_patch"
  | "run_shell"
  | "get_workspace_info";

export interface ParsedAgentToolCall {
  kind: "tool_call";
  name: AgentToolName;
  arguments: Record<string, unknown>;
  raw: string;
}

export interface MalformedAgentToolCall {
  kind: "malformed_tool_call";
  raw: string;
  error: string;
}

export type AgentToolParseResult =
  | { kind: "final"; text: string }
  | ParsedAgentToolCall
  | MalformedAgentToolCall;

const TOOL_CALL_PATTERN = /<tool_call>([\s\S]*?)<\/tool_call>/i;

const TOOL_NAMES = new Set<AgentToolName>([
  "list_files",
  "read_file",
  "write_file",
  "apply_patch",
  "run_shell",
  "get_workspace_info",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAgentToolCall(text: string): AgentToolParseResult {
  const match = TOOL_CALL_PATTERN.exec(text);
  if (!match) {
    return { kind: "final", text };
  }

  const raw = match[1]?.trim() ?? "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return { kind: "malformed_tool_call", raw, error: "Tool call JSON must be an object." };
    }

    const rawName = parsed.name ?? parsed.tool;
    if (typeof rawName !== "string" || !TOOL_NAMES.has(rawName as AgentToolName)) {
      return { kind: "malformed_tool_call", raw, error: `Unknown or missing tool name: ${String(rawName ?? "")}` };
    }

    const args = parsed.arguments ?? parsed.args ?? {};
    if (!isRecord(args)) {
      return { kind: "malformed_tool_call", raw, error: "Tool call arguments must be an object." };
    }

    return {
      kind: "tool_call",
      name: rawName as AgentToolName,
      arguments: args,
      raw,
    };
  } catch (error) {
    return {
      kind: "malformed_tool_call",
      raw,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function serializeToolResult(result: unknown): string {
  return [
    "Tool result:",
    JSON.stringify(result, null, 2),
  ].join("\n");
}
