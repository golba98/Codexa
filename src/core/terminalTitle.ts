import {
  TERMINAL_SEQUENCES,
  TERMINAL_TITLE,
  writeTerminalControl,
} from "./terminalControl.js";

export { TERMINAL_TITLE };

/** ANSI OSC sequence that sets the terminal window title to "CODEXA". */
export const SET_TERMINAL_TITLE = TERMINAL_SEQUENCES.title;

/** Write the title sequence to stdout to (re-)assert the window title. */
export function reassertTerminalTitle(
  write: (chunk: string) => void = (chunk) => {
    process.stdout.write(chunk);
  },
): void {
  try {
    process.title = TERMINAL_TITLE;
  } catch {
    // Ignore hosts where process.title cannot be updated.
  }
  writeTerminalControl(write, "stdout", "src/core/terminalTitle.ts:reassertTerminalTitle", SET_TERMINAL_TITLE);
}

/**
 * Acquire a run-scoped title guard that immediately asserts the title,
 * reasserts it periodically while work is active, and emits one final
 * assertion when released.
 */
export function acquireTerminalTitleGuard(
  intervalMs = 250,
  reassert: () => void = reassertTerminalTitle,
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
