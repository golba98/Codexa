import { spawn } from "child_process";
import { getLegacyRuntimePolicyForMode, type AvailableMode } from "../config/settings.js";
import { formatCodexLaunchError, spawnCodexProcess } from "./codexExecutable.js";
import { prepareCodexExecLaunch } from "./codexLaunch.js";

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

  void prepareCodexExecLaunch(
    {
          model,
          cwd: workspaceRoot,
          runtimePolicy: getLegacyRuntimePolicyForMode(mode as AvailableMode),
          reasoningLevel,
          structuredOutput: false,
        },
    import.meta.url,
  )
    .then((launchPlan) => {
      if (cancelled) return;
      if (!launchPlan.ok) {
        finishError(launchPlan.error);
        return;
      }
      if (!launchPlan.executable) {
        finishError("Codex launch preparation did not return an executable.");
        return;
      }

      proc = spawnCodexProcess(launchPlan.executable, launchPlan.args, { stdio: ["pipe", "pipe", "pipe"] });

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
