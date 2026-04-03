import { spawn } from "child_process";
import { AVAILABLE_MODELS, buildCodexExecArgs } from "../../config/settings.js";
import { formatCodexLaunchError, resolveCodexExecutable, spawnCodexProcess } from "../codexExecutable.js";
import { buildCodexPrompt } from "../codexPrompt.js";
import { createCodexTranscriptStreamParser, sanitizeCodexTranscript } from "./codexTranscript.js";
import type { BackendProvider } from "./types.js";

export const codexSubprocessProvider: BackendProvider = {
  id: "codex-subprocess",
  label: "Codexa",
  description: "Direct connection to the Codex neural network.",
  authState: "delegated",
  authLabel: "Authenticated via Codex",
  statusMessage: "Authentication is managed via Codexa.",
  supportsModels: (model) => (AVAILABLE_MODELS as readonly string[]).includes(model),
  run: (prompt, options, handlers) => {
    let done = false;
    let cancelled = false;
    let proc: ReturnType<typeof spawn> | null = null;
    let rawOutput = "";

    const finishError = (message: string) => {
      if (done) return;
      done = true;
      handlers.onError(message, rawOutput);
    };

    const finishSuccess = () => {
      if (done) return;
      done = true;
      handlers.onResponse(sanitizeCodexTranscript(rawOutput));
    };

    void resolveCodexExecutable()
      .then((executable) => {
        if (cancelled) return;

        proc = spawnCodexProcess(
          executable,
          buildCodexExecArgs(
            options.model,
            options.mode,
            options.workspaceRoot,
            options.reasoningLevel,
          ),
          { stdio: ["pipe", "pipe", "pipe"] },
        );

        proc.stdin?.write(buildCodexPrompt(prompt, options.mode));
        proc.stdin?.end();

        const parser = createCodexTranscriptStreamParser({
          onThinkingLine: (line) => handlers.onProgress?.(line),
          onAssistantDelta: (chunk) => handlers.onAssistantDelta?.(chunk),
          onToolActivity: (activity) => handlers.onToolActivity?.(activity),
        });
        const handleChunk = (chunk: Buffer) => {
          if (cancelled || done) return;
          const text = chunk.toString();
          rawOutput += text;
          parser.feed(text);
        };
        proc.stdout?.on("data", handleChunk);
        proc.stderr?.on("data", handleChunk);

        proc.on("close", (code) => {
          if (cancelled || done) return;
          parser.flush();
          if (code === 0) {
            finishSuccess();
            return;
          }
          finishError(`Process exited with code ${code}`);
        });

        proc.on("error", (err) => {
          if (cancelled || done) return;
          const errno = err as NodeJS.ErrnoException;
          const message = formatCodexLaunchError(errno);
          finishError(message);
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
  },
};
