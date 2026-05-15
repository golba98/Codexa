import { APP_NAME, type TerminalTitleMode, formatTerminalTitlePath } from "../config/settings.js";
import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

export const DEFAULT_TERMINAL_TITLE = APP_NAME;

const DEBUG_TERMINAL_TITLE = Boolean(process.env["CODEXA_DEBUG_TERMINAL_TITLE"]);
const TERMINAL_TITLE_SEQUENCE_PATTERN = /\x1b\](?:0|2);[^\x07]*(?:\x07|\x1b\\)/g;
const TERMINAL_TITLE_SEQUENCE_DETECT_PATTERN = /\x1b\]([02]);([\s\S]*?)(?:\x07|\x1b\\)/g;
const INCOMPLETE_TERMINAL_TITLE_SEQUENCE_PATTERN = /\x1b\](?:0|2);[^\x07]*$/;
const TERMINAL_TITLE_DEBUG_LOG_PATH = process.env["CODEXA_TERMINAL_TITLE_DEBUG_FILE"]?.trim()
  || join(process.cwd(), ".codexa-debug", "terminal-title-debug.log");

let terminalTitleLifecycleState = "unknown";

function debugLog(msg: string): void {
  if (DEBUG_TERMINAL_TITLE) {
    process.stderr.write(`[codexa:terminal-title] ${msg}\n`);
  }
}

function writeTerminalTitleDebugRecord(fields: Record<string, unknown>): void {
  if (!DEBUG_TERMINAL_TITLE) return;
  try {
    mkdirSync(dirname(TERMINAL_TITLE_DEBUG_LOG_PATH), { recursive: true });
    appendFileSync(
      TERMINAL_TITLE_DEBUG_LOG_PATH,
      JSON.stringify({
        ts: Date.now(),
        pid: process.pid,
        lifecycleState: terminalTitleLifecycleState,
        ...fields,
      }) + "\n",
      "utf8",
    );
  } catch {
    // Diagnostics must never disturb the TUI.
  }
}

let lastWrittenTerminalTitle = "";
let intendedTerminalTitle = DEFAULT_TERMINAL_TITLE;

/** FOR TESTING ONLY: Reset the cached title. */
export function __resetTerminalTitleCache() {
  lastWrittenTerminalTitle = "";
  intendedTerminalTitle = DEFAULT_TERMINAL_TITLE;
}

export function setTerminalTitleLifecycleState(state: string): void {
  terminalTitleLifecycleState = state;
}

export interface TerminalTitleOptions {
  force?: boolean;
  /** Optional custom write function, e.g. for testing or using a specific stdout/stderr instance. */
  write?: (chunk: string) => void;
  reason?: string;
}

function looksLikeRawWindowsPath(title: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(title.trim()) || /^\\\\/.test(title.trim());
}

export function normalizeTerminalTitle(title: string | null | undefined): string {
  const cleanTitle = sanitizeTerminalTitle(title ?? "");
  if (!cleanTitle || looksLikeRawWindowsPath(cleanTitle)) {
    return DEFAULT_TERMINAL_TITLE;
  }
  return cleanTitle;
}

export function setIntendedTerminalTitle(title: string | null | undefined, options?: TerminalTitleOptions): string {
  intendedTerminalTitle = normalizeTerminalTitle(title);
  writeCodexaTerminalTitle(intendedTerminalTitle, {
    ...options,
    reason: options?.reason ?? "set-intended-title",
  });
  return intendedTerminalTitle;
}

export function getIntendedTerminalTitle(): string {
  return intendedTerminalTitle;
}

export function reassertIntendedTerminalTitle(options?: TerminalTitleOptions): void {
  writeCodexaTerminalTitle(intendedTerminalTitle, {
    force: true,
    ...options,
    reason: options?.reason ?? "reassert-intended-title",
  });
}

export function writeCodexaTerminalTitle(title: string, options?: TerminalTitleOptions) {
  const cleanTitle = normalizeTerminalTitle(title);

  if (!options?.force && cleanTitle === lastWrittenTerminalTitle) {
    debugLog(`skipped title="${cleanTitle}" reason=${options?.reason ?? "unknown"} (unchanged)`);
    return;
  }

  lastWrittenTerminalTitle = cleanTitle;

  const sequence = buildTerminalTitleSequence(cleanTitle);
  writeTerminalTitleDebugRecord({
    event: "codexaTitleWrite",
    title: cleanTitle,
    reason: options?.reason ?? "unknown",
    force: !!options?.force,
    bytes: Buffer.byteLength(sequence),
  });

  if (options?.write) {
    options.write(sequence);
    debugLog(`write(custom) title="${cleanTitle}" force=${!!options?.force} reason=${options?.reason ?? "unknown"}`);
    return;
  }

  const stdoutIsTTY = Boolean(process.stdout?.isTTY);
  const stderrIsTTY = Boolean(process.stderr?.isTTY);

  debugLog(`writeCodexaTerminalTitle("${cleanTitle}") force=${!!options?.force} reason=${options?.reason ?? "unknown"} stdoutIsTTY=${stdoutIsTTY} stderrIsTTY=${stderrIsTTY}`);

  if (stderrIsTTY) {
    process.stderr.write(sequence);
    debugLog(`write(stderr) sequence length=${sequence.length}`);
  } else if (stdoutIsTTY) {
    process.stdout.write(sequence);
    debugLog(`write(stdout) sequence length=${sequence.length}`);
  } else {
    // Fallback if neither is explicitly a TTY but we might still be in a terminal (e.g. Bun quirk)
    process.stdout.write(sequence);
    debugLog(`write(stdout-fallback) sequence length=${sequence.length} (no TTY detected)`);
  }
}

/**
 * Directly writes the terminal title escape sequence to process.stdout or process.stderr,
 * bypassing any Ink/React state management to ensure it reaches the terminal.
 */
export function setTerminalTitle(title: string, options?: TerminalTitleOptions) {
  writeCodexaTerminalTitle(title, options);
}

/**
 * Pure mapper that converts terminal title mode and workspace into a displayable string.
 */
export function computeTerminalTitle(options: {
  terminalTitleMode: "dir" | "name" | "simple";
  workspaceName?: string;
  appName?: string;
}) {
  const appName = options.appName || "Codexa";

  if (options.terminalTitleMode === "dir") {
    return options.workspaceName || appName;
  }

  return appName;
}

/**
 * Force a refresh of the terminal title using current settings and workspace.
 */
export function refreshTerminalTitle(options: {
  terminalTitleMode: "dir" | "name" | "simple";
  workspaceName?: string;
  appName?: string;
  force?: boolean;
  write?: (chunk: string) => void;
  debugEventName?: string;
  busyState?: boolean;
}) {
  const title = normalizeTerminalTitle(computeTerminalTitle(options));
  if (DEBUG_TERMINAL_TITLE) {
    debugLog(
      `refreshTerminalTitle(event=${options.debugEventName || "unknown"}, mode=${options.terminalTitleMode}, workspace=${options.workspaceName}, busy=${!!options.busyState}) -> "${title}"`,
    );
  }
  setIntendedTerminalTitle(title, {
    force: options.force,
    write: options.write,
    reason: options.debugEventName ?? "refreshTerminalTitle",
  });
}

export interface TerminalTitleSequenceTraceContext {
  source: string;
  stream: "stdout" | "stderr" | "unknown";
  origin: "codexa" | "child" | "shell" | "codex-cli" | "unknown";
  action?: "observed" | "stripped" | "allowed";
  lifecycleState?: string;
}

export function traceTerminalTitleSequences(
  input: Buffer | string,
  context: TerminalTitleSequenceTraceContext,
): boolean {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  if (!text) return false;

  let found = false;
  TERMINAL_TITLE_SEQUENCE_DETECT_PATTERN.lastIndex = 0;
  for (let match = TERMINAL_TITLE_SEQUENCE_DETECT_PATTERN.exec(text); match; match = TERMINAL_TITLE_SEQUENCE_DETECT_PATTERN.exec(text)) {
    found = true;
    const title = match[2] ?? "";
    writeTerminalTitleDebugRecord({
      event: "terminalTitleSequence",
      source: context.source,
      stream: context.stream,
      origin: context.origin,
      action: context.action ?? "observed",
      lifecycleState: context.lifecycleState ?? terminalTitleLifecycleState,
      osc: match[1] === "2" ? "OSC 2" : "OSC 0",
      title,
      containsWindowsSystem: title.toLowerCase().includes("c:\\windows\\system"),
      bytes: Buffer.byteLength(match[0] ?? ""),
    });
  }

  return found;
}

export function stripTerminalTitleSequences(input: string): string {
  return input.replace(TERMINAL_TITLE_SEQUENCE_PATTERN, "");
}

export function stripTerminalTitleSequencesFromChunk(chunk: Buffer | string): string {
  return stripTerminalTitleSequences(
    Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk,
  );
}

export function createTerminalTitleSequenceStripper(context: TerminalTitleSequenceTraceContext): {
  process(chunk: Buffer | string): string;
  flush(): string;
} {
  let carryover = "";

  const strip = (text: string): string => {
    if (!text) return "";
    const found = traceTerminalTitleSequences(text, { ...context, action: "stripped" });
    return found ? stripTerminalTitleSequences(text) : text;
  };

  return {
    process(chunk: Buffer | string): string {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      const input = carryover + text;
      carryover = "";

      const match = INCOMPLETE_TERMINAL_TITLE_SEQUENCE_PATTERN.exec(input);
      if (match?.index != null) {
        carryover = input.slice(match.index);
        return strip(input.slice(0, match.index));
      }

      return strip(input);
    },

    flush(): string {
      const remaining = carryover;
      carryover = "";
      return strip(remaining);
    },
  };
}

export function writeGuardedTerminalOutput(
  write: (chunk: string) => boolean | void,
  chunk: Buffer | string,
  context: TerminalTitleSequenceTraceContext,
): boolean {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
  if (context.action === "allowed") {
    return write(text) !== false;
  }
  const found = traceTerminalTitleSequences(text, { ...context, action: "stripped" });
  const safeText = found ? stripTerminalTitleSequences(text) : text;
  if (!safeText) return true;
  return write(safeText) !== false;
}

/**
 * Schedules a sequence of title assertions to outlast Windows Terminal's
 * shell integration which often overwrites the title shortly after startup.
 */
export function beginColdStartSequence(title: string, options?: { write?: (chunk: string) => void }) {
  setIntendedTerminalTitle(title, { force: true, write: options?.write, reason: "cold-start-immediate" });

  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  const scheduleRetry = (delayMs: number) => {
    const id = setTimeout(() => {
      if (!cancelled) {
        debugLog(`cold-start retry t=${delayMs}ms fired`);
        reassertIntendedTerminalTitle({ write: options?.write, reason: `cold-start-retry-${delayMs}ms` });
      }
    }, delayMs);
    timers.push(id);
  };

  scheduleRetry(50);
  scheduleRetry(250);
  scheduleRetry(500);
  scheduleRetry(1000);

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
    debugLog("cold-start sequence cancelled");
  };
}

export function startTerminalTitleStartupGuard(options?: {
  write?: (chunk: string) => void;
  intervalMs?: number;
  durationMs?: number;
  reason?: string;
}): () => void {
  const intervalMs = options?.intervalMs ?? 150;
  const durationMs = options?.durationMs ?? 3500;
  const reason = options?.reason ?? "startup-guard";
  let stopped = false;
  const startedAt = Date.now();

  reassertIntendedTerminalTitle({ write: options?.write, reason: `${reason}-start` });
  const interval = setInterval(() => {
    if (stopped) return;
    if (Date.now() - startedAt >= durationMs) {
      stopped = true;
      clearInterval(interval);
      reassertIntendedTerminalTitle({ write: options?.write, reason: `${reason}-end` });
      return;
    }
    reassertIntendedTerminalTitle({ write: options?.write, reason });
  }, intervalMs);
  interval.unref?.();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
  };
}

export function sanitizeTerminalTitle(title: string): string {
  return title
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\u001b/g, "")
    .trim();
}

export function buildTerminalTitleSequence(title: string): string {
  const safeTitle = normalizeTerminalTitle(title);
  // \x1b]0; sets both icon name and window title.
  // \x1b]2; sets window title.
  // We use both for compatibility.
  return `\x1b]0;${safeTitle}\x07\x1b]2;${safeTitle}\x07`;
}

export function formatTerminalTitleLabel(
  workspaceRoot: string,
  terminalTitleMode: TerminalTitleMode,
): string {
  return formatTerminalTitlePath(workspaceRoot, terminalTitleMode);
}

export function deriveTerminalTitle(
  workspaceRoot: string,
  terminalTitleMode: TerminalTitleMode,
): string {
  return formatTerminalTitlePath(workspaceRoot, terminalTitleMode) || DEFAULT_TERMINAL_TITLE;
}

/** Write the title sequence to stdout to (re-)assert the window title. */
export function reassertTerminalTitle(
  title: string = DEFAULT_TERMINAL_TITLE,
  write: (chunk: string) => void = (chunk) => {
    process.stdout.write(chunk);
  },
): void {
  write(buildTerminalTitleSequence(title));
}

/**
 * Acquire a run-scoped title guard that immediately asserts the title,
 * reasserts it periodically while work is active, and emits one final
 * assertion when released.
 */
export function acquireTerminalTitleGuard(
  intervalMs = 250,
  reassert: () => void = () => reassertTerminalTitle(),
): () => void {
  let released = false;
  reassert();
  const timer = setInterval(reassert, intervalMs);
  timer.unref?.();
  return () => {
    if (released) return;
    released = true;
    clearInterval(timer);
    reassert();
  };
}
