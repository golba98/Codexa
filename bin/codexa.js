#!/usr/bin/env node

import { spawn, spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// ============================================================================
// Inline Mouse Escape Sequence Filter
// ============================================================================
// Strips terminal mouse reporting sequences before they reach the TUI app.
// This prevents raw escape codes like `\u001b[<64;62;22M` from appearing
// as typed text in the input field when users click or scroll.
//
// Handles:
// - SGR mouse events: \u001b[<button;col;row[Mm]
// - Legacy mouse events: \u001b[Mbcr (6 bytes)
// - Partial sequences split across chunks (buffering)
// - Scroll wheel detection (button 64/65) for event forwarding

function createMouseInputFilter() {
  const ESC = "\u001b";
  const SGR_MOUSE_PATTERN = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])/;
  
  let pending = "";

  function decodeLegacyMouseButton(value) {
    return value.charCodeAt(0) - 32;
  }

  function toScrollEvent(button) {
    if (button === 64 || button === 96) return "scroll-up";
    if (button === 65 || button === 97) return "scroll-down";
    return null;
  }

  function isDigits(value) {
    return value.length > 0 && /^\d+$/.test(value);
  }

  function parseSgrMousePacket(input) {
    const match = input.match(SGR_MOUSE_PATTERN);
    if (match) {
      return {
        length: match[0].length,
        event: toScrollEvent(Number.parseInt(match[1], 10)),
      };
    }

    // Manual parse for incomplete sequences
    let index = 3; // ESC[<
    let section = 0;
    let token = "";

    while (index < input.length) {
      const char = input[index];

      if (char >= "0" && char <= "9") {
        token += char;
        index += 1;
        continue;
      }

      if (char === ";" && section < 2 && isDigits(token)) {
        token = "";
        section += 1;
        index += 1;
        continue;
      }

      if ((char === "M" || char === "m") && section === 2 && isDigits(token)) {
        return {
          length: index + 1,
          event: toScrollEvent(Number.parseInt(input.slice(3, input.indexOf(";")), 10)),
        };
      }

      return null;
    }

    return "incomplete";
  }

  function isIncompleteCsiPrefix(input) {
    return input === ESC || input === `${ESC}[` || input === `${ESC}[<` || input === `${ESC}[M`;
  }

  return {
    filterChunk(chunk) {
      const data = pending + chunk;
      pending = "";
      const events = [];
      let output = "";
      let index = 0;

      while (index < data.length) {
        if (data[index] !== ESC) {
          output += data[index];
          index += 1;
          continue;
        }

        const remaining = data.slice(index);

        // SGR mouse sequence
        if (remaining.startsWith(`${ESC}[<`)) {
          const parsed = parseSgrMousePacket(remaining);
          if (parsed === "incomplete") {
            pending = remaining;
            break;
          }
          if (parsed) {
            if (parsed.event) events.push(parsed.event);
            index += parsed.length;
            continue;
          }
        }

        // Legacy mouse sequence
        if (remaining.startsWith(`${ESC}[M`)) {
          if (remaining.length < 6) {
            pending = remaining;
            break;
          }

          const event = toScrollEvent(decodeLegacyMouseButton(remaining[3]));
          if (event) events.push(event);
          index += 6;
          continue;
        }

        // Incomplete CSI prefix
        if (isIncompleteCsiPrefix(remaining)) {
          pending = remaining;
          break;
        }

        output += ESC;
        index += 1;
      }

      return { output, events, hasPending: pending.length > 0 };
    },

    flushPending() {
      const output = pending;
      pending = "";
      return output;
    },
  };
}

// ============================================================================
// Bun Executable Resolution
// ============================================================================

function resolveBunExecutable() {
  const candidates = process.platform === "win32"
    ? ["bun.exe", "bun.cmd", "bun"]
    : ["bun"];

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }

  return null;
}

const bunExecutable = resolveBunExecutable();

if (!bunExecutable) {
  console.error("Bun is required to launch codexa.");
  console.error("Install Bun, then run this command again.");
  process.exit(1);
}

// ============================================================================
// Launch Configuration
// ============================================================================

const currentFile = fileURLToPath(import.meta.url);
const packageRoot = dirname(dirname(currentFile));
const appEntry = join(packageRoot, "src", "index.tsx");
const workspaceRoot = process.cwd();

// Check TTY status before spawning child
// When we pipe stdin for mouse filtering, child loses TTY detection
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("This UI requires an interactive terminal.");
  process.exit(1);
}

const child = spawn(
  bunExecutable,
  ["run", "--silent", appEntry],
  {
    cwd: workspaceRoot,
    stdio: ["pipe", "inherit", "inherit"],
    env: {
      ...process.env,
      CODEX_WORKSPACE_ROOT: workspaceRoot,
      CODEXA_LAUNCH_KIND: "installed-bin",
      CODEXA_PACKAGE_ROOT: packageRoot,
      CODEXA_LAUNCHER_SCRIPT: currentFile,
      CODEXA_RELAUNCH_EXECUTABLE: process.execPath,
      CODEXA_RELAUNCH_ARGS: JSON.stringify([currentFile]),
      CODEXA_PARENT_HAS_TTY: "true",
      CODEXA_PARENT_RAW_MODE: "true",
    },
  },
);

// ============================================================================
// Mouse Filtering & Stdin Piping
// ============================================================================

const mouseFilter = createMouseInputFilter();
let pendingFlushTimer = null;

const schedulePendingFlush = () => {
  if (pendingFlushTimer) clearTimeout(pendingFlushTimer);
  pendingFlushTimer = setTimeout(() => {
    pendingFlushTimer = null;
    const flushed = mouseFilter.flushPending();
    if (flushed && child.stdin && !child.stdin.destroyed) {
      child.stdin.write(flushed);
    }
  }, 50);
};

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");

process.stdin.on("data", (chunk) => {
  if (!child.stdin || child.stdin.destroyed) return;

  if (pendingFlushTimer) {
    clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
  }

  const filtered = mouseFilter.filterChunk(chunk.toString());

  // Forward scroll events to child process
  // The child listens for these custom events in src/index.tsx
  for (const event of filtered.events) {
    const eventName = event === "scroll-up" ? "codexa-scroll-up" : "codexa-scroll-down";
    // Emit on child.stdin since that's what the child process monitors
    if (child.stdin.emit) {
      child.stdin.emit(eventName);
    }
  }

  if (filtered.hasPending) {
    schedulePendingFlush();
  }

  if (filtered.output) {
    child.stdin.write(filtered.output);
  }
});

process.stdin.on("end", () => {
  if (child.stdin && !child.stdin.destroyed) {
    child.stdin.end();
  }
});

// ============================================================================
// Error Handling
// ============================================================================

child.on("error", (error) => {
  console.error(`Failed to launch Bun: ${error.message}`);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
