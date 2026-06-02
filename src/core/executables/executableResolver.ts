import { existsSync } from "fs";
import { join } from "path";
import { runCommand } from "../process/CommandRunner.js";
import {
  normalizeExecutableValue,
  validateWindowsBatchExecutableForCmd,
} from "../process/processValidation.js";

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

function validateConfiguredExecutable(value: string, label: string, cwd: string): string {
  return normalizeExecutableValue(value, {
    label,
    cwd,
    requireExistingPath: /[\\/]/.test(value) || /^[\s"']*[A-Za-z]:/.test(value),
    allowBareExecutable: true,
  });
}

function validateResolvedExecutable(value: string, label: string, cwd: string): string {
  return normalizeExecutableValue(value, {
    label,
    cwd,
    requireExistingPath: false,
    allowBareExecutable: true,
  });
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
    let candidate: string;
    try {
      candidate = validateResolvedExecutable(line, "where.exe result", cwd);
    } catch {
      continue;
    }
    if (!requireResolvedFile || existsSync(candidate)) return candidate;
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
    return validateConfiguredExecutable(options.configuredPath, `${options.label}CommandPath`, cwd);
  }

  // 2. Environment variable overrides
  if (options.envOverrides) {
    for (const envVar of options.envOverrides) {
      const envOverride = process.env[envVar]?.trim();
      if (envOverride) {
        return validateConfiguredExecutable(envOverride, envVar, cwd);
      }
    }
  }

  // 3. Windows PATH lookup by explicit command names (where.exe returns null on non-Windows gracefully)
  for (const candidate of options.commandNames) {
    const resolved = await resolveWithWhere(runCommandImpl, cwd, candidate, options.requireResolvedFile === true);
    if (resolved) return resolved;
  }

  // 4. Windows known-path fallbacks (existsSync returns false for non-existent paths on any platform)
  if (options.knownPathDirectories) {
    const knownCandidates: string[] = [];
    for (const dir of options.knownPathDirectories) {
      for (const candidate of options.commandNames) {
        knownCandidates.push(join(dir, candidate));
      }
    }

    for (const candidate of knownCandidates) {
      const validated = validateResolvedExecutable(candidate, `${options.label} known executable`, cwd);
      if (existsSync(validated)) return validated;
    }
  }

  // 5. Explicit known file fallbacks
  for (const candidate of options.knownFilePaths ?? []) {
    const validated = validateResolvedExecutable(candidate, `${options.label} known executable`, cwd);
    if (existsSync(validated)) return validated;
  }

  if (options.allowBareFallback === false) {
    throw new Error(`${options.label} executable was not found.`);
  }

  // 6. Bare name fallback — prefer the name without an extension (works on Unix).
  const bareName = options.commandNames.find((c) => !c.includes(".")) ?? options.commandNames[0];
  return validateResolvedExecutable(bareName!, `${options.label} executable`, cwd);
}

/**
 * Builds the spawn spec for a resolved executable.
 * .cmd and .bat files must be invoked via `cmd.exe /d /s /c` on Windows.
 *
 * `platform` defaults to the host platform; it is injectable so the Windows
 * wrapping branch can be unit-tested from any OS.
 */
export function buildSpawnSpec(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { executable: string; args: string[] } {
  const validatedExecutable = validateResolvedExecutable(executable, "Executable", process.cwd());
  if (platform === "win32") {
    const lower = validatedExecutable.toLowerCase();
    if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
      validateWindowsBatchExecutableForCmd(validatedExecutable, "Windows batch executable");
      return { executable: "cmd.exe", args: ["/d", "/s", "/c", "call", validatedExecutable, ...args] };
    }
  }
  return { executable: validatedExecutable, args };
}
