import React from "react";
import { render } from "ink";
import { App } from "./app.js";

// Check for TTY - support piped stdin if parent has real TTY
const hasLocalTTY = process.stdin.isTTY && process.stdout.isTTY;

if (!hasLocalTTY) {
  console.error("This UI requires an interactive terminal.");
  process.exitCode = 1;
} else {
  // Enable bracketed paste mode so the terminal treats pasted text as a
  // single chunk instead of triggering a multi-line paste confirmation dialog.
  // We stay in the normal screen buffer (no \x1b[?1049h) to preserve terminal
  // scrollback and allow mouse text selection.
  process.stdout.write("\x1b[?2004h");
  process.on("exit", () => { process.stdout.write("\x1b[?2004l"); });

  render(<App />);
}
