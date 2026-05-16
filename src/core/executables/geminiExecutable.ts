import { join } from "path";
import { runCommand } from "../process/CommandRunner.js";
import { resolveExecutable } from "./executableResolver.js";

type CommandRunner = typeof runCommand;

let cachedExecutable: string | null = null;

export function resetGeminiExecutableCacheForTests(): void {
  cachedExecutable = null;
}

/**
 * Returns the resolved Gemini CLI executable (full path or bare name).
 *
 * Priority:
 *   1. Configured path override (geminiCommandPath)
 *   2. GEMINI_EXECUTABLE or GEMINI_CLI_PATH env var
 *   3. Windows PATH lookup for real files: gemini.exe, gemini.cmd, gemini.bat, gemini
 *   4. Windows where.exe gemini fallback
 *   5. Common npm/global locations on Windows
 *   6. Known user path fallback
 */
export async function resolveGeminiExecutable(options?: {
  runCommandImpl?: CommandRunner;
  cwd?: string;
  configuredPath?: string | null;
}): Promise<string> {
  if (!options?.configuredPath && !options?.runCommandImpl && cachedExecutable !== null) {
    return cachedExecutable;
  }

  const knownPathDirectories: string[] = [];
  const userProfile = process.env.USERPROFILE;
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;

  if (process.platform === "win32") {
    if (appData) {
      knownPathDirectories.push(join(appData, "npm"));
    }
    if (localAppData) {
      knownPathDirectories.push(join(localAppData, "Programs", "nodejs"));
    }
  }

  if (userProfile) {
    knownPathDirectories.push(join(userProfile, ".local", "bin"));
    knownPathDirectories.push(join(userProfile, "bin"));
  }

  const result = await resolveExecutable({
    runCommandImpl: options?.runCommandImpl,
    cwd: options?.cwd,
    configuredPath: options?.configuredPath,
    envOverrides: ["GEMINI_EXECUTABLE", "GEMINI_CLI_PATH"],
    commandNames: ["gemini.exe", "gemini.cmd", "gemini.bat", "gemini"],
    knownPathDirectories,
    knownFilePaths: [
      "C:\\Users\\jorda\\AppData\\Roaming\\npm\\gemini.cmd",
    ],
    label: "gemini",
    allowBareFallback: process.platform !== "win32",
    requireResolvedFile: true,
  });

  if (!options?.configuredPath && !options?.runCommandImpl) {
    cachedExecutable = result;
  }
  return result;
}

/**
 * Builds the spawn spec for a resolved Gemini executable.
 */
export function buildGeminiSpawnSpec(
  executable: string,
  args: string[],
): { executable: string; args: string[]; shell?: boolean } {
  return { executable, args };
}
