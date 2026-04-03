#!/usr/bin/env node

import { spawn, spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

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

const child = spawn(
  bunExecutable,
  ["run", "--silent", appEntry],
  {
    cwd: workspaceRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      CODEX_WORKSPACE_ROOT: workspaceRoot,
      CODEXA_LAUNCH_KIND: "installed-bin",
      CODEXA_PACKAGE_ROOT: packageRoot,
      CODEXA_LAUNCHER_SCRIPT: currentFile,
      CODEXA_RELAUNCH_EXECUTABLE: process.execPath,
      CODEXA_RELAUNCH_ARGS: JSON.stringify([currentFile]),
    },
  },
);

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
