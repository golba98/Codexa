#!/usr/bin/env node

import { spawn, spawnSync } from "child_process";
import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

process.title = "CODEXA";

const currentFile = fileURLToPath(import.meta.url);
const packageRoot = dirname(dirname(currentFile));
const forwardArgs = process.argv.slice(2);
const workspaceRoot = process.cwd();

function writeRenderDebugRecord(kind, fields) {
  if (process.env.CODEXA_RENDER_DEBUG !== "1" && process.env.CODEXA_DEBUG_RENDER !== "1") {
    return;
  }

  try {
    const debugDir = join(workspaceRoot, ".codexa-debug");
    mkdirSync(debugDir, { recursive: true });
    appendFileSync(
      join(debugDir, "render-debug.log"),
      JSON.stringify({
        ts: Date.now(),
        pid: process.pid,
        sessionId: `launcher-${Date.now()}-${process.pid}`,
        kind,
        ...fields,
      }) + "\n",
      "utf8",
    );
  } catch {
    // Debug logging must never disturb launcher startup.
  }
}

function hasFlag(args, longFlag, shortFlag) {
  for (const arg of args) {
    if (arg === "--") return false;
    if (arg === longFlag || arg === shortFlag) return true;
  }
  return false;
}

function readPackageVersion() {
  try {
    const raw = readFileSync(join(packageRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}

function printHelp() {
  const version = readPackageVersion();
  const versionLine = version ? `codexa ${version}` : "codexa";
  console.log(`${versionLine}

Usage:
  codexa
  codexa "explain this repo"
  codexa exec "print the current directory"
  codexa [options] [prompt]

Options:
  -h, --help              Show this help text and exit.
  -v, --version           Show the installed Codexa version and exit.
      --profile <name>    Load a Codex profile from config.
  -c, --config <key=val>  Override a runtime config value.

Inside Codexa:
  /help                   Show interactive commands.
  /model                  Open model selection.
  /mode                   Open mode selection.
  /exit                   Exit the interactive UI.
`);
}

const isHeadlessExec = forwardArgs[0] === "exec";

if (!isHeadlessExec && hasFlag(forwardArgs, "--help", "-h")) {
  printHelp();
  process.exit(0);
}

if (!isHeadlessExec && hasFlag(forwardArgs, "--version", "-v")) {
  console.log(readPackageVersion() ?? "unknown");
  process.exit(0);
}

const titleSequence = "\x1b]0;CODEXA\x07\x1b]2;CODEXA\x07";
if (!isHeadlessExec) {
  writeRenderDebugRecord("stdout", {
    event: "directWrite",
    source: "bin/codexa.js:title",
    bytes: Buffer.byteLength(titleSequence),
    containsViewportClear: false,
    containsScrollbackClear: false,
    containsCursorHome: false,
    containsTerminalReset: false,
    containsTitleSequence: true,
  });
  process.stdout.write(titleSequence);
}

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

const appEntry = join(packageRoot, "src", "index.tsx");
const execEntry = join(packageRoot, "src", "exec.ts");
const bunEntry = isHeadlessExec ? execEntry : appEntry;
const bunForwardArgs = isHeadlessExec ? forwardArgs.slice(1) : forwardArgs;

// Detect if parent process has a real TTY
const parentHasTTY = process.stdin.isTTY && process.stdout.isTTY;

const child = spawn(
  bunExecutable,
  ["run", "--silent", bunEntry, ...(bunForwardArgs.length > 0 ? ["--", ...bunForwardArgs] : [])],
  {
    cwd: workspaceRoot,
    stdio: [parentHasTTY ? "inherit" : "pipe", "inherit", "inherit"],
    env: {
      ...process.env,
      CODEX_WORKSPACE_ROOT: workspaceRoot,
      CODEXA_LAUNCH_KIND: "installed-bin",
      CODEXA_PACKAGE_ROOT: packageRoot,
      CODEXA_LAUNCHER_SCRIPT: currentFile,
      CODEXA_RELAUNCH_EXECUTABLE: process.execPath,
      CODEXA_RELAUNCH_ARGS: JSON.stringify([currentFile, ...forwardArgs]),
      CODEXA_PARENT_HAS_TTY: parentHasTTY ? "1" : "0",
    },
  },
);

if (!parentHasTTY) {
  const mouseFilter = createMouseFilter();

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
}

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
