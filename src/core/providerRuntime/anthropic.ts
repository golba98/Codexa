import { sanitizeTerminalOutput } from "../terminalSanitize.js";
import type { BackendRunHandlers } from "../providers/types.js";
import { ANTHROPIC_FALLBACK_MODELS } from "./models.js";
import type { ProviderChatRequest, ProviderRuntime } from "./types.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 1024;
export const ANTHROPIC_ROUTE_SETUP_MESSAGE = "Anthropic/Claude is not configured for in-Codexa routing.\nSet ANTHROPIC_API_KEY, or choose Launch external CLI.";

function getAnthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

export function isAnthropicRouteConfigured(): boolean {
  return getAnthropicApiKey() !== null;
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

export const anthropicRuntime: ProviderRuntime = {
  providerId: "anthropic",
  label: "Anthropic/Claude",
  backendKind: "anthropic-api",
  routeAvailable: true,
  routeStatus: "Uses ANTHROPIC_API_KEY with the Anthropic Messages API.",
  routeSetupMessage: ANTHROPIC_ROUTE_SETUP_MESSAGE,
  launchAvailable: true,
  isRouteConfigured: isAnthropicRouteConfigured,
  discoverModels: () => ({
    status: "ready",
    providerId: "anthropic",
    backendKind: "anthropic-api",
    models: ANTHROPIC_FALLBACK_MODELS,
  }),
  run: (request, handlers: BackendRunHandlers) => {
    let cancelled = false;

    handlers.onProgress?.({
      id: "anthropic-route",
      source: "stdout",
      text: "Routing prompt through Anthropic/Claude inside Codexa...",
    });

    runAnthropicApi(request)
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
