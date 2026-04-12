/** ANSI OSC sequence that sets the terminal window title to "CODEXA". */
export const SET_TERMINAL_TITLE = "\x1b]0;CODEXA\x07";

/** Write the title sequence to stdout to (re-)assert the window title. */
export function reassertTerminalTitle(): void {
  process.stdout.write(SET_TERMINAL_TITLE);
}

/**
 * Throttled title guard that re-asserts the terminal title at most once
 * every `intervalMs` milliseconds.  Returns a dispose function to stop
 * the guard and emit one final title assertion.
 *
 * Use this during long-running subprocess executions where child
 * processes (spawned by the backend) can reset the terminal title.
 */
export function createTitleGuard(intervalMs = 500): () => void {
  const timer = setInterval(reassertTerminalTitle, intervalMs);
  return () => {
    clearInterval(timer);
    reassertTerminalTitle();
  };
}
