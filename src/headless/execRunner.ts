import type { LaunchArgs } from "../config/launchArgs.js";
import { type LayeredConfigResult, resolveLayeredConfig } from "../config/layeredConfig.js";
import {
  mergeRuntimeConfig,
  type ResolvedRuntimeConfig,
  resolveRuntimeConfig,
} from "../config/runtimeConfig.js";
import { isNoiseLine } from "../core/providers/codexTranscript.js";
import { getBackendProvider } from "../core/providers/registry.js";
import type {
  BackendProvider,
  BackendRunHandlers,
  ProviderRunControl,
} from "../core/providers/types.js";
import { normalizeLineBreaks } from "../core/shared/text.js";
import { errorMessage } from "../core/shared/values.js";
import { sanitizeTerminalOutput } from "../core/terminal/terminalSanitize.js";
import type { ConversationRecord } from "../core/workspace/conversationStore.js";
import {
  loadProjectInstructions,
  type ProjectInstructionsLoadResult,
} from "../core/workspace/projectInstructions.js";
import { resolveWorkspaceRoot } from "../core/workspace/workspaceRoot.js";
import { toProviderConversationHistory } from "../session/conversation.js";
import type { RunToolActivity } from "../session/types.js";
import { resolveExecutionContext } from "./context.js";

// ─── Types & constants ────────────────────────────────────────────────────────

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
  benchmarkDiagnostics?: HeadlessExecTiming;
  promptPolicy?: "raw" | "wrapped";
  providerId?: string;
  saved?: ConversationRecord;
  signal?: AbortSignal;
  handlers?: Partial<BackendRunHandlers>;
  context?: ReturnType<typeof resolveExecutionContext>;
}

export interface HeadlessExecResult {
  exitCode: number;
  text?: string;
  error?: string;
}

interface HeadlessExecDependencies {
  resolveWorkspaceRoot: () => string;
  resolveLayeredConfig: (options: {
    workspaceRoot: string;
    launchArgs: LaunchArgs;
  }) => LayeredConfigResult;
  resolveRuntimeConfig: typeof resolveRuntimeConfig;
  getBackendProvider: (id: string) => BackendProvider;
  loadProjectInstructions: (workspaceRoot: string) => ProjectInstructionsLoadResult;
}

type HeadlessExecTimingValue = string | number | boolean | null | readonly string[];

export interface HeadlessExecTiming {
  enabled: boolean;
  mark: (phase: string, fields?: Record<string, HeadlessExecTimingValue>) => void;
}

export function createHeadlessExecTiming(options: {
  enabled: boolean;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  startTimeMs?: number;
}): HeadlessExecTiming {
  const startTimeMs = options.startTimeMs ?? Date.now();
  const stderr = options.stderr ?? process.stderr;
  let previousElapsedMs = 0;

  return {
    enabled: options.enabled,
    mark: (phase, fields = {}) => {
      if (!options.enabled) return;
      const elapsedMs = Date.now() - startTimeMs;
      const deltaMs = elapsedMs - previousElapsedMs;
      previousElapsedMs = elapsedMs;
      const formattedFields = Object.entries(fields)
        .map(([key, value]) => {
          const serialized =
            Array.isArray(value) || typeof value === "string"
              ? JSON.stringify(value)
              : String(value);
          return `${key}=${serialized}`;
        })
        .join(" ");
      writeLine(
        stderr,
        `[ubume exec timing] phase=${phase} elapsed_ms=${elapsedMs} delta_ms=${deltaMs}${formattedFields ? ` ${formattedFields}` : ""}`,
      );
    },
  };
}

const DEFAULT_DEPENDENCIES: HeadlessExecDependencies = {
  resolveWorkspaceRoot,
  resolveLayeredConfig,
  resolveRuntimeConfig,
  getBackendProvider,
  loadProjectInstructions,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeLine(stream: Pick<NodeJS.WriteStream, "write">, line: string): void {
  stream.write(`${line}\n`);
}

function formatDiagnosticText(value: string): string {
  return normalizeLineBreaks(sanitizeTerminalOutput(value)).trim();
}

function writeDiagnostic(
  stderr: Pick<NodeJS.WriteStream, "write">,
  kind: string,
  message: string,
): void {
  const safeMessage = formatDiagnosticText(message);
  if (!safeMessage) return;
  writeLine(stderr, `[ubume exec] ${kind}: ${safeMessage.replace(/\n/g, "\n  ")}`);
}

function formatToolActivity(activity: RunToolActivity): string {
  const summary = activity.summary?.trim();
  const safeSummary = summary && isProcessTerminationNoise(summary) ? "" : summary;
  return summary
    ? `${activity.status}: ${activity.command}${safeSummary ? `\n${safeSummary}` : ""}`
    : `${activity.status}: ${activity.command}`;
}

function isStructuredCodexEventLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as { type?: unknown };
    return typeof parsed.type === "string" && /^(?:thread|turn|item)\./.test(parsed.type);
  } catch {
    return false;
  }
}

function isProcessTerminationNoise(line: string): boolean {
  return /^SUCCESS: The process with PID \d+ .* has been terminated\.$/.test(line.trim());
}

function shouldSuppressAssistantChunk(chunk: string): boolean {
  const lines = normalizeLineBreaks(chunk)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    lines.length > 0 &&
    lines.every((line) => isStructuredCodexEventLine(line) || isProcessTerminationNoise(line))
  );
}

function formatRuntimeStartup(
  runtime: ResolvedRuntimeConfig,
  workspaceRoot: string,
  provider: BackendProvider,
): string {
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

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runHeadlessExec(
  options: HeadlessExecOptions,
  io: HeadlessExecIo = { stdout: process.stdout, stderr: process.stderr },
  dependencies: Partial<HeadlessExecDependencies> = {},
): Promise<HeadlessExecResult> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const diagnostics = options.benchmarkDiagnostics;
  const promptPolicy = options.promptPolicy ?? "raw";
  diagnostics?.mark("run_headless_start");
  const workspaceRoot = options.workspaceRoot ?? deps.resolveWorkspaceRoot();
  diagnostics?.mark("workspace_resolved", { workspace_root: workspaceRoot });
  const context =
    options.context ??
    (dependencies.getBackendProvider
      ? undefined
      : resolveExecutionContext(workspaceRoot, options.launchArgs, {
          providerId: options.providerId,
          saved: options.saved,
        }));
  const layeredConfig =
    context?.layered ??
    deps.resolveLayeredConfig({
      workspaceRoot,
      launchArgs: options.launchArgs,
    });
  diagnostics?.mark("layered_config_loaded");
  const runtimeConfig = mergeRuntimeConfig(layeredConfig.runtime, { planMode: false });
  const runtime = context?.runtime ?? deps.resolveRuntimeConfig(runtimeConfig);
  diagnostics?.mark("runtime_config_resolved", {
    effective_model: runtime.model,
    effective_reasoning_effort: runtime.reasoningLevel,
    prompt_policy: promptPolicy,
  });

  const projectInstructionsLoad =
    promptPolicy === "wrapped"
      ? deps.loadProjectInstructions(workspaceRoot)
      : ({ status: "missing" } as ProjectInstructionsLoadResult);
  const projectInstructions =
    projectInstructionsLoad.status === "loaded" ? projectInstructionsLoad.instructions : null;
  diagnostics?.mark("project_instructions_resolved", {
    whether_project_instructions_loaded: projectInstructionsLoad.status === "loaded",
    project_instructions_path:
      projectInstructions?.path ??
      ("path" in projectInstructionsLoad ? projectInstructionsLoad.path : null),
    project_instructions_character_count: projectInstructions?.content.length ?? 0,
  });

  const provider = context?.provider ?? deps.getBackendProvider(runtime.provider);
  diagnostics?.mark("provider_created", {
    provider_id: provider.id,
    provider_label: provider.label,
  });

  writeDiagnostic(io.stderr, "startup", formatRuntimeStartup(runtime, workspaceRoot, provider));

  if (layeredConfig.diagnostics.ignoredEntries.length > 0) {
    writeDiagnostic(
      io.stderr,
      "config",
      `ignored ${layeredConfig.diagnostics.ignoredEntries.join("; ")}`,
    );
  }

  if (projectInstructionsLoad.status === "error") {
    writeDiagnostic(
      io.stderr,
      "config",
      `could not load project instructions at ${projectInstructionsLoad.path}: ${projectInstructionsLoad.message}`,
    );
  }

  if (!provider.run) {
    writeDiagnostic(io.stderr, "error", `${provider.label} is unavailable for headless execution.`);
    return { exitCode: HEADLESS_EXEC_PROVIDER_UNAVAILABLE };
  }

  let control: ProviderRunControl | undefined;
  let cleanup: (() => void) | undefined;
  let interrupt: () => void = () => undefined;
  const result = await new Promise<HeadlessExecResult>((resolve) => {
    let settled = false;
    let streamedText = "";
    let finalText = "";
    const settle = (exitCode: number, error?: string) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, text: finalText || streamedText, ...(error ? { error } : {}) });
    };

    interrupt = () => {
      if (settled) return;
      cleanup?.();
      settle(130, "Run interrupted.");
    };
    options.signal?.addEventListener("abort", interrupt, { once: true });
    if (options.signal?.aborted) {
      interrupt();
      return;
    }
    try {
      const toolActivityIds = new Set<string>();

      const cancel = provider.run!(
        options.prompt,
        {
          runtime,
          workspaceRoot,
          projectInstructions,
          promptPolicy,
          conversationHistory: options.saved
            ? toProviderConversationHistory(options.saved.messages, {
                includeActivitySummaries:
                  context?.route.providerId !== "local" && context?.route.providerId !== "mistral",
              })
            : undefined,
          localContextCheckpoint: options.saved?.metadata.localContextCheckpoint,
        },
        {
          onRunControl: (value) => {
            control = value;
            options.handlers?.onRunControl?.(value);
          },
          onToolApproval: async (request) => {
            const decision = (await options.handlers?.onToolApproval?.(request)) ?? "deny";
            if (decision === "deny") {
              const message =
                "This tool requires interactive approval. Use the TUI or configure an explicit approval policy.";
              writeDiagnostic(io.stderr, "approval", message);
              settle(3, message);
              cleanup?.();
            }
            return decision;
          },
          onLocalContextCheckpoint: options.handlers?.onLocalContextCheckpoint,
          onLocalHarnessSession: options.handlers?.onLocalHarnessSession,
          onNativeSession: options.handlers?.onNativeSession,
          onAssistantDelta: (chunk) => {
            const safeChunk = sanitizeTerminalOutput(chunk, { preserveTabs: false, tabSize: 2 });
            if (shouldSuppressAssistantChunk(safeChunk)) return;
            if (!safeChunk) return;
            if (settled) return;
            streamedText += safeChunk;
            options.handlers?.onAssistantDelta?.(safeChunk);
            io.stdout.write(safeChunk);
          },
          onProgress: (update) => {
            if (settled) return;
            options.handlers?.onProgress?.(update);
            const safeText = formatDiagnosticText(update.text);
            if (!safeText || isNoiseLine(safeText) || isProcessTerminationNoise(safeText)) return;
            if (update.source === "tool" && toolActivityIds.has(update.id)) return;
            writeDiagnostic(io.stderr, update.source, safeText);
          },
          onToolActivity: (activity) => {
            if (settled) return;
            options.handlers?.onToolActivity?.(activity);
            toolActivityIds.add(activity.id);
            writeDiagnostic(io.stderr, "tool", formatToolActivity(activity));
          },
          onFinalAnswerObserved: (response) => {
            diagnostics?.mark("final_answer_observed", {
              final_answer_character_count: response.length,
            });
          },
          onResponse: (response) => {
            if (settled) return;
            const safeResponse = sanitizeTerminalOutput(response, {
              preserveTabs: false,
              tabSize: 2,
            });
            finalText = safeResponse;
            if (safeResponse.startsWith(streamedText))
              io.stdout.write(safeResponse.slice(streamedText.length));
            else if (safeResponse && safeResponse !== streamedText)
              io.stdout.write(`${streamedText ? "\n" : ""}${safeResponse}`);
            options.handlers?.onResponse?.(safeResponse);
            settle(0);
          },
          onError: (message, rawOutput) => {
            const details = [message, rawOutput].filter((value) => value?.trim()).join("\n");
            writeDiagnostic(io.stderr, "error", details || "Provider run failed.");
            settle(HEADLESS_EXEC_RUN_FAILED, details || "Provider run failed.");
          },
          benchmarkHooks: diagnostics?.enabled
            ? {
                onProviderPrepStart: () => diagnostics.mark("provider_prep_start"),
                onProviderPrepComplete: () => diagnostics.mark("provider_prep_complete"),
                onProviderPromptPrepared: ({ policy, characterCount }) =>
                  diagnostics.mark("provider_prompt_prepared", {
                    prompt_policy: policy,
                    prompt_character_count_before_wrapping: options.prompt.length,
                    prompt_character_count_after_wrapping: characterCount,
                  }),
                onCodexProcessSpawned: ({ executable, argv }) =>
                  diagnostics.mark("codex_process_spawned", {
                    codex_argv_preview: [executable, ...argv].join(" "),
                  }),
                onFirstStdout: (observed = true) => diagnostics.mark("first_stdout", { observed }),
                onFirstStderr: (observed = true) => diagnostics.mark("first_stderr", { observed }),
                onCodexProcessExit: (exitCode) =>
                  diagnostics.mark("codex_process_exit", {
                    exit_code: exitCode,
                  }),
                onCleanupStart: () => diagnostics.mark("cleanup_start"),
                onCleanupComplete: ({ skipped }) =>
                  diagnostics.mark("cleanup_complete", { skipped }),
              }
            : undefined,
        },
      );
      let canceled = false;
      cleanup = () => {
        if (canceled) return;
        canceled = true;
        cancel();
      };
      if (options.signal?.aborted) cleanup();
    } catch (error) {
      writeDiagnostic(io.stderr, "error", errorMessage(error));
      settle(HEADLESS_EXEC_RUN_FAILED, errorMessage(error));
    }
  });
  try {
    cleanup?.();
    if (control) await control.stopped;
    return result;
  } finally {
    options.signal?.removeEventListener("abort", interrupt);
  }
}
