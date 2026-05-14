import { APP_NAME, type TerminalTitleMode, formatTerminalTitlePath } from "../config/settings.js";

export const DEFAULT_TERMINAL_TITLE = APP_NAME;

const DEBUG_TERMINAL_TITLE = Boolean(process.env["CODEXA_DEBUG_TERMINAL_TITLE"]);

function debugLog(msg: string): void {
  if (DEBUG_TERMINAL_TITLE) {
    process.stderr.write(`[codexa:terminal-title] ${msg}\n`);
  }
}

let lastWrittenTerminalTitle = "";

/** FOR TESTING ONLY: Reset the cached title. */
export function __resetTerminalTitleCache() {
  lastWrittenTerminalTitle = "";
}

export interface TerminalTitleOptions {
  force?: boolean;
  /** Optional custom write function, e.g. for testing or using a specific stdout/stderr instance. */
  write?: (chunk: string) => void;
}

/**
 * Directly writes the terminal title escape sequence to process.stdout or process.stderr,
 * bypassing any Ink/React state management to ensure it reaches the terminal.
 */
export function setTerminalTitle(title: string, options?: TerminalTitleOptions) {
  const cleanTitle = sanitizeTerminalTitle(title) || "Codexa";

  if (!options?.force && cleanTitle === lastWrittenTerminalTitle) {
    debugLog(`skipped title="${cleanTitle}" (unchanged)`);
    return;
  }

  lastWrittenTerminalTitle = cleanTitle;

  const sequence = buildTerminalTitleSequence(cleanTitle);

  if (options?.write) {
    options.write(sequence);
    debugLog(`write(custom) title="${cleanTitle}" force=${!!options?.force}`);
    return;
  }

  const stdoutIsTTY = Boolean(process.stdout?.isTTY);
  const stderrIsTTY = Boolean(process.stderr?.isTTY);

  debugLog(`setTerminalTitle("${cleanTitle}") force=${!!options?.force} stdoutIsTTY=${stdoutIsTTY} stderrIsTTY=${stderrIsTTY}`);

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
  const title = computeTerminalTitle(options);
  if (DEBUG_TERMINAL_TITLE) {
    debugLog(
      `refreshTerminalTitle(event=${options.debugEventName || "unknown"}, mode=${options.terminalTitleMode}, workspace=${options.workspaceName}, busy=${!!options.busyState}) -> "${title}"`,
    );
  }
  setTerminalTitle(title, { force: options.force, write: options.write });
}

/**
 * Schedules a sequence of title assertions to outlast Windows Terminal's
 * shell integration which often overwrites the title shortly after startup.
 */
export function beginColdStartSequence(title: string, options?: { write?: (chunk: string) => void }) {
  setTerminalTitle(title, { force: true, write: options?.write });

  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  const scheduleRetry = (delayMs: number) => {
    const id = setTimeout(() => {
      if (!cancelled) {
        debugLog(`cold-start retry t=${delayMs}ms fired`);
        setTerminalTitle(title, { force: true, write: options?.write });
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

export function sanitizeTerminalTitle(title: string): string {
  return title
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\u001b/g, "")
    .trim();
}

export function buildTerminalTitleSequence(title: string): string {
  const safeTitle = sanitizeTerminalTitle(title);
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
