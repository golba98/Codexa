import type { RunToolActivity } from "../../session/types.js";

const ANSI_ESCAPE_PATTERN =
  // Strip ANSI color/control sequences before attempting transcript parsing.
  /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const NOISE_EXACT_LINES = new Set([
  "reading additional input from stdin...",
  "tokens used",
  "user",
  "codex",
  "assistant",
  // Injected system-prompt lines (from buildCodexPrompt) that the backend echoes back
  "the user request below is the task to handle now.",
  "do not reply with generic readiness or ask what they want changed if the request is already specific.",
  "if the request is actionable, make the change in the workspace before responding.",
  "you are running inside the user's current workspace with write access.",
  "only ask a follow-up question if a required detail is truly missing and blocks the work.",
  "after doing the work, summarize what changed.",
  "you are in read-only mode, so inspect files and answer carefully, but do not claim to have edited files unless you actually could.",
  "task:",
]);

const NOISE_PREFIXES = [
  "OpenAI Codex v",
  "workdir:",
  "model:",
  "provider:",
  "approval:",
  "sandbox:",
  "reasoning effort:",
  "reasoning summaries:",
  "session id:",
  "auth:",
  "tokens used",     // catches "tokens used", "tokens used:", "tokens used1,969", etc.
  "act with strong autonomy",
  "act like a coding agent",
];

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, "");
}

// Keep line breaks but drop control bytes that can move or corrupt terminal cursor/layout.
export function stripNonPrintableControls(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

type TranscriptSection = "preamble" | "task" | "user" | "assistant" | "tool_output" | "postlude";

export interface CodexTranscriptStreamHandlers {
  onThinkingLine?: (line: string) => void;
  onAssistantDelta?: (chunk: string) => void;
  onToolActivity?: (activity: RunToolActivity) => void;
}

export function normalizeLines(raw: string): string[] {
  return stripNonPrintableControls(stripAnsi(raw))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""));
}

function isDivider(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && /^-+$/.test(trimmed);
}

export function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isDivider(trimmed)) return true;
  if (NOISE_EXACT_LINES.has(trimmed.toLowerCase())) return true;

  const lower = trimmed.toLowerCase();
  return NOISE_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()));
}

function isAssistantLabel(line: string): boolean {
  const lower = line.trim().toLowerCase();
  return lower === "assistant" || lower === "codex";
}

// Detect lines that mark the start of tool/shell execution output from the
// codex backend.  When the backend runs commands (Get-ChildItem, rg, etc.) it
// often emits markers like "$ cmd", "> cmd", "tool_call: shell", or fenced
// code blocks tagged with "ex"/"shell"/"output".  These should be hidden from
// the user and routed to the thinking stream instead.
const TOOL_EXEC_PATTERNS = [
  /^\s*\$\s+\S/,                    // $ Get-ChildItem, $ rg --files …
  /^\s*>\s+\S/,                     // > Get-ChildItem (PowerShell prompt)
  /^\s*tool_call\s*:/i,             // tool_call: shell
  /^\s*```\s*(ex|shell|bash|powershell|output|cmd)\s*$/i,  // fenced execution block
  /^\s*\[running:?\s/i,             // [running: Get-ChildItem]
  /^\s*\[exec(uting)?:?\s/i,        // [exec: rg --files]
  /^\s*executing\s*:/i,             // executing: Get-ChildItem
];

function isToolExecStart(line: string): boolean {
  return TOOL_EXEC_PATTERNS.some((pattern) => pattern.test(line));
}

function isToolExecEnd(line: string): boolean {
  const trimmed = line.trim();
  // A closing fence (```) or a blank line after tool output ends the block
  return trimmed === "```" || trimmed === "";
}

function shouldIgnoreStreamingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isDivider(trimmed)) return true;
  if (trimmed.toLowerCase() === "tokens used") return true;
  if (isNoiseLine(trimmed)) return true;
  return false;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function looksLikePath(line: string): boolean {
  return /[\\/]/.test(line) || /\.[a-z0-9_-]+$/i.test(line);
}

function summarizeToolOutput(command: string, outputLines: string[]): {
  status: RunToolActivity["status"];
  summary: string;
} {
  const lines = outputLines.map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { status: "completed", summary: "Completed with no output" };
  }

  const firstLine = lines[0]!;
  const lowerCommand = command.toLowerCase();
  const failurePattern = /(error|exception|fatal|failed|permission denied|not recognized|not found)/i;
  if (failurePattern.test(firstLine)) {
    return { status: "failed", summary: firstLine };
  }

  if (/\brg\b/.test(lowerCommand) && /--files\b/.test(lowerCommand)) {
    return { status: "completed", summary: `Found ${pluralize(lines.length, "file")}` };
  }

  if (/\b(get-childitem|ls|dir)\b/.test(lowerCommand)) {
    const noun = lines.every(looksLikePath) ? "item" : "line";
    return { status: "completed", summary: `Listed ${pluralize(lines.length, noun)}` };
  }

  if (/\b(rg|grep|select-string|findstr)\b/.test(lowerCommand)) {
    return { status: "completed", summary: `Found ${pluralize(lines.length, "match", "matches")}` };
  }

  if (lines.length === 1) {
    return { status: "completed", summary: firstLine };
  }

  if (lines.every(looksLikePath)) {
    return { status: "completed", summary: `Returned ${pluralize(lines.length, "path")}` };
  }

  return { status: "completed", summary: `Produced ${pluralize(lines.length, "line")} of output` };
}

export function createCodexTranscriptStreamParser(handlers: CodexTranscriptStreamHandlers) {
  let pending = "";
  let section: TranscriptSection = "preamble";
  let emittedAssistantLine = false;
  let toolCounter = 0;
  let activeTool: {
    id: string;
    command: string;
    startedAt: number;
    outputLines: string[];
  } | null = null;

  const emitThinking = (line: string) => {
    const cleaned = line.replace(/\s+$/g, "");
    if (!cleaned.trim()) return;
    handlers.onThinkingLine?.(cleaned);
  };

  const emitAssistant = (line: string) => {
    const cleaned = line.replace(/\s+$/g, "");
    if (!cleaned && !emittedAssistantLine) return;
    const chunk = emittedAssistantLine ? `\n${cleaned}` : cleaned;
    handlers.onAssistantDelta?.(chunk);
    emittedAssistantLine = true;
  };

  const finalizeActiveTool = () => {
    if (!activeTool) return;

    const result = summarizeToolOutput(activeTool.command, activeTool.outputLines);
    handlers.onToolActivity?.({
      id: activeTool.id,
      command: activeTool.command,
      status: result.status,
      startedAt: activeTool.startedAt,
      completedAt: Date.now(),
      summary: result.summary,
    });
    activeTool = null;
  };

  const startToolCapture = (rawCommand: string) => {
    finalizeActiveTool();
    toolCounter += 1;
    activeTool = {
      id: `tool-${toolCounter}`,
      command: rawCommand,
      startedAt: Date.now(),
      outputLines: [],
    };
    handlers.onToolActivity?.({
      id: activeTool.id,
      command: activeTool.command,
      status: "running",
      startedAt: activeTool.startedAt,
    });
  };

  const processLine = (rawLine: string) => {
    const line = stripNonPrintableControls(stripAnsi(rawLine)).replace(/\r/g, "");
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (section === "postlude") {
      return;
    }

    if (lower === "tokens used") {
      section = "postlude";
      return;
    }

    if (lower === "task:") {
      section = "task";
      return;
    }

    if (isAssistantLabel(line)) {
      section = "assistant";
      return;
    }

    if (lower === "user") {
      section = "user";
      return;
    }

    if (shouldIgnoreStreamingLine(line)) {
      return;
    }

    if (section === "task") {
      if (!trimmed) {
        section = "preamble";
      }
      return;
    }

    // When inside a tool_output block, swallow lines until the block ends,
    // then resume the assistant section.
    if (section === "tool_output") {
      if (isToolExecEnd(line)) {
        finalizeActiveTool();
        section = "assistant";
        return;
      }
      if (activeTool && trimmed) {
        activeTool.outputLines.push(line);
      }
      return;
    }

    if (section === "assistant") {
      // Detect start of an inline tool execution block and switch to
      // tool_output mode so the raw stdout is hidden from the user.
      if (isToolExecStart(line)) {
        const cmd = trimmed
          .replace(/^\s*[$>]\s+/, "")
          .replace(/^\s*tool_call\s*:\s*/i, "")
          .replace(/^\s*```\s*/i, "")
          .replace(/^\s*\[(running|exec|executing):?\s*/i, "")
          .replace(/\]\s*$/, "");
        if (cmd) startToolCapture(cmd);
        section = "tool_output";
        return;
      }

      emitAssistant(line);
      return;
    }

    if (!trimmed) {
      return;
    }

    emitThinking(line);
  };

  const feed = (chunk: string) => {
    pending += chunk;
    const normalized = pending.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n");
    pending = lines.pop() ?? "";

    for (const line of lines) {
      processLine(line);
    }
  };

  const flush = () => {
    if (pending) {
      processLine(pending);
      pending = "";
    }
    finalizeActiveTool();
  };

  return { feed, flush };
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]?.trim() === "") start += 1;
  while (end > start && lines[end - 1]?.trim() === "") end -= 1;

  return lines.slice(start, end);
}

function stripToolOutputBlocks(lines: string[]): string[] {
  const visible: string[] = [];
  let inToolOutput = false;

  for (const line of lines) {
    if (inToolOutput) {
      if (isToolExecEnd(line)) {
        inToolOutput = false;
      }
      continue;
    }

    if (isToolExecStart(line)) {
      inToolOutput = true;
      continue;
    }

    visible.push(line);
  }

  return visible;
}

function dedupeTrailingRepeat(lines: string[]): string[] {
  if (lines.length < 2) return lines;

  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] === line && line.trim()) continue;
    deduped.push(line);
  }
  return deduped;
}

function extractLabeledAssistantBlock(lines: string[]): string[] {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index]?.trim().toLowerCase();
    if (trimmed !== "codex" && trimmed !== "assistant") continue;

    const block: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? "";
      const normalized = line.trim().toLowerCase();
      if (normalized === "user" || normalized === "codex" || normalized === "assistant") break;
      if (normalized.startsWith("tokens used")) break;
      if (isDivider(line)) continue;
      if (NOISE_PREFIXES.some((prefix) => normalized.startsWith(prefix.toLowerCase()))) break;
      block.push(line);
    }

    const cleaned = trimBlankEdges(stripToolOutputBlocks(block));
    if (cleaned.length > 0) {
      return dedupeTrailingRepeat(cleaned);
    }
  }

  return [];
}

// Handles backends that echo the full injected prompt (Task: + user message) before
// their response, without an "assistant" label.  Finds the last "Task:" line, skips
// past the user's prompt text that follows it, then treats everything after as the
// actual response.
function extractAfterTaskSection(lines: string[]): string[] {
  let taskIdx = -1;
  for (let k = lines.length - 1; k >= 0; k--) {
    if (lines[k]!.trim().toLowerCase() === "task:") {
      taskIdx = k;
      break;
    }
  }
  if (taskIdx === -1) return [];

  // Skip the "Task:" line and the user-prompt lines that follow (until blank or noise)
  let i = taskIdx + 1;
  while (i < lines.length && lines[i]!.trim() !== "") i++;
  // Skip any blank separator lines
  while (i < lines.length && lines[i]!.trim() === "") i++;

  const rest = lines.slice(i);
  const filtered = trimBlankEdges(
    stripToolOutputBlocks(rest).filter((line) => {
      if (!line.trim()) return true;
      return !isNoiseLine(line);
    }),
  );

  return dedupeTrailingRepeat(filtered);
}

export function sanitizeCodexTranscript(raw: string): string {
  const lines = normalizeLines(raw);

  // 1. Prefer a properly labeled "assistant:" / "codex:" block
  const labeled = extractLabeledAssistantBlock(lines);
  if (labeled.length > 0) {
    return labeled.join("\n").trim();
  }

  // 2. If the backend echoed the full prompt (Task: … user message …) without a label,
  //    extract everything that comes after the task section.
  const afterTask = extractAfterTaskSection(lines);
  if (afterTask.length > 0) {
    return afterTask.join("\n").trim();
  }

  // 3. Last resort: strip all known noise and return what's left.
  const filtered = trimBlankEdges(
    stripToolOutputBlocks(lines).filter((line) => {
      if (!line.trim()) return true;
      return !isNoiseLine(line);
    }),
  );

  if (filtered.length === 0) {
    return "Codex completed successfully, but no assistant response text was detected.";
  }

  return dedupeTrailingRepeat(filtered).join("\n").trim();
}
