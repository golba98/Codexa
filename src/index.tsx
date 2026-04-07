import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { createMouseInputFilter } from "./core/terminalMouse.js";
import { createRawModeProxy } from "./core/stdinProxy.js";

// When launched via npm-link launcher (bin/codexa.js), stdin is piped for mouse filtering
// In this case, check CODEXA_PARENT_HAS_TTY env var set by the launcher
const hasTTY = (process.stdin.isTTY && process.stdout.isTTY) || 
                (process.env.CODEXA_PARENT_HAS_TTY === "true" && process.stdout.isTTY);

if (!hasTTY) {
  console.error("This UI requires an interactive terminal.");
  process.exitCode = 1;
} else {
  // Enter the alternate screen buffer so Ink's cursor-up repaints never
  // overshoot the top of the viewport and drag the terminal back to the logo.
  // Also enable bracketed paste mode so the terminal treats pasted text as a
  // single chunk instead of triggering a multi-line paste confirmation dialog.
  // Enable SGR mouse tracking for scroll wheel.
  process.stdout.write("\x1b[?1049h\x1b[?2004h\x1b[?1000h\x1b[?1015h\x1b[?1006h\x1b[H");
  process.on("exit", () => {
    process.stdout.write("\x1b[?1000l\x1b[?1015l\x1b[?1006l\x1b[?2004l\x1b[?1049l");
  });

  // Intercept process.stdin to strip mouse sequences before Ink's readline parses them.
  // This prevents terminal control sequences from appearing visually as typed text,
  // and stops 'key.escape' from triggering onCancel due to the CSI escape character.
  const originalEmit = process.stdin.emit.bind(process.stdin);
  const mouseFilter = createMouseInputFilter();
  let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const schedulePendingFlush = (isBuffer: boolean) => {
    if (pendingFlushTimer) clearTimeout(pendingFlushTimer);
    pendingFlushTimer = setTimeout(() => {
      pendingFlushTimer = null;
      const flushed = mouseFilter.flushPending();
      if (!flushed) return;
      originalEmit("data", isBuffer ? Buffer.from(flushed, "utf8") : flushed);
    }, 50);
  };

  process.stdin.emit = function (event: any, ...args: any[]) {
    if (event === "data" && args[0]) {
      const isBuffer = Buffer.isBuffer(args[0]);
      const str = isBuffer ? args[0].toString("utf8") : String(args[0]);

      if (pendingFlushTimer) {
        clearTimeout(pendingFlushTimer);
        pendingFlushTimer = null;
      }

      const filtered = mouseFilter.filterChunk(str);
      for (const mouseEvent of filtered.events) {
        process.stdin.emit(mouseEvent === "scroll-up" ? "codexa-scroll-up" : "codexa-scroll-down");
      }

      if (filtered.hasPending) {
        schedulePendingFlush(isBuffer);
      }

      if (filtered.output !== str) {
        if (filtered.output.length === 0) return false;
        args[0] = isBuffer ? Buffer.from(filtered.output, "utf8") : filtered.output;
      }
    }
    return originalEmit(event, ...args);
  };

  // When launched via launcher, stdin is piped (for mouse filtering).
  // Piped streams don't support setRawMode(), but the parent already set raw mode.
  // Wrap stdin in a proxy that makes setRawMode() a no-op to prevent Ink errors.
  let stdinStream = process.stdin;
  if (process.env.CODEXA_PARENT_RAW_MODE === "true") {
    stdinStream = createRawModeProxy(process.stdin);
  }

  render(<App />, { stdin: stdinStream });
}
