import { existsSync } from "fs";
import { runCommand } from "./process/CommandRunner.js";

type CommandRunner = typeof runCommand;

let cachedExecutable: string | null = null;

export function resetClaudeExecutableCacheForTests(): void {
  cachedExecutable = null;
}

/**
 * Returns the resolved Claude CLI executable (full path or bare name).
 *
 * Priority:
 *   1. CLAUDE_EXECUTABLE env var (if set)
 *   2. where.exe lookup on Windows — finds the real .exe/.cmd even when "claude"
 *      is shadowed by a PowerShell function (Invoke-Claude @args)
 *   3. Bare "claude" fallback (works on Unix; Windows fallback if where.exe finds nothing)
 *
 * Throws if CLAUDE_EXECUTABLE is set to an absolute path that does not exist.
 * When runCommandImpl is injected (for tests), the cache is bypassed.
 */
export async function resolveClaudeExecutable(options?: {
  runCommandImpl?: CommandRunner;
  cwd?: string;
}): Promise<string> {
  if (!options?.runCommandImpl && cachedExecutable !== null) {
    return cachedExecutable;
  }

  const result = await doResolve(
    options?.runCommandImpl ?? runCommand,
    options?.cwd ?? process.cwd(),
  );

  if (!options?.runCommandImpl) {
    cachedExecutable = result;
  }
  return result;
}

function looksLikeAbsolutePath(value: string): boolean {
  return /[\\/]/.test(value) || /^[A-Za-z]:/.test(value);
}

async function doResolve(runCommandImpl: CommandRunner, cwd: string): Promise<string> {
  // 1. CLAUDE_EXECUTABLE env var override
  const envOverride = process.env.CLAUDE_EXECUTABLE?.trim();
  if (envOverride) {
    if (looksLikeAbsolutePath(envOverride) && !existsSync(envOverride)) {
      throw new Error(
        `CLAUDE_EXECUTABLE path does not exist: "${envOverride}"\n` +
        `Check the path is correct and the file is accessible, or unset CLAUDE_EXECUTABLE.`,
      );
    }
    return envOverride;
  }

  // 2. Windows: use where.exe to find the real file behind any PS function wrapper
  if (process.platform === "win32") {
    const whereRunner = runCommandImpl({
      executable: "where.exe",
      args: ["claude"],
      cwd,
      timeoutMs: 5000,
    });
    const whereResult = await whereRunner.result;
    if (whereResult.status === "completed" && whereResult.exitCode === 0) {
      const lines = whereResult.stdout
        .trim()
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter(Boolean);
      // Prefer .exe over .cmd over anything else
      const resolved =
        lines.find((l) => l.toLowerCase().endsWith(".exe")) ??
        lines.find((l) => l.toLowerCase().endsWith(".cmd")) ??
        lines[0];
      if (resolved) return resolved;
    }
  }

  // 3. Bare name fallback
  return "claude";
}

/**
 * Builds the spawn spec for a resolved Claude executable.
 * .cmd files must be invoked via `cmd.exe /d /s /c` on Windows to execute correctly.
 */
export function buildClaudeSpawnSpec(
  executable: string,
  args: string[],
): { executable: string; args: string[] } {
  if (process.platform === "win32" && executable.toLowerCase().endsWith(".cmd")) {
    return { executable: "cmd.exe", args: ["/d", "/s", "/c", executable, ...args] };
  }
  return { executable, args };
}
