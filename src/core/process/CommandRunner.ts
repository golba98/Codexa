import { spawn, type ChildProcess } from "child_process";

export interface CommandSpec {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  shell?: boolean;
}

export interface CommandResult {
  status: "completed" | "failed" | "spawn_error" | "timeout" | "canceled";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  errorCode?: string;
  userMessage: string;
  debugMessage?: string;
}

export interface CommandStreamHandlers {
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

const ANSI_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function splitOutputLines(text: string): string[] {
  return stripAnsi(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function looksLikePath(line: string): boolean {
  return /[\\/]/.test(line) || /\.[a-z0-9_-]+$/i.test(line);
}

function buildUserMessage(result: {
  executable: string;
  code?: string;
  exitCode: number | null;
  stderr: string;
  signal: NodeJS.Signals | null;
  status: CommandResult["status"];
}): string {
  const stderrLine = stripAnsi(result.stderr).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (result.status === "spawn_error" && result.code === "ENOENT") {
    return `\`${result.executable}\` is not installed or not available on PATH.`;
  }
  if (result.status === "spawn_error" && result.code === "EACCES") {
    return `\`${result.executable}\` could not be executed because permission was denied.`;
  }
  if (result.status === "timeout") {
    return `Command timed out before it could finish.`;
  }
  if (result.status === "canceled") {
    return "Command was canceled.";
  }
  if (result.signal) {
    return `Command exited after receiving signal ${result.signal}.`;
  }
  if (result.exitCode === 1 && stderrLine?.match(/not recognized|not found|No such file/i)) {
    return stderrLine;
  }
  if (result.exitCode === 1 && result.executable === "rg" && !stderrLine) {
    return "ripgrep returned no matches.";
  }
  if (result.exitCode && result.exitCode !== 0) {
    return stderrLine ?? `Command exited with code ${result.exitCode}.`;
  }
  return "Command completed.";
}

export function summarizeCommandResult(command: string, result: Pick<CommandResult, "status" | "exitCode" | "signal" | "stdout" | "stderr" | "userMessage">): string {
  if (result.status !== "completed" || result.exitCode !== 0 || result.signal) {
    return result.userMessage;
  }

  const stdoutLines = splitOutputLines(result.stdout);
  if (stdoutLines.length === 0) {
    return "Completed with no output.";
  }

  const lowerCommand = command.toLowerCase();
  if (/\brg\b/.test(lowerCommand) && /--files\b/.test(lowerCommand)) {
    return `Found ${pluralize(stdoutLines.length, "file")}.`;
  }

  if (/\b(get-childitem|ls|dir)\b/.test(lowerCommand)) {
    return `Listed ${pluralize(stdoutLines.length, "item")}.`;
  }

  if (/\b(rg|grep|select-string|findstr)\b/.test(lowerCommand)) {
    return `Found ${pluralize(stdoutLines.length, "match", "matches")}.`;
  }

  if (stdoutLines.length === 1) {
    return stdoutLines[0]!;
  }

  if (stdoutLines.every(looksLikePath)) {
    return `Returned ${pluralize(stdoutLines.length, "path")}.`;
  }

  return `Produced ${pluralize(stdoutLines.length, "line")} of output.`;
}

export function runCommand(
  spec: CommandSpec,
  handlers: CommandStreamHandlers = {},
): { child: ChildProcess; result: Promise<CommandResult>; cancel: () => void } {
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let canceled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const child = spawn(spec.executable, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    shell: spec.shell ?? false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const result = new Promise<CommandResult>((resolve) => {
    const finish = (partial: Omit<CommandResult, "stdout" | "stderr" | "startedAt" | "endedAt" | "durationMs" | "userMessage"> & { endedAt?: number }) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const endedAt = partial.endedAt ?? Date.now();
      resolve({
        ...partial,
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        userMessage: buildUserMessage({
          executable: spec.executable,
          code: partial.errorCode,
          exitCode: partial.exitCode,
          stderr,
          signal: partial.signal,
          status: partial.status,
        }),
      });
    };

    child.stdout?.on("data", (buffer: Buffer) => {
      const text = buffer.toString("utf8");
      stdout += text;
      handlers.onStdout?.(stripAnsi(text));
    });

    child.stderr?.on("data", (buffer: Buffer) => {
      const text = buffer.toString("utf8");
      stderr += text;
      handlers.onStderr?.(stripAnsi(text));
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      finish({
        status: canceled ? "canceled" : "spawn_error",
        exitCode: null,
        signal: null,
        errorCode: error.code,
        debugMessage: error.message,
      });
    });

    child.once("close", (code, signal) => {
      finish({
        status: canceled ? "canceled" : code === 0 ? "completed" : "failed",
        exitCode: code,
        signal,
      });
    });

    if (spec.timeoutMs && spec.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        if (child.killed) return;
        child.kill();
        finish({
          status: "timeout",
          exitCode: null,
          signal: null,
          debugMessage: `Timed out after ${spec.timeoutMs}ms`,
        });
      }, spec.timeoutMs);
    }
  });

  return {
    child,
    result,
    cancel: () => {
      canceled = true;
      if (!child.killed) {
        try {
          child.kill();
        } catch {
          // ignore cancellation failures
        }
      }
    },
  };
}
