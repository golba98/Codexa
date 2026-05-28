#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(currentFile));
const forwardArgs = process.argv.slice(2);

/**
 * Resolves which local-repo source file the dev launcher runs, and the args to
 * forward to it. Interactive launches run src/index.tsx; `exec` and
 * `--headless-benchmark` run the headless src/exec.ts. Exported so tests can
 * prove the dev launcher always resolves to the LOCAL checkout.
 */
export function resolveLocalDevEntry(root, args) {
  const isHeadlessExec = args[0] === "exec";
  const isHeadlessBenchmark = args[0] === "--headless-benchmark";
  const isHeadlessMode = isHeadlessExec || isHeadlessBenchmark;
  return {
    isHeadlessMode,
    isHeadlessExec,
    isHeadlessBenchmark,
    entry: isHeadlessMode
      ? join(root, "src", "exec.ts")
      : join(root, "src", "index.tsx"),
    entryArgs: isHeadlessMode ? args.slice(1) : args,
  };
}

const { isHeadlessMode, isHeadlessBenchmark, entry, entryArgs } = resolveLocalDevEntry(repoRoot, forwardArgs);
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

function launch() {
  if (process.env.CODEXA_DEBUG_LAUNCH === "1") {
    process.stderr.write(
      `[codexa-dev:launch] source=local-repo channel=local-dev version=${formatLocalDevVersion()} entry=${entry}\n`,
    );
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
}

// Only launch when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  launch();
}
