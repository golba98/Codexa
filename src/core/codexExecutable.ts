import { spawn, spawnSync } from "child_process";
import { join } from "path";
import { CODEX_EXECUTABLE } from "../config/settings.js";

const DISCOVERY_TIMEOUT_MS = 2500;

let cachedExecutable: string | null = null;
let resolveInFlight: Promise<string> | null = null;

interface ProbeResult {
  ok: boolean;
  errorCode?: string;
}

interface SpawnOptions {
  stdio: ["ignore" | "pipe", "pipe", "pipe"];
}

export interface CapturedProcessOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export async function resolveCodexExecutable(): Promise<string> {
  if (cachedExecutable) return cachedExecutable;
  if (resolveInFlight) return resolveInFlight;

  resolveInFlight = (async () => {
    const candidates = collectExecutableCandidates();
    let lastErrorCode: string | undefined;

    for (const candidate of candidates) {
      const probe = await probeExecutable(candidate);
      if (probe.ok) {
        cachedExecutable = candidate;
        return candidate;
      }
      lastErrorCode = probe.errorCode ?? lastErrorCode;
    }

    const fallbackCode = lastErrorCode ?? "ENOENT";
    throw createExecutableResolutionError(fallbackCode, candidates);
  })();

  try {
    return await resolveInFlight;
  } finally {
    resolveInFlight = null;
  }
}

export function formatCodexLaunchError(err: NodeJS.ErrnoException): string {
  const detail = err.message ? `\n\nDetails: ${err.message}` : "";

  if (err.code === "ENOENT") {
    return [
      "Codex executable was not found in PATH.",
      "Set CODEX_EXECUTABLE to your working command/path, then restart Codexa.",
      "Alternative: install CLI with `npm install -g @openai/codex`.",
    ].join("\n") + detail;
  }

  if (err.code === "EACCES" || err.code === "EPERM") {
    return [
      "Codex appears installed but this process cannot launch it (permission blocked).",
      "Set CODEX_EXECUTABLE to a working CLI command/path and restart Codexa.",
      "Windows note: Codex docs recommend WSL for the best CLI experience.",
    ].join("\n") + detail;
  }

  return err.message;
}

export function createExecutableResolutionError(
  code: string,
  attemptedCandidates: string[],
): NodeJS.ErrnoException {
  const error = new Error(
    [
      "Unable to launch Codex executable from this process.",
      `Tried: ${attemptedCandidates.join(", ")}`,
      "Set CODEX_EXECUTABLE to a known working Codex command/path.",
    ].join("\n"),
  ) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function collectExecutableCandidates(): string[] {
  const set = new Set<string>();
  const push = (candidate?: string) => {
    const value = candidate?.trim();
    if (value) set.add(value);
  };

  push(CODEX_EXECUTABLE);
  push("codex");

  if (process.platform === "win32") {
    push("codex.exe");
    push("codex.cmd");
    const localAppAlias = process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "codex.exe")
      : undefined;
    push(localAppAlias);

    for (const discovered of discoverWithWhere()) {
      push(discovered);
    }
  }

  return [...set];
}

function discoverWithWhere(): string[] {
  const whereCandidates: string[] = [];
  const executable = process.env.SystemRoot
    ? join(process.env.SystemRoot, "System32", "where.exe")
    : "where.exe";
  const result = spawnSync(executable, ["codex"], { encoding: "utf8" });

  if (result.status !== 0 || !result.stdout) return whereCandidates;

  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  whereCandidates.push(...lines);
  return whereCandidates;
}

function probeExecutable(executable: string): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawnCodexProcess(executable, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
      resolve({ ok: false, errorCode: code });
      return;
    }
    let done = false;

    const finish = (result: ProbeResult) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      proc.kill();
      finish({ ok: false, errorCode: "ETIME" });
    }, DISCOVERY_TIMEOUT_MS);

    proc.on("error", (error) => {
      clearTimeout(timer);
      const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
      finish({ ok: false, errorCode: code });
    });

    proc.on("close", (exitCode) => {
      clearTimeout(timer);
      if (exitCode === 0) {
        finish({ ok: true });
      } else {
        finish({ ok: false, errorCode: `EXIT_${exitCode}` });
      }
    });
  });
}

export function spawnCodexProcess(
  executable: string,
  args: string[],
  options: SpawnOptions,
): ReturnType<typeof spawn> {
  if (executable.toLowerCase().endsWith(".cmd")) {
    return spawn("cmd.exe", ["/d", "/s", "/c", executable, ...args], options);
  }

  return spawn(executable, args, options);
}

export function captureCodexProcessOutput(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<CapturedProcessOutput> {
  return new Promise<CapturedProcessOutput>((resolve, reject) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawnCodexProcess(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const timer = setTimeout(() => {
      proc.kill();
      const error = new Error(`Timed out waiting for Codex command: ${args.join(" ")}`) as NodeJS.ErrnoException;
      error.code = "ETIME";
      finish(() => reject(error));
    }, timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      finish(() => reject(error));
    });

    proc.on("close", (exitCode) => {
      finish(() => resolve({
        exitCode,
        stdout,
        stderr,
      }));
    });
  });
}
