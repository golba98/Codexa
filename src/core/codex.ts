import { spawn } from "child_process";
import { buildCodexExecArgs } from "../config/settings.js";
import { formatCodexLaunchError, resolveCodexExecutable, spawnCodexProcess } from "./codexExecutable.js";

export interface CodexHandlers {
  onLine: (line: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export function streamCodex(
  prompt: string,
  model: string,
  mode: string,
  reasoningLevel: string,
  workspaceRoot: string,
  handlers: CodexHandlers,
): () => void {
  let done = false;
  let cancelled = false;
  let proc: ReturnType<typeof spawn> | null = null;
  const finishError = (message: string) => {
    if (done) return;
    done = true;
    handlers.onError(message);
  };
  const finishSuccess = () => {
    if (done) return;
    done = true;
    handlers.onDone();
  };

  void resolveCodexExecutable()
    .then((executable) => {
      if (cancelled) return;

      proc = spawnCodexProcess(
        executable,
        buildCodexExecArgs(model, mode, workspaceRoot, reasoningLevel, false),
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      proc.stdin?.write(prompt);
      proc.stdin?.end();

      let buffer = "";

      const flushLine = (line: string) => {
        if (cancelled || done) return;
        if (line.trim()) handlers.onLine(line);
      };

      const handleChunk = (chunk: Buffer) => {
        if (cancelled || done) return;
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(flushLine);
      };

      proc.stdout?.on("data", handleChunk);
      proc.stderr?.on("data", handleChunk);

      proc.on("close", (code) => {
        if (cancelled || done) return;
        if (buffer.trim()) flushLine(buffer);
        buffer = "";
        if (done) return;
        if (code === 0) {
          finishSuccess();
        } else {
          finishError(`Process exited with code ${code}`);
        }
      });

      proc.on("error", (err) => {
        if (cancelled || done) return;
        const errno = err as NodeJS.ErrnoException;
        const msg = formatCodexLaunchError(errno);
        finishError(msg);
      });
    })
    .catch((error) => {
      const errno = error as NodeJS.ErrnoException;
      finishError(formatCodexLaunchError(errno));
    });

  return () => {
    cancelled = true;
    done = true;
    proc?.kill();
  };
}
