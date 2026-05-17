import { spawn } from "child_process";
import type { ResolvedRuntimeConfig } from "../config/runtimeConfig.js";
import { formatCodexLaunchError, spawnCodexProcess } from "./executables/codexExecutable.js";
import { prepareCodexExecLaunch } from "./codexLaunch.js";
import { createTerminalTitleSequenceStripper } from "./terminal/terminalTitle.js";

export interface CodexHandlers {
  onLine: (line: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export function streamCodex(
  prompt: string,
  runtime: ResolvedRuntimeConfig,
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
      runtime,
      cwd: workspaceRoot,
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

      proc = spawnCodexProcess(
        launchPlan.executable,
        launchPlan.args,
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      proc.stdin?.write(prompt);
      proc.stdin?.end();

      let buffer = "";

      // Strip title escape sequences from child output — prevents the subprocess from overwriting the terminal title.
      const stdoutTitleStripper = createTerminalTitleSequenceStripper({
        source: "src/core/codex.ts:codex.stdout",
        stream: "stdout",
        origin: "codex-cli",
      });
      const stderrTitleStripper = createTerminalTitleSequenceStripper({
        source: "src/core/codex.ts:codex.stderr",
        stream: "stderr",
        origin: "codex-cli",
      });

      const flushLine = (line: string) => {
        if (cancelled || done) return;
        if (line.trim()) handlers.onLine(line);
      };

      const handleText = (text: string) => {
        if (!text) return;
        if (cancelled || done) return;
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(flushLine);
      };

      proc.stdout?.on("data", (chunk: Buffer) => handleText(stdoutTitleStripper.process(chunk)));
      proc.stderr?.on("data", (chunk: Buffer) => handleText(stderrTitleStripper.process(chunk)));

      proc.on("close", (code) => {
        if (cancelled || done) return;
        handleText(stdoutTitleStripper.flush());
        handleText(stderrTitleStripper.flush());
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
