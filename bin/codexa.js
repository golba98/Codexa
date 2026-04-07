#!/usr/bin/env node

import { spawn, spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/**
 * Filters out terminal mouse reporting escape sequences from stdin data.
 * Prevents SGR mouse clicks and scroll events from leaking into the TUI app.
 */
function createMouseFilter() {
  let buffer = "";
  let timer = null;

  return (data) => {
    buffer += data;

    // Clear existing timer
    if (timer) clearTimeout(timer);

    // Check for complete SGR mouse sequences: ESC [ < button ; x ; y M/m
    // Also handle scroll events: button 64/96 (scroll up), 65/97 (scroll down)
    const sgrMouseRegex = /\x1b\[<[0-9]+;[0-9]+;[0-9]+[Mm]/g;
    let hasFullSequence = sgrMouseRegex.test(buffer);

    // If we have a complete sequence, filter and emit immediately
    if (hasFullSequence) {
      buffer = buffer.replace(sgrMouseRegex, "");
      return buffer;
    }

    // If we have partial SGR start, wait for completion or timeout
    if (/\x1b\[<[0-9]*;?[0-9]*;?[0-9]*$/.test(buffer)) {
      timer = setTimeout(() => {
        // Timeout: assume incomplete mouse sequence, just emit filtered buffer
        timer = null;
      }, 50);
      return null; // Wait for more data
    }

    // Otherwise, emit immediately (normal input)
    return buffer;
  };
}

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

const currentFile = fileURLToPath(import.meta.url);
const packageRoot = dirname(dirname(currentFile));
const appEntry = join(packageRoot, "src", "index.tsx");
const workspaceRoot = process.cwd();

// Detect if parent process has a real TTY
const parentHasTTY = process.stdin.isTTY && process.stdout.isTTY;

// Create mouse filter for stdin
const mouseFilter = createMouseFilter();
let filteredChunk = "";

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
      CODEXA_PARENT_HAS_TTY: parentHasTTY ? "1" : "0",
      CODEXA_PARENT_RAW_MODE: "1",
    },
  },
);

// Pipe stdin with mouse filtering
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

process.stdin.on("data", (data) => {
  const filtered = mouseFilter(data);
  if (filtered) {
    child.stdin.write(filtered);
  }
});

process.stdin.on("end", () => {
  child.stdin.end();
});

process.stdin.on("error", (error) => {
  console.error(`stdin error: ${error.message}`);
});

child.stdin.on("error", (error) => {
  // Ignore broken pipe errors
  if (error.code !== "EPIPE") {
    console.error(`child stdin error: ${error.message}`);
  }
});

child.on("error", (error) => {
  console.error(`Failed to launch Bun: ${error.message}`);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
