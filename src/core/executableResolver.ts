import { existsSync } from "fs";
import { join } from "path";
import { runCommand } from "./process/CommandRunner.js";

type CommandRunner = typeof runCommand;

export interface ExecutableResolverOptions {
  runCommandImpl?: CommandRunner;
  cwd?: string;
  configuredPath?: string | null;
  envOverrides?: string[];
  commandNames: string[];
  knownPathDirectories?: string[];
  knownFilePaths?: string[];
  label: string;
  allowBareFallback?: boolean;
  requireResolvedFile?: boolean;
}

function looksLikeAbsolutePath(value: string): boolean {
  return /[\\/]/.test(value) || /^[A-Za-z]:/.test(value);
}

function validateConfiguredExecutable(value: string, label: string): string {
  const trimmed = value.trim();
  if (looksLikeAbsolutePath(trimmed) && !existsSync(trimmed)) {
    throw new Error(
      `${label} path does not exist: "${trimmed}"\n` +
      `Check the path is correct and the file is accessible, or unset ${label}.`,
    );
  }
  return trimmed;
}

async function resolveWithWhere(
  runCommandImpl: CommandRunner,
  cwd: string,
  query: string,
  requireResolvedFile: boolean,
): Promise<string | null> {
  const whereRunner = runCommandImpl({
    executable: "where.exe",
    args: [query],
    cwd,
    timeoutMs: 5000,
  });
  const whereResult = await whereRunner.result;
  if (whereResult.status !== "completed" || whereResult.exitCode !== 0) return null;
  const lines = whereResult.stdout
    .trim()
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!requireResolvedFile || existsSync(line)) return line;
  }
  return null;
}

/**
 * Resolves an executable's location.
 *
 * Priority:
 *   1. Configured path override
 *   2. Environment variable overrides (in order)
 *   3. Windows PATH lookup by explicit command names (using where.exe)
 *   4. Windows known-path fallbacks (e.g. %APPDATA%\npm)
 *   5. Explicit known file fallbacks
 *   6. Bare name fallback, unless disabled
 */
export async function resolveExecutable(options: ExecutableResolverOptions): Promise<string> {
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const cwd = options.cwd ?? process.cwd();

  // 1. Configured path override
  if (options.configuredPath?.trim()) {
    return validateConfiguredExecutable(options.configuredPath, `${options.label}CommandPath`);
  }

  // 2. Environment variable overrides
  if (options.envOverrides) {
    for (const envVar of options.envOverrides) {
      const envOverride = process.env[envVar]?.trim();
      if (envOverride) {
        return validateConfiguredExecutable(envOverride, envVar);
      }
    }
  }

  // 3. Windows PATH lookup by explicit command names
  if (process.platform === "win32") {
    for (const candidate of options.commandNames) {
      const resolved = await resolveWithWhere(runCommandImpl, cwd, candidate, options.requireResolvedFile === true);
      if (resolved) return resolved;
    }
  }

  // 4. Windows known-path fallbacks
  if (process.platform === "win32" && options.knownPathDirectories) {
    const knownCandidates: string[] = [];
    for (const dir of options.knownPathDirectories) {
      for (const candidate of options.commandNames) {
        knownCandidates.push(join(dir, candidate));
      }
    }

    for (const candidate of knownCandidates) {
      if (existsSync(candidate)) return candidate;
    }
  }

  // 5. Explicit known file fallbacks
  for (const candidate of options.knownFilePaths ?? []) {
    if (existsSync(candidate)) return candidate;
  }

  if (options.allowBareFallback === false) {
    throw new Error(`${options.label} executable was not found.`);
  }

  // 6. Bare name fallback
  const bareName = options.commandNames.find(c => !c.includes('.')) || options.commandNames[0];
  return bareName;
}

/**
 * Builds the spawn spec for a resolved executable.
 * .cmd and .bat files must be invoked via `cmd.exe /d /s /c` on Windows.
 */
export function buildSpawnSpec(
  executable: string,
  args: string[],
): { executable: string; args: string[] } {
  if (process.platform === "win32") {
    const lower = executable.toLowerCase();
    if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
      return { executable: "cmd.exe", args: ["/d", "/s", "/c", executable, ...args] };
    }
  }
  return { executable, args };
}
