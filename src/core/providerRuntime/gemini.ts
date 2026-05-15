import { runCommand } from "../process/CommandRunner.js";
import type { CommandResult } from "../process/CommandRunner.js";
import { sanitizeTerminalOutput } from "../terminalSanitize.js";
import type { BackendRunHandlers } from "../providers/types.js";
import { GEMINI_FALLBACK_MODELS } from "./models.js";
import type { ProviderBackendKind, ProviderChatRequest, ProviderRouteValidationResult, ProviderRuntime } from "./types.js";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_TIMEOUT_MS = 120_000;
const GEMINI_ROUTE_VALIDATION_TIMEOUT_MS = 30_000;
export const GEMINI_ROUTE_SETUP_MESSAGE = "Google/Gemini is not configured for in-Codexa routing yet. Sign in with Gemini CLI headless auth or set GEMINI_API_KEY / GOOGLE_API_KEY.";

type CommandRunner = typeof runCommand;

let geminiCliHeadlessValidated = false;

function getGeminiApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || null;
}

export function hasGeminiApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return getGeminiApiKey(env) !== null;
}

export function isGeminiRouteConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return hasGeminiApiKey(env) || geminiCliHeadlessValidated;
}

export function resetGeminiRouteValidationCacheForTests(): void {
  geminiCliHeadlessValidated = false;
}

function parseGeminiJsonResponse(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null && "response" in parsed) {
      const response = (parsed as { response?: unknown }).response;
      return typeof response === "string" ? response : null;
    }
  } catch {
    return null;
  }

  return null;
}

async function runGeminiApi(request: ProviderChatRequest): Promise<string> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(GEMINI_ROUTE_SETUP_MESSAGE);
  }

  const response = await fetch(`${GEMINI_API_BASE_URL}/${encodeURIComponent(request.route.modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: request.prompt }],
        },
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini API request failed (${response.status}): ${sanitizeTerminalOutput(body).slice(0, 500)}`);
  }

  const parsed = JSON.parse(body) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = parsed.candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini API returned no assistant text.");
  }

  return text;
}

function runGeminiCli(request: ProviderChatRequest): Promise<string> {
  const args = [
    "--prompt",
    request.prompt,
    "--model",
    request.route.modelId,
    "--output-format",
    "json",
  ];
  const runner = runCommand({
    executable: "gemini",
    args,
    cwd: request.workspaceRoot,
    timeoutMs: GEMINI_TIMEOUT_MS,
  });

  return runner.result.then((result) => {
    if (result.status !== "completed" || result.exitCode !== 0) {
      throw new Error(result.userMessage || result.stderr || "Gemini CLI headless route failed.");
    }

    const parsed = parseGeminiJsonResponse(result.stdout);
    return sanitizeTerminalOutput(parsed ?? result.stdout).trim();
  });
}

function buildGeminiCliValidationArgs(modelId: string): string[] {
  return [
    "--prompt",
    "Respond with READY only.",
    "--model",
    modelId,
    "--output-format",
    "json",
  ];
}

function isGeminiHeadlessResultUsable(result: CommandResult): boolean {
  return result.status === "completed" && result.exitCode === 0;
}

export async function validateGeminiRoute(options: {
  cwd: string;
  modelId: string;
  env?: NodeJS.ProcessEnv;
  runCommandImpl?: CommandRunner;
  timeoutMs?: number;
}): Promise<ProviderRouteValidationResult> {
  const runner = (options.runCommandImpl ?? runCommand)({
    executable: "gemini",
    args: buildGeminiCliValidationArgs(options.modelId),
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? GEMINI_ROUTE_VALIDATION_TIMEOUT_MS,
  });
  const result = await runner.result;
  if (isGeminiHeadlessResultUsable(result)) {
    geminiCliHeadlessValidated = true;
    return {
      status: "ready",
      providerId: "google",
      backendKind: "gemini-cli-auth",
      message: "Gemini CLI auth is configured.",
    };
  }

  geminiCliHeadlessValidated = false;
  if (hasGeminiApiKey(options.env)) {
    return {
      status: "ready",
      providerId: "google",
      backendKind: "gemini-api-key",
      message: "Google/Gemini API key is configured.",
    };
  }

  return {
    status: "not-configured",
    providerId: "google",
    backendKind: "unavailable",
    message: GEMINI_ROUTE_SETUP_MESSAGE,
  };
}

function getGeminiRuntimeBackendKind(): ProviderBackendKind {
  return geminiCliHeadlessValidated ? "gemini-cli-auth" : hasGeminiApiKey() ? "gemini-api-key" : "gemini-cli-auth";
}

export const geminiRuntime: ProviderRuntime = {
  providerId: "google",
  label: "Google/Gemini",
  backendKind: "gemini-cli-auth",
  routeAvailable: true,
  routeStatus: "Uses Gemini CLI subscription-backed route when available, otherwise GEMINI_API_KEY or GOOGLE_API_KEY.",
  routeSetupMessage: GEMINI_ROUTE_SETUP_MESSAGE,
  launchAvailable: true,
  isRouteConfigured: isGeminiRouteConfigured,
  validateRoute: async ({ route, workspaceRoot }) => validateGeminiRoute({
    cwd: workspaceRoot,
    modelId: route.modelId,
  }),
  discoverModels: () => ({
    status: "ready",
    providerId: "google",
    backendKind: getGeminiRuntimeBackendKind(),
    models: GEMINI_FALLBACK_MODELS,
  }),
  run: (request, handlers: BackendRunHandlers) => {
    let cancelled = false;

    handlers.onProgress?.({
      id: "gemini-route",
      source: "stdout",
      text: "Routing prompt through Google/Gemini inside Codexa...",
    });

    const runGemini = geminiCliHeadlessValidated
      ? runGeminiCli(request)
      : hasGeminiApiKey()
        ? runGeminiApi(request)
        : runGeminiCli(request);

    runGemini
      .then((text) => {
        if (cancelled) return;
        handlers.onAssistantDelta?.(text);
        handlers.onFinalAnswerObserved?.(text);
        handlers.onResponse(text);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Google/Gemini in-Codexa routing failed.";
        handlers.onError(message);
      });

    return () => {
      cancelled = true;
    };
  },
};
