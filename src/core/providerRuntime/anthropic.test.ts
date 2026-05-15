import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRuntimeConfig, resolveRuntimeConfig } from "../../config/runtimeConfig.js";
import { ANTHROPIC_ROUTE_SETUP_MESSAGE, anthropicRuntime } from "./anthropic.js";
import type { ProviderChatRequest } from "./types.js";

function buildRequest(): ProviderChatRequest {
  return {
    prompt: "Say hi.",
    route: {
      providerId: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      backendKind: "anthropic-api",
      reasoning: "high",
    },
    runtime: resolveRuntimeConfig(normalizeRuntimeConfig({})),
    workspaceRoot: process.cwd(),
    projectInstructions: {
      path: "AGENTS.md",
      content: "Be brief.",
    },
  };
}

test("Anthropic runtime sends prompts through the Messages API", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  try {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    globalThis.fetch = (async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "Hi from Claude." }],
      }), { status: 200 });
    }) as typeof fetch;

    const response = await new Promise<string>((resolve, reject) => {
      anthropicRuntime.run?.(buildRequest(), {
        onResponse: resolve,
        onError: reject,
      });
    });

    assert.equal(response, "Hi from Claude.");
    assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
    assert.equal(capturedInit?.method, "POST");
    assert.equal((capturedInit?.headers as Record<string, string>)["x-api-key"], "test-anthropic-key");
    assert.equal((capturedInit?.headers as Record<string, string>)["anthropic-version"], "2023-06-01");

    const body = JSON.parse(String(capturedInit?.body)) as {
      model?: string;
      system?: string;
      messages?: Array<{ role?: string; content?: string }>;
    };
    assert.equal(body.model, "claude-sonnet-4-20250514");
    assert.equal(body.system, "Be brief.");
    assert.deepEqual(body.messages, [{ role: "user", content: "Say hi." }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  }
});

test("Anthropic runtime reports setup guidance without an API key", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  try {
    delete process.env.ANTHROPIC_API_KEY;

    const error = await new Promise<string>((resolve) => {
      anthropicRuntime.run?.(buildRequest(), {
        onResponse: () => resolve("unexpected response"),
        onError: resolve,
      });
    });

    assert.equal(error, ANTHROPIC_ROUTE_SETUP_MESSAGE);
  } finally {
    if (originalKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  }
});
