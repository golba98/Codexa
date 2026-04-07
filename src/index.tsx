import React from "react";
import { render } from "ink";
import { App } from "./app.js";

// Check for TTY - support piped stdin if parent has real TTY
const hasLocalTTY = process.stdin.isTTY && process.stdout.isTTY;
const hasParentTTY = process.env.CODEXA_PARENT_HAS_TTY === "1";
const isTTY = hasLocalTTY || hasParentTTY;

if (!isTTY || !process.stdout.isTTY) {
  console.error("This UI requires an interactive terminal.");
  process.exitCode = 1;
} else {
  // Enter the alternate screen buffer so Ink's cursor-up repaints never
  // overshoot the top of the viewport and drag the terminal back to the logo.
  // Also enable bracketed paste mode so the terminal treats pasted text as a
  // single chunk instead of triggering a multi-line paste confirmation dialog.
  process.stdout.write("\x1b[?1049h\x1b[?2004h\x1b[H");
  process.on("exit", () => { process.stdout.write("\x1b[?2004l\x1b[?1049l"); });

  render(<App />);
}
