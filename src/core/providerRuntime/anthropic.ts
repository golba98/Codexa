import { runCommand } from "../process/CommandRunner.js";
import type { CommandResult } from "../process/CommandRunner.js";
import { sanitizeTerminalOutput } from "../terminalSanitize.js";
import type { BackendRunHandlers } from "../providers/types.js";
import { ANTHROPIC_FALLBACK_MODELS } from "./models.js";
import type { ProviderBackendKind, ProviderChatRequest, ProviderRouteValidationResult, ProviderRuntime } from "./types.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 1024;
const ANTHROPIC_TIMEOUT_MS = 120_000;
const ANTHROPIC_ROUTE_VALIDATION_TIMEOUT_MS = 30_000;
export const ANTHROPIC_ROUTE_SETUP_MESSAGE = "Anthropic/Claude is not configured for in-Codexa routing.\nSign in with Claude Code or set ANTHROPIC_API_KEY.";

type CommandRunner = typeof runCommand;

let claudeCodeValidated = false;

function getAnthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

export function isAnthropicRouteConfigured(): boolean {
  return getAnthropicApiKey() !== null || claudeCodeValidated;
}

export function resetAnthropicRouteValidationCacheForTests(): void {
  claudeCodeValidated = false;
}

async function runAnthropicApi(request: ProviderChatRequest): Promise<string> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error(ANTHROPIC_ROUTE_SETUP_MESSAGE);
  }

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: request.route.modelId,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      ...(request.projectInstructions?.content ? { system: request.projectInstructions.content } : {}),
      messages: [
        {
          role: "user",
          content: request.prompt,
        },
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic API request failed (${response.status}): ${sanitizeTerminalOutput(body).slice(0, 500)}`);
  }

  const parsed = JSON.parse(body) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = parsed.content
    ?.filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Anthropic API returned no assistant text.");
  }

  return text;
}

function runClaudeCode(request: ProviderChatRequest): Promise<string> {
  const args = [
    "--print",
    request.prompt,
  ];
  const runner = runCommand({
    executable: "claude",
    args,
    cwd: request.workspaceRoot,
    timeoutMs: ANTHROPIC_TIMEOUT_MS,
  });

  return runner.result.then((result) => {
    if (result.status !== "completed" || result.exitCode !== 0) {
      throw new Error(result.userMessage || result.stderr || "Claude Code headless route failed.");
    }

    return sanitizeTerminalOutput(result.stdout).trim();
  });
}

export async function validateAnthropicRoute(options: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  runCommandImpl?: CommandRunner;
  timeoutMs?: number;
}): Promise<ProviderRouteValidationResult> {
  const runner = (options.runCommandImpl ?? runCommand)({
    executable: "claude",
    args: ["--print", "Respond with READY only."],
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? ANTHROPIC_ROUTE_VALIDATION_TIMEOUT_MS,
  });
  const result = await runner.result;
  if (result.status === "completed" && result.exitCode === 0) {
    claudeCodeValidated = true;
    return {
      status: "ready",
      providerId: "anthropic",
      backendKind: "claude-code-auth",
      message: "Claude Code auth is configured.",
    };
  }

  claudeCodeValidated = false;
  if (getAnthropicApiKey() !== null) {
    return {
      status: "ready",
      providerId: "anthropic",
      backendKind: "anthropic-api-key",
      message: "Anthropic API key is configured.",
    };
  }

  return {
    status: "not-configured",
    providerId: "anthropic",
    backendKind: "unavailable",
    message: ANTHROPIC_ROUTE_SETUP_MESSAGE,
  };
}

function getAnthropicRuntimeBackendKind(): ProviderBackendKind {
  return claudeCodeValidated ? "claude-code-auth" : getAnthropicApiKey() ? "anthropic-api-key" : "claude-code-auth";
}

export const anthropicRuntime: ProviderRuntime = {
  providerId: "anthropic",
  label: "Anthropic/Claude",
  backendKind: "claude-code-auth",
  routeAvailable: true,
  routeStatus: "Uses Claude Code subscription-backed route when available, otherwise ANTHROPIC_API_KEY.",
  routeSetupMessage: ANTHROPIC_ROUTE_SETUP_MESSAGE,
  launchAvailable: true,
  isRouteConfigured: isAnthropicRouteConfigured,
  validateRoute: async ({ workspaceRoot }) => validateAnthropicRoute({
    cwd: workspaceRoot,
  }),
  discoverModels: () => ({
    status: "ready",
    providerId: "anthropic",
    backendKind: getAnthropicRuntimeBackendKind(),
    models: ANTHROPIC_FALLBACK_MODELS,
  }),
  run: (request, handlers: BackendRunHandlers) => {
    let cancelled = false;

    handlers.onProgress?.({
      id: "anthropic-route",
      source: "stdout",
      text: "Routing prompt through Anthropic/Claude inside Codexa...",
    });

    const runAnthropic = claudeCodeValidated
      ? runClaudeCode(request)
      : getAnthropicApiKey()
        ? runAnthropicApi(request)
        : runClaudeCode(request);

    runAnthropic
      .then((text) => {
        if (cancelled) return;
        handlers.onAssistantDelta?.(text);
        handlers.onFinalAnswerObserved?.(text);
        handlers.onResponse(text);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Anthropic/Claude in-Codexa routing failed.";
        handlers.onError(message);
      });

    return () => {
      cancelled = true;
    };
  },
};
