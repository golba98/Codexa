#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(currentFile));
const launcherPath = join(repoRoot, "scripts", "run-local-dev.mjs");

export function resolveInstallBinDir(env = process.env) {
  const override = env.CODEXA_DEV_BIN_DIR?.trim();
  if (override) return override;

  try {
    const prefix = execFileSync("npm", ["prefix", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (prefix) {
      return process.platform === "win32" ? prefix : join(prefix, "bin");
    }
  } catch {
    // Fall back below when npm is not available.
  }

  return join(homedir(), ".local", "bin");
}

export function createCodexaDevShim(options = {}) {
  const binDir = options.binDir ?? resolveInstallBinDir(options.env ?? process.env);
  const shimPath = join(binDir, process.platform === "win32" ? "codexa-dev.cmd" : "codexa-dev");
  const quotedLauncher = JSON.stringify(launcherPath);
  const contents = process.platform === "win32"
    ? `@echo off\r\nnode ${quotedLauncher} %*\r\n`
    : `#!/usr/bin/env sh\nexec node ${quotedLauncher} "$@"\n`;

  mkdirSync(binDir, { recursive: true });
  writeFileSync(shimPath, contents, "utf8");
  if (process.platform !== "win32") {
    chmodSync(shimPath, 0o755);
  }

  return { binDir, shimPath, launcherPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = createCodexaDevShim();
  console.log(`Installed codexa-dev -> ${result.launcherPath}`);
  console.log(`Shim: ${result.shimPath}`);
  console.log("The published codexa command was not modified.");
}
