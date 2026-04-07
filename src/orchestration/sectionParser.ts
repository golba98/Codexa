/**
 * Section parser — parses structured output from Codex into UI events.
 * Handles streaming chunks and routes content to appropriate panels.
 */

import type { ResultSectionType, ToolActivityStatus, UIEvent } from "./events.js";

// ─── Section Markers ──────────────────────────────────────────────────────────

const SECTION_PATTERNS = {
  STATUS: /^\[STATUS\]\s*/i,
  THINKING: /^\[THINKING\]\s*/i,
  ANALYSIS: /^\[ANALYSIS\]\s*/i,
  FILE: /^\[FILE:?\s*([^\]]*)\]\s*/i,
  RESULT: /^\[RESULT\]\s*/i,
  SUGGESTION: /^\[SUGGESTION\]\s*/i,
  IMPLEMENTATION: /^\[IMPLEMENTATION\]\s*/i,
  DIFF: /^\[DIFF:?\s*([^\]]*)\]\s*/i,
  COMMAND: /^\[COMMAND\]\s*/i,
  WARNING: /^\[WARNING\]\s*/i,
  ERROR: /^\[ERROR\]\s*/i,
  END: /^\[END\]\s*/i,
  SUMMARY: /^\[SUMMARY\]\s*/i,
} as const;

type SectionType = keyof typeof SECTION_PATTERNS;

// ─── Parser State ─────────────────────────────────────────────────────────────

interface ParserState {
  buffer: string;
  currentSection: SectionType | null;
  currentSectionContent: string;
  currentSectionMeta: string | null;
  lineBuffer: string;
  toolCounter: number;
}

// ─── Parser Handlers ──────────────────────────────────────────────────────────

export interface SectionParserHandlers {
  onEvent: (event: UIEvent) => void;
  onRawContent?: (content: string) => void;
}

// ─── Section Parser ───────────────────────────────────────────────────────────

export function createSectionParser(handlers: SectionParserHandlers) {
  const state: ParserState = {
    buffer: "",
    currentSection: null,
    currentSectionContent: "",
    currentSectionMeta: null,
    lineBuffer: "",
    toolCounter: 0,
  };

  const { onEvent, onRawContent } = handlers;

  // ─── Section Finalization ─────────────────────────────────────────────────

  function flushSection(): void {
    if (!state.currentSection) return;

    const content = state.currentSectionContent.trim();
    if (!content) {
      state.currentSection = null;
      state.currentSectionContent = "";
      state.currentSectionMeta = null;
      return;
    }

    switch (state.currentSection) {
      case "STATUS":
        onEvent({ type: "status", message: content });
        break;

      case "THINKING":
        onEvent({ type: "thinking:update", summary: content });
        break;

      case "ANALYSIS":
        onEvent({
          type: "assistant:section",
          section: "analysis" as ResultSectionType,
          content,
        });
        break;

      case "FILE":
        onEvent({
          type: "files:item",
          path: state.currentSectionMeta ?? "unknown",
          status: "analyzed",
          reason: content.split("\n")[0] ?? undefined,
        });
        break;

      case "RESULT":
        onEvent({
          type: "assistant:section",
          section: "suggestion" as ResultSectionType,
          content,
        });
        break;

      case "SUGGESTION":
        onEvent({
          type: "assistant:section",
          section: "suggestion" as ResultSectionType,
          content,
        });
        break;

      case "IMPLEMENTATION":
        onEvent({
          type: "assistant:section",
          section: "implementation" as ResultSectionType,
          content,
        });
        break;

      case "SUMMARY":
        onEvent({
          type: "assistant:section",
          section: "summary" as ResultSectionType,
          content,
        });
        break;

      case "DIFF":
        onEvent({
          type: "diff:content",
          file: state.currentSectionMeta ?? "unknown",
          patch: content,
          language: detectDiffLanguage(state.currentSectionMeta ?? ""),
        });
        onEvent({
          type: "diff:done",
          file: state.currentSectionMeta ?? "unknown",
        });
        break;

      case "COMMAND":
        onEvent({
          type: "command",
          content,
          copyable: true,
        });
        break;

      case "WARNING":
        onEvent({ type: "warning", message: content });
        break;

      case "ERROR":
        onEvent({ type: "error", message: content });
        break;
    }

    state.currentSection = null;
    state.currentSectionContent = "";
    state.currentSectionMeta = null;
  }

  // ─── Line Processing ──────────────────────────────────────────────────────

  function processLine(line: string): void {
    // Check for section markers
    for (const [name, pattern] of Object.entries(SECTION_PATTERNS)) {
      const match = line.match(pattern);
      if (match) {
        // Flush previous section
        flushSection();

        // Handle END marker
        if (name === "END") {
          state.currentSection = null;
          return;
        }

        // Start new section
        state.currentSection = name as SectionType;
        state.currentSectionMeta = match[1]?.trim() ?? null;

        // Include remainder after marker
        const remainder = line.replace(pattern, "");
        if (remainder.trim()) {
          state.currentSectionContent += remainder + "\n";
        }
        return;
      }
    }

    // Accumulate content if in section
    if (state.currentSection) {
      state.currentSectionContent += line + "\n";
      return;
    }

    // Raw content (no section)
    if (onRawContent) {
      onRawContent(line);
    } else {
      // Default: treat as partial assistant content
      onEvent({ type: "assistant:partial", content: line + "\n" });
    }
  }

  // ─── Public Interface ─────────────────────────────────────────────────────

  return {
    /**
     * Feed a chunk of streamed content.
     */
    feed(chunk: string): void {
      state.buffer += chunk;

      // Normalize line endings
      const normalized = state.buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = normalized.split("\n");

      // Keep last incomplete line in buffer
      state.buffer = lines.pop() ?? "";

      // Process complete lines
      for (const line of lines) {
        processLine(line);
      }
    },

    /**
     * Flush any remaining content.
     */
    flush(): void {
      // Process remaining buffer
      if (state.buffer) {
        processLine(state.buffer);
        state.buffer = "";
      }

      // Flush final section
      flushSection();
    },

    /**
     * Reset parser state.
     */
    reset(): void {
      state.buffer = "";
      state.currentSection = null;
      state.currentSectionContent = "";
      state.currentSectionMeta = null;
      state.lineBuffer = "";
      state.toolCounter = 0;
    },

    /**
     * Get current section (for debugging).
     */
    getCurrentSection(): SectionType | null {
      return state.currentSection;
    },
  };
}

// ─── Heuristic Parsers ────────────────────────────────────────────────────────

/**
 * Detect programming language from file extension.
 */
function detectDiffLanguage(filename: string): string | undefined {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;

  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
    sh: "bash",
    bash: "bash",
    zsh: "zsh",
    ps1: "powershell",
    sql: "sql",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    md: "markdown",
  };

  return langMap[ext];
}

/**
 * Try to detect tool activity from raw output.
 * Used when Codex output doesn't use structured markers.
 */
export function parseToolActivity(
  line: string,
): { name: string; command?: string; status: ToolActivityStatus } | null {
  // Match patterns like:
  // $ command
  // > command
  // [running: command]
  // executing: command

  const execPatterns = [
    /^\s*\$\s+(.+)/,
    /^\s*>\s+(.+)/,
    /^\s*\[(running|executing):?\s*(.+?)\]\s*$/i,
    /^\s*(running|executing):?\s+(.+)/i,
  ];

  for (const pattern of execPatterns) {
    const match = line.match(pattern);
    if (match) {
      const command = match[2] ?? match[1] ?? line;
      return {
        name: "shell",
        command: command.trim(),
        status: "running",
      };
    }
  }

  // Match completion patterns
  const donePatterns = [
    /^\s*\[(done|completed|finished|success)\]/i,
    /^\s*(done|completed|finished|success):\s*/i,
  ];

  for (const pattern of donePatterns) {
    if (pattern.test(line)) {
      return {
        name: "shell",
        status: "completed",
      };
    }
  }

  // Match failure patterns
  const failPatterns = [
    /^\s*\[(failed|error|failure)\]/i,
    /^\s*(failed|error|failure):\s*/i,
  ];

  for (const pattern of failPatterns) {
    if (pattern.test(line)) {
      return {
        name: "shell",
        status: "failed",
      };
    }
  }

  return null;
}

/**
 * Parse diff content from fenced code blocks.
 */
export function parseDiffBlock(content: string): { file: string; patch: string }[] {
  const diffs: { file: string; patch: string }[] = [];

  // Match ```diff or ```<filename> blocks
  const blockPattern = /```(?:diff|(\S+\.\w+))\s*\n([\s\S]*?)```/g;

  let match;
  while ((match = blockPattern.exec(content)) !== null) {
    const file = match[1] ?? "unknown";
    const patch = match[2]?.trim() ?? "";
    if (patch) {
      diffs.push({ file, patch });
    }
  }

  return diffs;
}

/**
 * Extract thinking/reasoning from markdown headers or bullet points.
 */
export function parseThinkingContent(content: string): string[] {
  const summaries: string[] = [];

  // Match "## Thinking" or "### Analysis" sections
  const sectionPattern = /^#{2,3}\s*(thinking|analysis|reasoning|approach|plan)\s*$/im;
  const sectionMatch = content.match(sectionPattern);

  if (sectionMatch) {
    const startIndex = sectionMatch.index! + sectionMatch[0].length;
    const nextSectionMatch = content.slice(startIndex).match(/^#{2,3}\s/m);
    const endIndex = nextSectionMatch
      ? startIndex + (nextSectionMatch.index ?? content.length)
      : content.length;

    const sectionContent = content.slice(startIndex, endIndex).trim();
    const bullets = sectionContent.match(/^[-*]\s+(.+)$/gm);
    if (bullets) {
      for (const bullet of bullets) {
        const text = bullet.replace(/^[-*]\s+/, "").trim();
        if (text) summaries.push(text);
      }
    }
  }

  // Also match standalone "thinking:" prefixes
  const thinkingLines = content.match(/^thinking:\s*(.+)$/gim);
  if (thinkingLines) {
    for (const line of thinkingLines) {
      const text = line.replace(/^thinking:\s*/i, "").trim();
      if (text) summaries.push(text);
    }
  }

  return summaries;
}

/**
 * Extract commands from fenced code blocks marked as shell/bash.
 */
export function parseCommandBlocks(content: string): string[] {
  const commands: string[] = [];

  // Match ```bash, ```sh, ```shell, ```powershell blocks
  const blockPattern = /```(?:bash|sh|shell|powershell|zsh|cmd)\s*\n([\s\S]*?)```/g;

  let match;
  while ((match = blockPattern.exec(content)) !== null) {
    const command = match[1]?.trim();
    if (command) {
      commands.push(command);
    }
  }

  return commands;
}

// ─── Hybrid Parser ────────────────────────────────────────────────────────────

/**
 * Create a hybrid parser that handles both structured and unstructured output.
 * Falls back to heuristic parsing when markers aren't present.
 */
export function createHybridParser(handlers: SectionParserHandlers) {
  const structuredParser = createSectionParser(handlers);
  const { onEvent } = handlers;

  let hasSeenStructuredMarker = false;
  let unstructuredBuffer = "";

  return {
    feed(chunk: string): void {
      // Check if this chunk contains structured markers
      const hasMarker = Object.values(SECTION_PATTERNS).some((pattern) =>
        pattern.test(chunk),
      );

      if (hasMarker) {
        hasSeenStructuredMarker = true;

        // If we have buffered unstructured content, flush it first
        if (unstructuredBuffer) {
          processUnstructuredContent(unstructuredBuffer, onEvent);
          unstructuredBuffer = "";
        }
      }

      if (hasSeenStructuredMarker) {
        structuredParser.feed(chunk);
      } else {
        // Buffer unstructured content
        unstructuredBuffer += chunk;
      }
    },

    flush(): void {
      if (hasSeenStructuredMarker) {
        structuredParser.flush();
      } else if (unstructuredBuffer) {
        processUnstructuredContent(unstructuredBuffer, onEvent);
        unstructuredBuffer = "";
      }
    },

    reset(): void {
      structuredParser.reset();
      hasSeenStructuredMarker = false;
      unstructuredBuffer = "";
    },
  };
}

/**
 * Process unstructured content using heuristics.
 */
function processUnstructuredContent(
  content: string,
  onEvent: (event: UIEvent) => void,
): void {
  // Extract thinking content
  const thinkingSummaries = parseThinkingContent(content);
  for (const summary of thinkingSummaries) {
    onEvent({ type: "thinking:update", summary });
  }

  // Extract diffs
  const diffs = parseDiffBlock(content);
  for (const diff of diffs) {
    onEvent({ type: "diff:start", file: diff.file });
    onEvent({
      type: "diff:content",
      file: diff.file,
      patch: diff.patch,
      language: detectDiffLanguage(diff.file),
    });
    onEvent({ type: "diff:done", file: diff.file });
  }

  // Extract commands
  const commands = parseCommandBlocks(content);
  for (const command of commands) {
    onEvent({ type: "command", content: command, copyable: true });
  }

  // Send main content
  // Remove already-extracted sections for cleaner output
  let cleanContent = content;

  // Remove thinking sections
  cleanContent = cleanContent.replace(
    /^#{2,3}\s*(thinking|analysis|reasoning|approach|plan)\s*\n[\s\S]*?(?=^#{2,3}|\Z)/gim,
    "",
  );

  // Remove diff blocks (already processed)
  cleanContent = cleanContent.replace(/```(?:diff|\S+\.\w+)\s*\n[\s\S]*?```/g, "");

  // Remove command blocks (already processed)
  cleanContent = cleanContent.replace(/```(?:bash|sh|shell|powershell|zsh|cmd)\s*\n[\s\S]*?```/g, "");

  const trimmedContent = cleanContent.trim();
  if (trimmedContent) {
    onEvent({ type: "assistant:final", content: trimmedContent });
  }
}
