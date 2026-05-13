import { APP_NAME, type TerminalTitleMode, formatTerminalTitlePath } from "../config/settings.js";

export const DEFAULT_TERMINAL_TITLE = APP_NAME;

const DEBUG_TERMINAL_TITLE = Boolean(process.env["CODEXA_DEBUG_TERMINAL_TITLE"]);

function debugLog(msg: string): void {
  if (DEBUG_TERMINAL_TITLE) {
    process.stderr.write(`[codexa:terminal-title] ${msg}\n`);
  }
}

export interface TerminalTitleController {
  write(title: string, opts?: { force?: boolean }): void;
  beginColdStartSequence(
    title: string,
    meta?: { titleMode?: string; workspaceRoot?: string },
  ): () => void;
}

export function createTerminalTitleController(
  writeChunk: (chunk: string) => void,
): TerminalTitleController {
  let lastTitle: string | null = null;

  function doWrite(rawTitle: string, force: boolean): void {
    const safeTitle = sanitizeTerminalTitle(rawTitle);
    if (!force && lastTitle === safeTitle) return;
    lastTitle = safeTitle;
    writeChunk(buildTerminalTitleSequence(safeTitle));
    debugLog(`write title="${safeTitle}" force=${force}`);
  }

  return {
    write(title, opts) {
      doWrite(title, Boolean(opts?.force));
    },
    beginColdStartSequence(title, meta) {
      if (DEBUG_TERMINAL_TITLE) {
        const safeTitle = sanitizeTerminalTitle(title);
        debugLog(
          `cold-start begin title="${safeTitle}" titleMode="${meta?.titleMode ?? "unknown"}" workspaceRoot="${meta?.workspaceRoot ?? "unknown"}"`,
        );
      }

      doWrite(title, true);

      const timers: ReturnType<typeof setTimeout>[] = [];
      let cancelled = false;

      const scheduleRetry = (delayMs: number) => {
        const id = setTimeout(() => {
          if (!cancelled) {
            debugLog(`cold-start retry t=${delayMs}ms fired`);
            doWrite(title, true);
          }
        }, delayMs);
        timers.push(id);
      };

      scheduleRetry(50);
      scheduleRetry(250);

      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
        debugLog("cold-start sequence cancelled");
      };
    },
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
