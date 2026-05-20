import { existsSync } from "fs";
import { join } from "path";
import { runCommand } from "../process/CommandRunner.js";
import { sanitizeTerminalOutput } from "../terminal/terminalSanitize.js";
import type { BackendRunHandlers } from "../providers/types.js";
import type {
  ProviderChatRequest,
  ProviderModelDiscoveryResult,
  ProviderRouteValidationResult,
  ProviderRuntime,
} from "./types.js";
import {
  classifyLines,
  extractAssistantOutput,
  makeClassifierState,
} from "./antigravityClassifier.js";
import {
  SUPPORTED_ANTIGRAVITY_MODELS,
  readCurrentAntigravityModel,
} from "./antigravitySettings.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const ANTIGRAVITY_TIMEOUT_MS = Number(process.env.CODEXA_ANTIGRAVITY_TIMEOUT_MS?.trim()) || 120_000;
const ANTIGRAVITY_PROBE_TIMEOUT_MS = 20_000;
const ANTIGRAVITY_HEALTH_PROMPT = "Respond with READY only.";
const ANTIGRAVITY_MODEL_PROBE_PROMPT =
  "Reply with exactly one line in this format: MODEL=<model>; REASONING=<High|Medium|Low|Thinking|Unknown>. No extra text.";
const MODEL_PROBE_RE = /^MODEL=(.+?);\s*REASONING=(High|Medium|Low|Thinking|Unknown)/im;

// ─── Executable resolution ────────────────────────────────────────────────────

export function resolveAntigravityExecutable(): string {
  if (process.env.LOCALAPPDATA) {
    const winPath = join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe");
    if (existsSync(winPath)) return winPath;
  }
  return "agy";
}

// ─── Probe cache ─────────────────────────────────────────────────────────────
// Stores the latest probe result so synchronous display paths (footer, provider
// list, status label) can read it without spawning a process.

let cachedProbeResult: AntigravityModelProbeResult | null = null;

export function getLatestAntigravityProbe(): AntigravityModelProbeResult | null {
  return cachedProbeResult;
}

export function resetAntigravityProbeForTests(): void {
  cachedProbeResult = null;
}

export function injectAntigravityProbeForTests(result: AntigravityModelProbeResult): void {
  cachedProbeResult = result;
}

// ─── Status ───────────────────────────────────────────────────────────────────

export type AntigravityStatus =
  | "notInstalled"
  | "installed"
  | "needsAuth"
  | "probing"
  | "ready"
  | "error";

function looksLikeAuthRequired(text: string): boolean {
  return (
    /authentication required|waiting for authentication|please visit\s+https?:\/\//i.test(text)
    || /accounts\.google\.com/i.test(text)
    || /paste the authorization code/i.test(text)
  );
}

// ─── Probes (internal — output never touches transcript/handlers) ─────────────

export async function probeAntigravityHealth(
  executable: string,
  cwd: string,
  timeoutMs = ANTIGRAVITY_PROBE_TIMEOUT_MS,
): Promise<AntigravityStatus> {
  const runner = runCommand(
    { executable, args: ["-p", ANTIGRAVITY_HEALTH_PROMPT], cwd, timeoutMs },
  );
  let result;
  try {
    result = await runner.result;
  } catch {
    return "error";
  }

  if (result.status === "spawn_error" && result.errorCode === "ENOENT") {
    return "notInstalled";
  }
  if (result.status === "spawn_error") {
    return "error";
  }

  const combined = sanitizeTerminalOutput(`${result.stdout}\n${result.stderr}`);
  if (looksLikeAuthRequired(combined)) {
    return "needsAuth";
  }
  if (/\bREADY\b/.test(combined) && (result.status === "completed" || result.exitCode === 0)) {
    return "ready";
  }
  if (result.status === "completed" && result.exitCode === 0 && combined.trim().length > 0) {
    // Process ran and produced output — likely ready even if it didn't say READY verbatim
    return "ready";
  }

  return result.exitCode !== 0 ? "error" : "installed";
}

export interface AntigravityModelProbeResult {
  modelDisplayName: string;
  reasoning: string;
  source: "antigravity-prompt-probe";
}

const PROBE_FALLBACK: AntigravityModelProbeResult = {
  modelDisplayName: "External Antigravity default",
  reasoning: "Unknown",
  source: "antigravity-prompt-probe",
};

export async function probeAntigravityModel(
  executable: string,
  cwd: string,
  timeoutMs = ANTIGRAVITY_PROBE_TIMEOUT_MS,
): Promise<AntigravityModelProbeResult> {
  const runner = runCommand(
    { executable, args: ["-p", ANTIGRAVITY_MODEL_PROBE_PROMPT], cwd, timeoutMs },
  );
  let result;
  try {
    result = await runner.result;
  } catch {
    return PROBE_FALLBACK;
  }

  if (result.status !== "completed" || result.exitCode !== 0) {
    return PROBE_FALLBACK;
  }

  const combined = sanitizeTerminalOutput(`${result.stdout}\n${result.stderr}`);
  const match = MODEL_PROBE_RE.exec(combined);
  if (!match) {
    return PROBE_FALLBACK;
  }

  return {
    modelDisplayName: match[1]!.trim(),
    reasoning: match[2]!.trim(),
    source: "antigravity-prompt-probe",
  };
}

// ─── Route validation ─────────────────────────────────────────────────────────

async function validateAntigravityRoute(options: { cwd: string }): Promise<ProviderRouteValidationResult> {
  const exe = resolveAntigravityExecutable();
  const status = await probeAntigravityHealth(exe, options.cwd);

  if (status === "notInstalled") {
    return {
      status: "not-configured",
      providerId: "antigravity",
      backendKind: "antigravity-cli-auth",
      message: "Antigravity CLI (agy) is not installed or not found on PATH.",
      diagnostics: { executablePath: exe, probeStatus: status },
    };
  }
  if (status === "needsAuth") {
    return {
      status: "not-configured",
      providerId: "antigravity",
      backendKind: "antigravity-cli-auth",
      message: "Antigravity CLI needs authentication. Run Antigravity login in a separate terminal, then refresh provider status.",
      diagnostics: { executablePath: exe, probeStatus: status },
    };
  }
  if (status === "ready") {
    return {
      status: "ready",
      providerId: "antigravity",
      backendKind: "antigravity-cli-auth",
      message: "Antigravity CLI is ready.",
      diagnostics: { executablePath: exe, probeStatus: status },
    };
  }

  return {
    status: "not-configured",
    providerId: "antigravity",
    backendKind: "antigravity-cli-auth",
    message: `Antigravity CLI probe returned status: ${status}.`,
    diagnostics: { executablePath: exe, probeStatus: status },
  };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

export function runAntigravityPrompt(
  request: ProviderChatRequest,
  handlers: BackendRunHandlers,
): () => void {
  const exe = resolveAntigravityExecutable();
  let cancelled = false;
  let authErrorEmitted = false;
  let earlyCancel: (() => void) | null = null;

  handlers.onProcessLifecycle?.("before-spawn");

  const classifierState = makeClassifierState(request.prompt);
  const stdoutChunks: string[] = [];

  const runner = runCommand(
    {
      executable: exe,
      args: ["-p", request.prompt],
      cwd: request.workspaceRoot,
      timeoutMs: ANTIGRAVITY_TIMEOUT_MS,
    },
    {
      onStdout: (text) => {
        stdoutChunks.push(text);
        // Early auth detection: terminate as soon as we see auth output
        if (!authErrorEmitted && looksLikeAuthRequired(text)) {
          authErrorEmitted = true;
          earlyCancel?.();
          if (!cancelled) {
            cancelled = true;
            handlers.onError(
              "Antigravity CLI needs authentication.\n"
              + "Run Antigravity login in a separate terminal, then return to Codexa and refresh provider status.",
            );
          }
        }
      },
      onProcessLifecycle: (event) => {
        handlers.onProcessLifecycle?.(event === "cancel" ? "cleanup" : event);
      },
    },
  );

  earlyCancel = runner.cancel;

  runner.result.then((result) => {
    if (cancelled) return;

    if (result.status === "spawn_error" && result.errorCode === "ENOENT") {
      handlers.onError("Antigravity CLI (agy) not found. Install it or add it to PATH, then try again.");
      return;
    }
    if (result.status === "timeout") {
      handlers.onError("Antigravity CLI timed out before producing a response.");
      return;
    }
    if (result.status === "canceled") {
      return;
    }

    // Classify full stdout through the output pipeline
    const rawStdout = sanitizeTerminalOutput(result.stdout);
    const rawLines = rawStdout.split("\n");
    const classified = classifyLines(rawLines, classifierState);
    const assistantOutput = extractAssistantOutput(classified);

    if (assistantOutput) {
      handlers.onAssistantDelta?.(assistantOutput);
      handlers.onFinalAnswerObserved?.(assistantOutput);
      handlers.onResponse(assistantOutput);
    } else if (looksLikeAuthRequired(sanitizeTerminalOutput(`${result.stdout}\n${result.stderr}`))) {
      handlers.onError(
        "Antigravity CLI needs authentication.\n"
        + "Run Antigravity login in a separate terminal, then return to Codexa and refresh provider status.",
      );
    } else {
      handlers.onError("Antigravity returned no user-facing response.");
    }
  }).catch((error) => {
    if (cancelled) return;
    const message = error instanceof Error ? error.message : "Antigravity in-Codexa routing failed.";
    handlers.onError(message);
  });

  return () => {
    cancelled = true;
    runner.cancel();
  };
}

// ─── Provider runtime ─────────────────────────────────────────────────────────

export const antigravityRuntime: ProviderRuntime = {
  providerId: "antigravity",
  label: "Antigravity CLI",
  modelPickerLabel: "Antigravity",
  backendKind: "antigravity-cli-auth",
  routeAvailable: true,
  routeStatus: "Routes through the Antigravity CLI (agy) headless prompt mode.",
  launchAvailable: false,

  isRouteConfigured() {
    const exe = resolveAntigravityExecutable();
    return existsSync(exe) || exe === "agy";
  },

  async validateRoute(request) {
    return validateAntigravityRoute({ cwd: request.workspaceRoot });
  },

  discoverModels(): ProviderModelDiscoveryResult {
    const probe = cachedProbeResult;
    const currentSettingsModel = readCurrentAntigravityModel();

    const models = SUPPORTED_ANTIGRAVITY_MODELS.map((entry) => {
      const isCurrentlySaved = entry.settingsString === currentSettingsModel;
      const isProbeMatch = probe
        && probe.modelDisplayName === entry.displayLabel
        && probe.reasoning === entry.reasoning;

      return {
        id: entry.settingsString,
        modelId: entry.settingsString,
        label: entry.displayLabel,
        description: isProbeMatch
          ? `Active · Detected via probe · Reasoning: ${entry.reasoning}`
          : isCurrentlySaved
            ? `Saved in Antigravity settings · Reasoning: ${entry.reasoning}`
            : entry.description,
        defaultReasoningLevel: entry.reasoning.toLowerCase(),
        supportedReasoningLevels: null as null,
        source: isProbeMatch ? "discovered" as const : isCurrentlySaved ? "settings" as const : "fallback" as const,
      };
    });

    return {
      status: "ready",
      providerId: "antigravity",
      backendKind: "antigravity-cli-auth",
      models,
      ...(probe ? {
        diagnostics: {
          detectedModel: probe.modelDisplayName,
          detectedReasoning: probe.reasoning,
          detectionSource: probe.source,
          currentSettingsModel: currentSettingsModel ?? "unknown",
        },
      } : {}),
    };
  },

  async refreshModels({ cwd }) {
    const exe = resolveAntigravityExecutable();
    const probe = await probeAntigravityModel(exe, cwd);
    cachedProbeResult = probe;
    return {
      status: "ready",
      providerId: "antigravity",
      backendKind: "antigravity-cli-auth",
      models: [
        {
          id: "external-antigravity-default",
          modelId: "external-antigravity-default",
          label: probe.modelDisplayName,
          description: `Detected via probe · Reasoning: ${probe.reasoning}`,
          defaultReasoningLevel: probe.reasoning.toLowerCase(),
          supportedReasoningLevels: null,
          source: "discovered",
        },
      ],
      diagnostics: {
        detectedModel: probe.modelDisplayName,
        detectedReasoning: probe.reasoning,
        detectionSource: probe.source,
        executablePath: exe,
      },
    };
  },

  run(request: ProviderChatRequest, handlers: BackendRunHandlers): () => void {
    return runAntigravityPrompt(request, handlers);
  },
};
