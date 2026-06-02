import { runCommand } from "../process/CommandRunner.js";
import { resolveExecutable } from "./executableResolver.js";

type CommandRunner = typeof runCommand;

let cachedExecutable: string | null = null;

export function resetAgyExecutableCacheForTests(): void {
  cachedExecutable = null;
}

/**
 * Returns the resolved Antigravity CLI executable (full path or bare name).
 *
 * Priority:
 *   1. Configured path override (antigravityCommandPath)
 *   2. AGY_EXECUTABLE env var
 *   3. Windows PATH lookup for real files: agy.exe, agy.cmd, agy.bat, agy
 *   4. Bare name fallback "agy" (Unix PATH resolution)
 */
export async function resolveAgyExecutable(options?: {
  runCommandImpl?: CommandRunner;
  cwd?: string;
  configuredPath?: string | null;
}): Promise<string> {
  if (!options?.configuredPath && !options?.runCommandImpl && cachedExecutable !== null) {
    return cachedExecutable;
  }

  const result = await resolveExecutable({
    runCommandImpl: options?.runCommandImpl,
    cwd: options?.cwd,
    configuredPath: options?.configuredPath,
    envOverrides: ["AGY_EXECUTABLE"],
    commandNames: process.platform === "win32"
      ? ["agy.exe", "agy.cmd", "agy.bat", "agy"]
      : ["agy"],
    knownPathDirectories: [],
    knownFilePaths: [],
    label: "antigravity",
    allowBareFallback: true,
  });

  if (!options?.configuredPath && !options?.runCommandImpl) {
    cachedExecutable = result;
  }
  return result;
}
