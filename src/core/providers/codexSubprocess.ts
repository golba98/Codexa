import { spawn } from "child_process";
import { AVAILABLE_MODELS } from "../../config/settings.js";
import { formatCodexLaunchError, spawnCodexProcess } from "../codexExecutable.js";
import { prepareCodexExecLaunch } from "../codexLaunch.js";
import { buildCodexPrompt } from "../codexPrompt.js";
import { createCodexJsonStreamParser } from "./codexJsonStream.js";
import {
  createCodexTranscriptStreamParser,
  createStdoutSanitizer,
  isStderrNoise,
  sanitizeCodexTranscript,
  stripAnsi,
  stripNonPrintableControls,
} from "./codexTranscript.js";
import type { BackendProvider } from "./types.js";

function looksLikeUnsupportedStructuredOutput(raw: string): boolean {
  return /experimental-json|unknown option|unrecognized option|unexpected argument|unexpected option/i.test(raw);
}

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
    let currentRawOutput = "";

    const finishError = (message: string) => {
      if (done) return;
      done = true;
      handlers.onError(message, currentRawOutput);
    };

    const finishSuccess = (response: string) => {
      if (done) return;
      done = true;
      handlers.onResponse(response);
    };

    const startAttempt = (structuredOutput: boolean) => {
      if (cancelled || done) return;
      void prepareCodexExecLaunch(
        {
          runtime: options.runtime,
          cwd: options.workspaceRoot,
          structuredOutput,
        },
        import.meta.url,
      )
        .then((launchPlan) => {
          if (cancelled || done) return;
          if (!launchPlan.ok) {
            finishError(launchPlan.error);
            return;
          }
          if (!launchPlan.executable) {
            finishError("Codex launch preparation did not return an executable.");
            return;
          }

          let rawStdout = "";
          let rawStderr = "";
          let stdoutLineBuffer = "";
          let mode: "undecided" | "json" | "legacy" = structuredOutput ? "undecided" : "legacy";

          const transcriptParser = createCodexTranscriptStreamParser({
            onThinkingLine: (line) => handlers.onProgress?.(line),
            onAssistantDelta: (chunk) => handlers.onAssistantDelta?.(chunk),
            onToolActivity: (activity) => handlers.onToolActivity?.(activity),
          });
          const transcriptStdoutSanitizer = createStdoutSanitizer();
          const transcriptStderrSanitizer = createStdoutSanitizer();
          const jsonParser = createCodexJsonStreamParser({
            onProgress: (line) => handlers.onProgress?.(line),
            onAssistantDelta: (chunk) => handlers.onAssistantDelta?.(chunk),
            onToolActivity: (activity) => handlers.onToolActivity?.(activity),
          });

          const feedTranscript = (text: string, stream: "stdout" | "stderr") => {
            const sanitizer = stream === "stdout" ? transcriptStdoutSanitizer : transcriptStderrSanitizer;
            const clean = sanitizer.process(text);
            if (clean) {
              transcriptParser.feed(clean);
            }
          };

          const switchToTranscriptFallback = () => {
            if (mode === "legacy") return;
            mode = "legacy";
            if (rawStdout) {
              feedTranscript(rawStdout, "stdout");
            }
            if (rawStderr) {
              feedTranscript(rawStderr, "stderr");
            }
            stdoutLineBuffer = "";
          };

          const processStructuredLines = (flush: boolean) => {
            while (true) {
              const newlineIndex = stdoutLineBuffer.indexOf("\n");
              if (newlineIndex === -1) {
                if (!flush) return;
                if (!stdoutLineBuffer) return;
              }

              const line = newlineIndex === -1
                ? stdoutLineBuffer
                : stdoutLineBuffer.slice(0, newlineIndex);
              stdoutLineBuffer = newlineIndex === -1 ? "" : stdoutLineBuffer.slice(newlineIndex + 1);
              const normalizedLine = line.replace(/\r$/, "");
              if (!normalizedLine.trim()) {
                continue;
              }

              const parsed = jsonParser.feedLine(normalizedLine);
              if (!parsed) {
                switchToTranscriptFallback();
                return;
              }
              mode = "json";
            }
          };

          proc = spawnCodexProcess(launchPlan.executable, launchPlan.args, { stdio: ["pipe", "pipe", "pipe"] });

          proc.stdin?.write(buildCodexPrompt(prompt, options.runtime));
          proc.stdin?.end();

          proc.stdout?.on("data", (chunk: Buffer) => {
            if (cancelled || done) return;
            const text = chunk.toString();
            currentRawOutput += text;
            rawStdout += text;

            if (mode === "legacy") {
              feedTranscript(text, "stdout");
              return;
            }

            stdoutLineBuffer += text;
            processStructuredLines(false);
          });

          proc.stderr?.on("data", (chunk: Buffer) => {
            if (cancelled || done) return;
            const text = chunk.toString();
            currentRawOutput += text;
            rawStderr += text;

            if (mode === "legacy") {
              feedTranscript(text, "stderr");
              return;
            }

            const lines = stripNonPrintableControls(stripAnsi(text))
              .replace(/\r\n/g, "\n")
              .replace(/\r/g, "\n")
              .split("\n");
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || isStderrNoise(trimmed)) continue;
              handlers.onProgress?.(trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed);
            }
          });

          proc.on("close", (code) => {
            if (cancelled || done) return;

            if (mode !== "legacy") {
              processStructuredLines(true);
            }

            if (mode === "legacy") {
              const remainingStdout = transcriptStdoutSanitizer.flush();
              if (remainingStdout) transcriptParser.feed(remainingStdout);
              const remainingStderr = transcriptStderrSanitizer.flush();
              if (remainingStderr) transcriptParser.feed(remainingStderr);
              transcriptParser.flush();
            }

            if (
              structuredOutput
              && code !== 0
              && !jsonParser.hasStructuredEvents()
              && looksLikeUnsupportedStructuredOutput(`${rawStdout}\n${rawStderr}`)
            ) {
              currentRawOutput = "";
              startAttempt(false);
              return;
            }

            const structuredFailure = jsonParser.getFailureMessage();
            if (structuredFailure) {
              finishError(structuredFailure);
              return;
            }

            if (code === 0) {
              const finalResponse = mode === "json"
                ? jsonParser.getFinalResponse().trim() || sanitizeCodexTranscript(currentRawOutput)
                : sanitizeCodexTranscript(currentRawOutput);
              finishSuccess(finalResponse);
              return;
            }

            finishError(`Process exited with code ${code}`);
          });

          proc.on("error", (err) => {
            if (cancelled || done) return;
            const errno = err as NodeJS.ErrnoException;
            finishError(formatCodexLaunchError(errno));
          });
        })
        .catch((error) => {
          const errno = error as NodeJS.ErrnoException;
          finishError(formatCodexLaunchError(errno));
        });
    };

    currentRawOutput = "";
    startAttempt(true);

    return () => {
      cancelled = true;
      done = true;
      proc?.kill();
    };
  },
};
