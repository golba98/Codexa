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

export interface NormalizedAgentToolCall {
  name: AgentToolName;
  arguments: Record<string, unknown>;
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
const TOOL_CALL_OPEN_PATTERN = /<tool_call\b[^>]*>/i;

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

function parseJsonMaybeWithExtraBrace(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (firstError) {
    const trimmed = raw.trim();
    if (trimmed.endsWith("}")) {
      try {
        return JSON.parse(trimmed.slice(0, -1)) as unknown;
      } catch {
        // Return the original parse error below.
      }
    }
    throw firstError;
  }
}

function parseArguments(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return {};
  if (isRecord(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function normalizeAgentToolCall(value: unknown): NormalizedAgentToolCall | null {
  if (!isRecord(value)) return null;

  const functionCall = isRecord(value.function) ? value.function : null;
  const rawName = functionCall?.name ?? value.name ?? value.tool;
  if (typeof rawName !== "string" || !TOOL_NAMES.has(rawName as AgentToolName)) {
    return null;
  }

  const args = parseArguments(functionCall?.arguments ?? value.arguments ?? value.args);
  if (!args) return null;

  return {
    name: rawName as AgentToolName,
    arguments: args,
  };
}

export function parseOpenAiToolCalls(value: unknown): NormalizedAgentToolCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeAgentToolCall(item))
    .filter((item): item is NormalizedAgentToolCall => Boolean(item));
}

function extractJsonObjectAfterToolCall(text: string): string | null {
  const open = TOOL_CALL_OPEN_PATTERN.exec(text);
  if (!open) return null;

  const startSearch = open.index + open[0].length;
  const firstBrace = text.indexOf("{", startSearch);
  if (firstBrace < 0) return text.slice(startSearch).trim();

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = firstBrace; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(firstBrace, index + 1).trim();
      }
    }
  }

  return text.slice(firstBrace).replace(/<\/tool_call>.*/is, "").trim();
}

function parseToolCallPayload(raw: string): AgentToolParseResult {
  try {
    const parsed = parseJsonMaybeWithExtraBrace(raw);
    const fromToolCalls = isRecord(parsed) ? parseOpenAiToolCalls(parsed.tool_calls) : [];
    const normalized = fromToolCalls[0] ?? normalizeAgentToolCall(parsed);
    if (!normalized) {
      return { kind: "malformed_tool_call", raw, error: "Tool call JSON did not contain a supported tool call." };
    }

    return {
      kind: "tool_call",
      ...normalized,
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

export function parseAgentToolCall(text: string): AgentToolParseResult {
  const closedMatch = TOOL_CALL_PATTERN.exec(text);
  const raw = closedMatch?.[1]?.trim() ?? extractJsonObjectAfterToolCall(text);
  if (!raw) {
    return TOOL_CALL_OPEN_PATTERN.test(text)
      ? { kind: "malformed_tool_call", raw: "", error: "Tool call block did not contain JSON." }
      : { kind: "final", text };
  }

  return parseToolCallPayload(raw);
}

export function serializeToolResult(result: unknown): string {
  return [
    "Tool result:",
    JSON.stringify(result, null, 2),
  ].join("\n");
}
