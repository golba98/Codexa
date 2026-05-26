#!/usr/bin/env node

import { spawn } from "child_process";
import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

process.title = "CODEXA";

const currentFile = fileURLToPath(import.meta.url);
const packageRoot = dirname(dirname(currentFile));
const forwardArgs = process.argv.slice(2);
const workspaceRoot = process.cwd();
const launcherStartTimeMs = Number(process.env.CODEXA_EXEC_TIMING_EPOCH_MS) || Date.now();
let launcherPreviousElapsedMs = 0;
const titleSequencePattern = /\x1b\](?:0|2);[^\x07]*(?:\x07|\x1b\\)/g;
const titleSequenceDetectPattern = /\x1b\]([02]);([\s\S]*?)(?:\x07|\x1b\\)/g;
const incompleteTitleSequencePattern = /\x1b\](?:0|2);[^\x07]*$/;
let intendedTerminalTitle = "Codexa";

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

function debugLaunch(message, fields = {}) {
  if (process.env.CODEXA_DEBUG_LAUNCH !== "1") {
    return;
  }

  const serializedFields = Object.entries(fields)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  process.stderr.write(`[codexa:launch] ${message}${serializedFields ? ` ${serializedFields}` : ""}\n`);
}

function writeTerminalTitleDebugRecord(fields) {
  if (process.env.CODEXA_DEBUG_TERMINAL_TITLE !== "1") {
    return;
  }

  try {
    const debugDir = join(workspaceRoot, ".codexa-debug");
    mkdirSync(debugDir, { recursive: true });
    appendFileSync(
      process.env.CODEXA_TERMINAL_TITLE_DEBUG_FILE?.trim() || join(debugDir, "terminal-title-debug.log"),
      JSON.stringify({
        ts: Date.now(),
        pid: process.pid,
        lifecycleState: "launcher",
        ...fields,
      }) + "\n",
      "utf8",
    );
  } catch {
    // Debug logging must never disturb launcher startup.
  }
}

function traceTitleSequences(text, fields) {
  if (!text) return false;
  let found = false;
  titleSequenceDetectPattern.lastIndex = 0;
  for (let match = titleSequenceDetectPattern.exec(text); match; match = titleSequenceDetectPattern.exec(text)) {
    found = true;
    const title = match[2] || "";
    writeTerminalTitleDebugRecord({
      event: "terminalTitleSequence",
      osc: match[1] === "2" ? "OSC 2" : "OSC 0",
      title,
      containsWindowsSystem: title.toLowerCase().includes("c:\\windows\\system"),
      bytes: Buffer.byteLength(match[0] || ""),
      ...fields,
    });
  }
  return found;
}

function sanitizeTerminalTitle(title) {
  return String(title ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\x1b/g, "")
    .trim();
}

function normalizeTerminalTitle(title) {
  const cleanTitle = sanitizeTerminalTitle(title);
  if (!cleanTitle || /^[a-zA-Z]:[\\/]/.test(cleanTitle) || /^\\\\/.test(cleanTitle)) {
    return "Codexa";
  }
  return cleanTitle;
}

function buildTitleSequence(title) {
  const safeTitle = normalizeTerminalTitle(title);
  return `\x1b]0;${safeTitle}\x07\x1b]2;${safeTitle}\x07`;
}

function writeIntendedTitle(reason, force = true) {
  const sequence = buildTitleSequence(intendedTerminalTitle);
  writeRenderDebugRecord("stdout", {
    event: "directWrite",
    source: `bin/codexa.js:${reason}`,
    bytes: Buffer.byteLength(sequence),
    containsViewportClear: false,
    containsScrollbackClear: false,
    containsCursorHome: false,
    containsTerminalReset: false,
    containsTitleSequence: true,
  });
  process.stdout.write(sequence);
  writeTerminalTitleDebugRecord({
    event: "codexaTitleWrite",
    source: `bin/codexa.js:${reason}`,
    title: intendedTerminalTitle,
    reason,
    force,
    bytes: Buffer.byteLength(sequence),
  });
}

function startLauncherTitleGuard() {
  const startedAt = Date.now();
  const interval = setInterval(() => {
    if (Date.now() - startedAt >= 2500) {
      clearInterval(interval);
      writeIntendedTitle("launcher-title-guard-end");
      return;
    }
    writeIntendedTitle("launcher-title-guard");
  }, 150);
  interval.unref?.();
  return () => clearInterval(interval);
}

function createTitleStripper(fields) {
  let carryover = "";
  return (chunk) => {
    const input = carryover + Buffer.from(chunk).toString("utf8");
    carryover = "";
    const incomplete = incompleteTitleSequencePattern.exec(input);
    const processable = incomplete?.index != null ? input.slice(0, incomplete.index) : input;
    if (incomplete?.index != null) {
      carryover = input.slice(incomplete.index);
    }
    return traceTitleSequences(processable, fields)
      ? processable.replace(titleSequencePattern, "")
      : processable;
  };
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
  codexa --headless-benchmark "print the current directory"
  codexa [options] [prompt]

Options:
  -h, --help              Show this help text and exit.
  -v, --version           Show the installed Codexa version and exit.
      --headless-benchmark
                           Run Codexa through the headless benchmark path.
      --profile <name>    Load a Codex profile from config.
  -m, --model <name>      Select the Codex model for this launch.
      --reasoning <effort>
                           Reasoning effort for codexa exec: none, minimal, low, medium, high, xhigh.
  -c, --config <key=val>  Override a runtime config value.

Inside Codexa:
  /help                   Show interactive commands.
  /model                  Open model selection.
  /mode                   Open mode selection.
  /exit                   Exit the interactive UI.
`);
}

const isHeadlessExec = forwardArgs[0] === "exec";
const isHeadlessBenchmark = forwardArgs[0] === "--headless-benchmark";
const isHeadlessMode = isHeadlessExec || isHeadlessBenchmark;
const execTimingEnabled = isHeadlessMode
  && (
    process.env.CODEXA_EXEC_TIMING === "1"
    || forwardArgs.includes("--timing")
    || forwardArgs.includes("--benchmark-diagnostics")
  );
const parentStdinIsTTY = Boolean(process.stdin.isTTY);
const parentStdoutIsTTY = Boolean(process.stdout.isTTY);
const parentStderrIsTTY = Boolean(process.stderr.isTTY);
const parentHasTTY = parentStdinIsTTY && parentStdoutIsTTY;

function markExecTiming(phase, fields = {}) {
  if (!execTimingEnabled) return;
  const elapsedMs = Date.now() - launcherStartTimeMs;
  const deltaMs = elapsedMs - launcherPreviousElapsedMs;
  launcherPreviousElapsedMs = elapsedMs;
  const formattedFields = Object.entries(fields)
    .map(([key, value]) => {
      const serialized = Array.isArray(value) || typeof value === "string"
        ? JSON.stringify(value)
        : String(value);
      return `${key}=${serialized}`;
    })
    .join(" ");
  process.stderr.write(`[codexa exec timing] phase=${phase} elapsed_ms=${elapsedMs} delta_ms=${deltaMs}${formattedFields ? ` ${formattedFields}` : ""}\n`);
}

markExecTiming("launcher_start", { pid: process.pid });

let stopLauncherTitleGuard = null;
if (!isHeadlessMode && parentHasTTY) {
  intendedTerminalTitle = normalizeTerminalTitle(process.env.CODEXA_INITIAL_TERMINAL_TITLE || "Codexa");
  writeIntendedTitle("launcher-startup-title");
  stopLauncherTitleGuard = startLauncherTitleGuard();
}

if (!isHeadlessMode && hasFlag(forwardArgs, "--help", "-h")) {
  printHelp();
  process.exit(0);
}

if (!isHeadlessMode && hasFlag(forwardArgs, "--version", "-v")) {
  console.log(readPackageVersion() ?? "unknown");
  process.exit(0);
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

const bunExecutable = process.env.CODEXA_BUN_EXECUTABLE?.trim()
  || (process.platform === "win32" ? "bun.exe" : "bun");

const appEntry = join(packageRoot, "src", "index.tsx");
const execEntry = join(packageRoot, "src", "exec.ts");
const bunEntry = isHeadlessMode ? execEntry : appEntry;
const bunForwardArgs = isHeadlessMode ? forwardArgs.slice(1) : forwardArgs;

// Detect if parent process has a real TTY
const childStdio = isHeadlessMode
  ? ["ignore", "inherit", "inherit"]
  : parentHasTTY
    ? ["inherit", "inherit", "inherit"]
    : ["pipe", "pipe", "pipe"];

debugLaunch("resolved launch mode", {
  mode: isHeadlessMode ? "headless" : "interactive-ui",
  stdinIsTTY: parentStdinIsTTY,
  stdoutIsTTY: parentStdoutIsTTY,
  stderrIsTTY: parentStderrIsTTY,
  TERM: process.env.TERM,
  WT_SESSION: process.env.WT_SESSION,
  TERM_PROGRAM: process.env.TERM_PROGRAM,
  argv: process.argv,
  childStdio,
});

markExecTiming("bun_spawn_start", { executable: bunExecutable });
if (!isHeadlessMode && parentHasTTY) {
  writeIntendedTitle("before-bun-spawn");
}

const child = spawn(
  bunExecutable,
  ["run", "--silent", bunEntry, ...(bunForwardArgs.length > 0 ? ["--", ...bunForwardArgs] : [])],
  {
    cwd: workspaceRoot,
    stdio: childStdio,
    env: {
      ...process.env,
      CODEX_WORKSPACE_ROOT: workspaceRoot,
      CODEXA_LAUNCH_KIND: "installed-bin",
      CODEXA_PACKAGE_ROOT: packageRoot,
      CODEXA_LAUNCHER_SCRIPT: currentFile,
      CODEXA_RELAUNCH_EXECUTABLE: process.execPath,
      CODEXA_RELAUNCH_ARGS: JSON.stringify([currentFile, ...forwardArgs]),
      CODEXA_PARENT_HAS_TTY: parentHasTTY ? "1" : "0",
      CODEXA_HEADLESS_BENCHMARK: isHeadlessBenchmark ? "1" : "0",
      CODEXA_EXEC_TIMING_EPOCH_MS: String(launcherStartTimeMs),
      CODEXA_INITIAL_TERMINAL_TITLE: intendedTerminalTitle,
    },
  },
);

child.once("spawn", () => {
  if (!isHeadlessMode && parentHasTTY) {
    writeIntendedTitle("after-bun-spawn");
    stopLauncherTitleGuard?.();
    stopLauncherTitleGuard = null;
  }
});

if (!isHeadlessMode && !parentHasTTY) {
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

if (!isHeadlessMode) {
  const stripStdoutTitle = createTitleStripper({
    source: "bin/codexa.js:bun.stdout",
    stream: "stdout",
    origin: "child",
    action: "stripped",
  });
  const stripStderrTitle = createTitleStripper({
    source: "bin/codexa.js:bun.stderr",
    stream: "stderr",
    origin: "child",
    action: "stripped",
  });

  child.stdout?.on("data", (chunk) => {
    const safeChunk = stripStdoutTitle(chunk);
    if (safeChunk) process.stdout.write(safeChunk);
  });
  child.stderr?.on("data", (chunk) => {
    const safeChunk = stripStderrTitle(chunk);
    if (safeChunk) process.stderr.write(safeChunk);
  });
}

child.on("error", (error) => {
  if (!isHeadlessMode && parentHasTTY) {
    writeIntendedTitle("bun-spawn-error");
  }
  markExecTiming("bun_spawn_error", { message: error.message });
  console.error(`Failed to launch Bun: ${error.message}`);
  console.error("Bun is required to launch codexa. Install Bun, then run this command again.");
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (!isHeadlessMode && parentHasTTY) {
    writeIntendedTitle("bun-close");
    stopLauncherTitleGuard?.();
    stopLauncherTitleGuard = null;
  }
  markExecTiming("launcher_exit", { exit_code: code ?? 0, signal: signal ?? null });
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
