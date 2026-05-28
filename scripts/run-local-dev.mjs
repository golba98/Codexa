#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(currentFile));
const forwardArgs = process.argv.slice(2);
const isHeadlessExec = forwardArgs[0] === "exec";
const isHeadlessBenchmark = forwardArgs[0] === "--headless-benchmark";
const isHeadlessMode = isHeadlessExec || isHeadlessBenchmark;
const entry = isHeadlessMode
  ? join(repoRoot, "src", "exec.ts")
  : join(repoRoot, "src", "index.tsx");
const entryArgs = isHeadlessMode ? forwardArgs.slice(1) : forwardArgs;
const bunExecutable = process.env.CODEXA_BUN_EXECUTABLE?.trim()
  || (process.platform === "win32" ? "bun.exe" : "bun");

function hasFlag(args, longFlag, shortFlag) {
  for (const arg of args) {
    if (arg === "--") return false;
    if (arg === longFlag || arg === shortFlag) return true;
  }
  return false;
}

function readPackageVersion() {
  try {
    const raw = readFileSync(join(repoRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}

function formatLocalDevVersion() {
  const version = readPackageVersion();
  return version ? `${version}-dev local` : "unknown-dev local";
}

function printHelp() {
  console.log(`codexa-dev ${formatLocalDevVersion()}

Usage:
  codexa-dev
  codexa-dev "explain this repo"
  codexa-dev exec "print the current directory"
  codexa-dev [options] [prompt]

This command runs the local repository source with CODEXA_CHANNEL=local-dev.
It does not replace or modify the published codexa command.
`);
}

if (!isHeadlessMode && hasFlag(forwardArgs, "--help", "-h")) {
  printHelp();
  process.exit(0);
}

if (!isHeadlessMode && hasFlag(forwardArgs, "--version", "-v")) {
  console.log(formatLocalDevVersion());
  process.exit(0);
}

const child = spawn(
  bunExecutable,
  ["run", "--silent", entry, ...(entryArgs.length > 0 ? ["--", ...entryArgs] : [])],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      CODEX_WORKSPACE_ROOT: process.cwd(),
      CODEXA_CHANNEL: "local-dev",
      CODEXA_LAUNCH_KIND: "dev-run",
      CODEXA_PACKAGE_ROOT: repoRoot,
      CODEXA_LAUNCHER_SCRIPT: currentFile,
      CODEXA_RELAUNCH_EXECUTABLE: process.execPath,
      CODEXA_RELAUNCH_ARGS: JSON.stringify([currentFile, ...forwardArgs]),
      CODEXA_HEADLESS_BENCHMARK: isHeadlessBenchmark ? "1" : "0",
    },
  },
);

child.on("error", (error) => {
  console.error(`Failed to launch local Codexa: ${error.message}`);
  console.error("Bun is required to launch codexa-dev. Install Bun, then run this command again.");
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
