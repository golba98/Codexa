import {
  resolveLayeredConfig,
  type LayeredConfigResult,
} from "../config/layeredConfig.js";
import type { LaunchArgs } from "../config/launchArgs.js";
import {
  mergeRuntimeConfig,
  resolveRuntimeConfig,
  type ResolvedRuntimeConfig,
} from "../config/runtimeConfig.js";
import { loadProjectInstructions, type ProjectInstructionsLoadResult } from "../core/projectInstructions.js";
import { getBackendProvider } from "../core/providers/registry.js";
import type { BackendProvider } from "../core/providers/types.js";
import { isNoiseLine } from "../core/providers/codexTranscript.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { resolveWorkspaceRoot } from "../core/workspaceRoot.js";
import type { RunToolActivity } from "../session/types.js";

export const HEADLESS_EXEC_PARSE_ERROR = 2;
export const HEADLESS_EXEC_PROVIDER_UNAVAILABLE = 3;
export const HEADLESS_EXEC_RUN_FAILED = 1;

export interface HeadlessExecIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export interface HeadlessExecOptions {
  prompt: string;
  launchArgs: LaunchArgs;
  workspaceRoot?: string;
}

export interface HeadlessExecResult {
  exitCode: number;
}

export interface HeadlessExecDependencies {
  resolveWorkspaceRoot: () => string;
  resolveLayeredConfig: (options: { workspaceRoot: string; launchArgs: LaunchArgs }) => LayeredConfigResult;
  resolveRuntimeConfig: typeof resolveRuntimeConfig;
  getBackendProvider: (id: string) => BackendProvider;
  loadProjectInstructions: (workspaceRoot: string) => ProjectInstructionsLoadResult;
}

const DEFAULT_DEPENDENCIES: HeadlessExecDependencies = {
  resolveWorkspaceRoot,
  resolveLayeredConfig,
  resolveRuntimeConfig,
  getBackendProvider,
  loadProjectInstructions,
};

function writeLine(stream: Pick<NodeJS.WriteStream, "write">, line: string): void {
  stream.write(`${line}\n`);
}

function formatDiagnosticText(value: string): string {
  return sanitizeTerminalOutput(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function writeDiagnostic(stderr: Pick<NodeJS.WriteStream, "write">, kind: string, message: string): void {
  const safeMessage = formatDiagnosticText(message);
  if (!safeMessage) return;
  writeLine(stderr, `[codexa exec] ${kind}: ${safeMessage.replace(/\n/g, "\n  ")}`);
}

function formatToolActivity(activity: RunToolActivity): string {
  const summary = activity.summary?.trim();
  return summary
    ? `${activity.status}: ${activity.command}\n${summary}`
    : `${activity.status}: ${activity.command}`;
}

function isStructuredCodexEventLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as { type?: unknown };
    return typeof parsed.type === "string"
      && /^(?:thread|turn|item)\./.test(parsed.type);
  } catch {
    return false;
  }
}

function isProcessTerminationNoise(line: string): boolean {
  return /^SUCCESS: The process with PID \d+ .* has been terminated\.$/.test(line.trim());
}

function shouldSuppressAssistantChunk(chunk: string): boolean {
  const lines = chunk
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length > 0
    && lines.every((line) => isStructuredCodexEventLine(line) || isProcessTerminationNoise(line));
}

function formatRuntimeStartup(runtime: ResolvedRuntimeConfig, workspaceRoot: string, provider: BackendProvider): string {
  return [
    `workspace ${workspaceRoot}`,
    `provider ${provider.label} (${provider.id})`,
    `model ${runtime.model}`,
    `mode ${runtime.mode}`,
    `planMode ${runtime.planMode ? "enabled" : "disabled"}`,
    `sandbox ${runtime.policy.sandboxMode}`,
    `approval ${runtime.policy.approvalPolicy}`,
    `network ${runtime.policy.networkAccess ? "enabled" : "disabled"}`,
  ].join("; ");
}

export async function runHeadlessExec(
  options: HeadlessExecOptions,
  io: HeadlessExecIo = { stdout: process.stdout, stderr: process.stderr },
  dependencies: Partial<HeadlessExecDependencies> = {},
): Promise<HeadlessExecResult> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const workspaceRoot = options.workspaceRoot ?? deps.resolveWorkspaceRoot();
  const layeredConfig = deps.resolveLayeredConfig({
    workspaceRoot,
    launchArgs: options.launchArgs,
  });
  const runtimeConfig = mergeRuntimeConfig(layeredConfig.runtime, { planMode: false });
  const runtime = deps.resolveRuntimeConfig(runtimeConfig);
  const provider = deps.getBackendProvider(runtime.provider);

  writeDiagnostic(io.stderr, "startup", formatRuntimeStartup(runtime, workspaceRoot, provider));

  if (layeredConfig.diagnostics.ignoredEntries.length > 0) {
    writeDiagnostic(io.stderr, "config", `ignored ${layeredConfig.diagnostics.ignoredEntries.join("; ")}`);
  }

  const projectInstructionsLoad = deps.loadProjectInstructions(workspaceRoot);
  const projectInstructions = projectInstructionsLoad.status === "loaded"
    ? projectInstructionsLoad.instructions
    : null;
  if (projectInstructionsLoad.status === "error") {
    writeDiagnostic(io.stderr, "config", `could not load project instructions at ${projectInstructionsLoad.path}: ${projectInstructionsLoad.message}`);
  }

  if (!provider.run) {
    writeDiagnostic(io.stderr, "error", `${provider.label} is unavailable for headless execution.`);
    return { exitCode: HEADLESS_EXEC_PROVIDER_UNAVAILABLE };
  }

  return await new Promise<HeadlessExecResult>((resolve) => {
    let settled = false;
    let streamedAssistant = "";

    const settle = (exitCode: number) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode });
    };

    try {
      provider.run!(
        options.prompt,
        { runtime, workspaceRoot, projectInstructions },
        {
          onAssistantDelta: (chunk) => {
            const safeChunk = sanitizeTerminalOutput(chunk, { preserveTabs: false, tabSize: 2 });
            if (shouldSuppressAssistantChunk(safeChunk)) return;
            if (!safeChunk) return;
            streamedAssistant += safeChunk;
            io.stdout.write(safeChunk);
          },
          onProgress: (update) => {
            const safeText = formatDiagnosticText(update.text);
            if (!safeText || isNoiseLine(safeText)) return;
            writeDiagnostic(io.stderr, update.source, safeText);
          },
          onToolActivity: (activity) => {
            writeDiagnostic(io.stderr, "tool", formatToolActivity(activity));
          },
          onResponse: (response) => {
            const safeResponse = sanitizeTerminalOutput(response, { preserveTabs: false, tabSize: 2 });
            if (!streamedAssistant.trim() && safeResponse) {
              io.stdout.write(safeResponse);
            }
            settle(0);
          },
          onError: (message, rawOutput) => {
            const details = [message, rawOutput].filter((value) => value?.trim()).join("\n");
            writeDiagnostic(io.stderr, "error", details || "Provider run failed.");
            settle(HEADLESS_EXEC_RUN_FAILED);
          },
        },
      );
    } catch (error) {
      writeDiagnostic(io.stderr, "error", error instanceof Error ? error.message : String(error));
      settle(HEADLESS_EXEC_RUN_FAILED);
    }
  });
}
