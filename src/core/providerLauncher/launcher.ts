import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import type { ProviderConfig, ProviderLaunchCommand } from "./types.js";

export interface ProviderLaunchSpec {
  executable: string;
  args: string[];
  cwd: string;
  shell: boolean;
}

export type ProviderLaunchResult =
  | { status: "completed"; exitCode: number | null; signal: NodeJS.Signals | null; message: string }
  | { status: "disabled"; message: string }
  | { status: "missing-command"; message: string }
  | { status: "spawn-error"; message: string; errorCode?: string };

interface RawModeStream {
  isRaw?: boolean;
  setRawMode?: (enabled: boolean) => unknown;
}

export interface LaunchProviderCliOptions {
  cwd: string;
  stdin?: RawModeStream | null;
  beforeLaunch?: () => void;
  afterLaunch?: () => void;
  spawnImpl?: typeof spawn;
  commandExists?: (executable: string) => Promise<boolean> | boolean;
}

function formatCommand(command: ProviderLaunchCommand): string {
  return [command.executable, ...command.args].join(" ");
}

export function buildProviderLaunchSpec(provider: ProviderConfig, cwd: string): ProviderLaunchSpec | ProviderLaunchResult {
  if (!provider.enabled) {
    return {
      status: "disabled",
      message: `${provider.displayName} is disabled. Configure a command in .codexa/providers.json before launching it.`,
    };
  }

  if (!provider.launchCommand?.executable.trim()) {
    return {
      status: "missing-command",
      message: `${provider.displayName} does not have a launch command configured.`,
    };
  }

  return {
    executable: provider.launchCommand.executable,
    args: provider.launchCommand.args,
    cwd,
    shell: process.platform === "win32",
  };
}

function setRawMode(stdin: RawModeStream | null | undefined, enabled: boolean): void {
  try {
    stdin?.setRawMode?.(enabled);
  } catch {
    // Some test streams and redirected terminals do not support raw-mode changes.
  }
}

function executableLooksLikePath(executable: string): boolean {
  return /[\\/]/.test(executable) || /^[A-Za-z]:/.test(executable);
}

// Probe-spawns the executable to check if it exits cleanly — used instead of `which`/`where`
// because path-lookup alone doesn't verify the file is actually runnable.
function captureProcessExit(executable: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        stdio: "ignore",
        shell: false,
      });
    } catch {
      resolve(false);
      return;
    }

    child.once("error", () => resolve(false));
    child.once("close", (exitCode) => resolve(exitCode === 0));
  });
}

export async function commandExistsOnPath(executable: string): Promise<boolean> {
  const trimmed = executable.trim();
  if (!trimmed) return false;
  if (executableLooksLikePath(trimmed)) {
    return existsSync(trimmed);
  }

  if (process.platform === "win32") {
    return captureProcessExit("where.exe", [trimmed]);
  }

  return captureProcessExit("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", trimmed]);
}

function formatSpawnError(provider: ProviderConfig, executable: string, error: NodeJS.ErrnoException): ProviderLaunchResult {
  if (error.code === "ENOENT") {
    return {
      status: "missing-command",
      message: `${provider.displayName} could not be launched because \`${executable}\` is not installed or not available on PATH.`,
    };
  }

  if (error.code === "EACCES" || error.code === "EPERM") {
    return {
      status: "spawn-error",
      errorCode: error.code,
      message: `${provider.displayName} could not be launched because permission was denied for \`${executable}\`.`,
    };
  }

  return {
    status: "spawn-error",
    errorCode: error.code,
    message: `${provider.displayName} could not be launched. ${error.message}`,
  };
}

export async function launchProviderCli(
  provider: ProviderConfig,
  options: LaunchProviderCliOptions,
): Promise<ProviderLaunchResult> {
  const spec = buildProviderLaunchSpec(provider, options.cwd);
  if ("status" in spec) return spec;

  const spawnImpl = options.spawnImpl ?? spawn;
  const commandExists = options.commandExists ?? commandExistsOnPath;
  const available = await commandExists(spec.executable);
  if (!available) {
    return {
      status: "missing-command",
      message: `${provider.displayName} could not be launched because \`${spec.executable}\` is not installed or not available on PATH.`,
    };
  }

  const wasRaw = Boolean(options.stdin?.isRaw);
  options.beforeLaunch?.();
  setRawMode(options.stdin, false);

  try {
    return await new Promise<ProviderLaunchResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawnImpl(spec.executable, spec.args, {
          cwd: spec.cwd,
          shell: spec.shell,
          stdio: "inherit",
        });
      } catch (error) {
        resolve(formatSpawnError(provider, spec.executable, error as NodeJS.ErrnoException));
        return;
      }

      child.once("error", (error: NodeJS.ErrnoException) => {
        resolve(formatSpawnError(provider, spec.executable, error));
      });

      child.once("close", (exitCode, signal) => {
        resolve({
          status: "completed",
          exitCode,
          signal,
          message: `${provider.displayName} launch finished${exitCode === null ? "" : ` with exit code ${exitCode}`}.`,
        });
      });
    });
  } finally {
    if (wasRaw) {
      setRawMode(options.stdin, true);
    }
    options.afterLaunch?.();
  }
}

export function describeProviderLaunch(provider: ProviderConfig): string {
  if (!provider.enabled) {
    return `${provider.displayName} is disabled.`;
  }
  return provider.launchCommand
    ? `${provider.displayName}: ${formatCommand(provider.launchCommand)}`
    : `${provider.displayName} has no launch command configured.`;
}
