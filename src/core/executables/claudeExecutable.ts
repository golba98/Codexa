import { join } from "path";
import { runCommand } from "../process/CommandRunner.js";
import { buildSpawnSpec, resolveExecutable } from "./executableResolver.js";

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
 *   2. where.exe lookup on Windows — finds the real .exe/.cmd/.bat even when "claude"
 *      is shadowed by a PowerShell function (Invoke-Claude @args)
 *   3. Windows known-path fallbacks: %USERPROFILE%\.local\bin and %USERPROFILE%\bin
 *   4. Bare "claude" fallback (works on Unix; Windows fallback if nothing else found)
 */
export async function resolveClaudeExecutable(options?: {
  runCommandImpl?: CommandRunner;
  cwd?: string;
  configuredPath?: string | null;
}): Promise<string> {
  if (!options?.configuredPath && !options?.runCommandImpl && cachedExecutable !== null) {
    return cachedExecutable;
  }

  const knownPathDirectories: string[] = [];
  const userProfile = process.env.USERPROFILE;
  if (userProfile) {
    knownPathDirectories.push(join(userProfile, ".local", "bin"));
    knownPathDirectories.push(join(userProfile, "bin"));
  }

  const result = await resolveExecutable({
    runCommandImpl: options?.runCommandImpl,
    cwd: options?.cwd,
    configuredPath: options?.configuredPath,
    envOverrides: ["CLAUDE_EXECUTABLE"],
    commandNames: ["claude.exe", "claude.cmd", "claude.bat", "claude"],
    knownPathDirectories,
    label: "claude",
  });

  if (!options?.configuredPath && !options?.runCommandImpl) {
    cachedExecutable = result;
  }
  return result;
}

/**
 * Builds the spawn spec for a resolved Claude executable.
 */
export function buildClaudeSpawnSpec(
  executable: string,
  args: string[],
): { executable: string; args: string[] } {
  return buildSpawnSpec(executable, args);
}
