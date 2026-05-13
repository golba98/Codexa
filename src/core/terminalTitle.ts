import { APP_NAME, type TerminalTitleMode, formatTerminalTitlePath } from "../config/settings.js";
import { writeTerminalControl } from "./terminalControl.js";

export const DEFAULT_TERMINAL_TITLE = APP_NAME;

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

/** Write the title sequence to stdout to (re-)assert the window title. */
export function reassertTerminalTitle(
  title: string = DEFAULT_TERMINAL_TITLE,
  write: (chunk: string) => void = (chunk) => {
    process.stdout.write(chunk);
  },
): void {
  // OSC in-band FIRST — committed synchronously to the stdout buffer before
  // any async Win32 ConPTY path can interfere.
  writeTerminalControl(write, "stdout", "src/core/terminalTitle.ts:reassertTerminalTitle", buildTerminalTitleSequence(title));
  // process.title as Win32 fallback for terminals that don't support OSC.
  try {
    process.title = title;
  } catch {
    // Ignore hosts where process.title cannot be updated.
  }
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
