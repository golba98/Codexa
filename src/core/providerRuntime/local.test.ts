import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeRuntimeConfig, resolveRuntimeConfig } from "../../config/runtimeConfig.js";
import {
  checkLocalProvider,
  discoverLocalModels,
  resetLocalProviderStateForTests,
  resolveLocalProviderConfig,
  runLocalDiagnostics,
  runLocalOpenAiCompatible,
} from "./local.js";
import type { ProviderChatRequest } from "./types.js";

const QWEN_LM_STUDIO_LIST_FIXTURE = {
  data: [
    {
      id: "qwen/qwen3.6-27b",
      object: "model",
      type: "vlm",
      publisher: "qwen",
      arch: "qwen35",
      compatibility_type: "gguf",
      quantization: "Q4_K_M",
      state: "loaded",
      max_context_length: 262144,
      loaded_context_length: 32000,
      capabilities: [
        "tool_use",
      ],
    },
  ],
  object: "list",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildRequest(overrides: Partial<ProviderChatRequest> = {}): ProviderChatRequest {
  return {
    prompt: "hi",
    route: {
      providerId: "local",
      modelId: "google/gemma-4-26b-a4b",
      backendKind: "local-openai-compatible",
    },
    runtime: resolveRuntimeConfig(normalizeRuntimeConfig({})),
    workspaceRoot: process.cwd(),
    ...overrides,
  };
}

async function withLocalEnv<T>(
  env: Partial<NodeJS.ProcessEnv>,
  callback: () => T | Promise<T>,
): Promise<T> {
  const original = {
    CODEXA_LOCAL_BASE_URL: process.env.CODEXA_LOCAL_BASE_URL,
    CODEXA_LOCAL_API_KEY: process.env.CODEXA_LOCAL_API_KEY,
    CODEXA_LOCAL_MODEL: process.env.CODEXA_LOCAL_MODEL,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_API_BASE: process.env.OPENAI_API_BASE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  try {
    for (const key of Object.keys(original) as Array<keyof typeof original>) {
      if (key in env) {
        process.env[key] = env[key];
      } else {
        delete process.env[key];
      }
    }
    resetLocalProviderStateForTests();
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetLocalProviderStateForTests();
  }
}

async function withTempWorkspace<T>(callback: (workspaceRoot: string) => T | Promise<T>): Promise<T> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "codexa-local-agent-"));
  try {
    return await callback(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("Local provider is unavailable when endpoint is unreachable", async () => {
  await withLocalEnv({}, async () => {
    const result = await checkLocalProvider({
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });

    assert.equal(result.status, "not-configured");
    assert.equal(result.backendKind, "unavailable");
    assert.match(result.message ?? "", /Could not reach http:\/\/localhost:1234\/v1/);
    assert.equal(result.diagnostics?.baseUrl, "http://localhost:1234/v1");
    assert.equal(result.diagnostics?.endpointCheckResult, "unavailable");
  });
});

test("Local provider is available when /v1/models returns model list", async () => {
  await withLocalEnv({}, async () => {
    const result = await checkLocalProvider({
      fetchImpl: (async (input) => {
        if (String(input).includes("/api/v0/")) {
          return new Response(null, { status: 404 });
        }
        return jsonResponse({ data: [{ id: "google/gemma-4-26b-a4b" }] });
      }) as typeof fetch,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.backendKind, "local-openai-compatible");
    const discovery = discoverLocalModels();
    assert.equal(discovery.models[0]?.modelId, "google/gemma-4-26b-a4b");
    assert.equal(discovery.diagnostics?.selectedModel, "google/gemma-4-26b-a4b");
  });
});

test("Local provider uses configured defaultModel only as fallback when LM Studio native metadata is unavailable", async () => {
  await withLocalEnv({}, async () => {
    const result = await checkLocalProvider({
      override: {
        defaultModel: "second-model",
        baseUrl: "http://local.test/v1/",
      },
      fetchImpl: (async (input) => {
        if (String(input).includes("/api/v0/")) {
          return new Response(null, { status: 404 });
        }
        return jsonResponse({ data: [{ id: "first-model" }, { id: "second-model" }] });
      }) as typeof fetch,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.diagnostics?.baseUrl, "http://local.test/v1");
    assert.equal(result.diagnostics?.selectedModel, "second-model");
  });
});

test("Local provider falls back to first returned model when no default configured", async () => {
  await withLocalEnv({}, async () => {
    const result = await checkLocalProvider({
      fetchImpl: (async (input) => {
        if (String(input).includes("/api/v0/")) {
          return new Response(null, { status: 404 });
        }
        return jsonResponse({ data: [{ id: "first-model" }, { id: "second-model" }] });
      }) as typeof fetch,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.diagnostics?.selectedModel, "first-model");
  });
});

test("LM Studio /api/v0/models loaded model overrides stale Local currentModel and defaultModel", async () => {
  await withLocalEnv({}, async () => {
    const result = await checkLocalProvider({
      override: {
        currentModel: "google/gemma-4-26b-a4b",
        defaultModel: "google/gemma-4-26b-a4b",
        baseUrl: "http://localhost:1234/v1",
      },
      fetchImpl: (async (input) => {
        if (String(input) === "http://localhost:1234/api/v0/models") {
          return jsonResponse(QWEN_LM_STUDIO_LIST_FIXTURE);
        }
        return jsonResponse({ data: [{ id: "qwen/qwen3.6-27b" }, { id: "google/gemma-4-26b-a4b" }] });
      }) as typeof fetch,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.diagnostics?.selectedModel, "qwen/qwen3.6-27b");
    assert.equal(result.diagnostics?.selectionReason, "single-loaded");
    assert.equal(result.diagnostics?.contextSource, "lmstudio-api");
    assert.equal(result.diagnostics?.contextRawField, "loaded_context_length");

    const discovery = discoverLocalModels({
      baseUrl: "http://localhost:1234/v1",
      currentModel: "google/gemma-4-26b-a4b",
      defaultModel: "google/gemma-4-26b-a4b",
    });
    const active = discovery.models.find((model) => model.modelId === "qwen/qwen3.6-27b");
    assert.ok(active, "Qwen model should be discovered");
    assert.equal((active.raw as Record<string, unknown>).loaded_context_length, 32000);
    assert.equal((active.raw as Record<string, unknown>).max_context_length, 262144);
    assert.deepEqual((active.raw as Record<string, unknown>).capabilities, ["tool_use"]);
    assert.equal(discovery.diagnostics?.selectedModel, "qwen/qwen3.6-27b");
  });
});

test("zero loaded LM Studio models produces a clear not-ready Local status", async () => {
  await withLocalEnv({}, async () => {
    const result = await checkLocalProvider({
      override: { baseUrl: "http://localhost:1234/v1" },
      fetchImpl: (async (input) => {
        if (String(input).includes("/api/v0/")) {
          return jsonResponse({
            data: [{ id: "available-model", state: "not-loaded" }],
            object: "list",
          });
        }
        return jsonResponse({ data: [{ id: "available-model" }] });
      }) as typeof fetch,
    });

    assert.equal(result.status, "not-configured");
    assert.equal(result.backendKind, "unavailable");
    assert.equal(result.message, "LM Studio is running, but no model is loaded.");
    assert.equal(result.diagnostics?.endpointCheckResult, "no-models");
    assert.equal(result.diagnostics?.selectedModel, null);
  });
});

test("multiple loaded LM Studio models are handled deterministically", async () => {
  await withLocalEnv({}, async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/v0/")) {
        return jsonResponse({
          data: [
            { id: "first-loaded", state: "loaded", loaded_context_length: 8192 },
            { id: "second-loaded", state: "loaded", loaded_context_length: 16384 },
          ],
          object: "list",
        });
      }
      return jsonResponse({ data: [{ id: "first-loaded" }, { id: "second-loaded" }] });
    }) as typeof fetch;

    const first = await checkLocalProvider({ override: { baseUrl: "http://localhost:1234/v1" }, fetchImpl });
    assert.equal(first.status, "ready");
    assert.equal(first.diagnostics?.selectedModel, "first-loaded");
    assert.equal(first.diagnostics?.selectionReason, "first-loaded");

    const second = await checkLocalProvider({ override: { baseUrl: "http://localhost:1234/v1" }, fetchImpl });
    assert.equal(second.diagnostics?.selectedModel, "first-loaded");
    assert.equal(second.diagnostics?.selectionReason, "previous-loaded");
  });
});

test("pinnedModel wins only when it matches a loaded model", async () => {
  await withLocalEnv({}, async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/v0/")) {
        return jsonResponse({
          data: [
            { id: "first-loaded", state: "loaded" },
            { id: "pinned-loaded", state: "loaded" },
            { id: "pinned-unloaded", state: "not-loaded" },
          ],
          object: "list",
        });
      }
      return jsonResponse({ data: [{ id: "first-loaded" }, { id: "pinned-loaded" }, { id: "pinned-unloaded" }] });
    }) as typeof fetch;

    const loaded = await checkLocalProvider({
      override: { baseUrl: "http://localhost:1234/v1", pinnedModel: "pinned-loaded" },
      fetchImpl,
    });
    assert.equal(loaded.diagnostics?.selectedModel, "pinned-loaded");
    assert.equal(loaded.diagnostics?.selectionReason, "pinned-loaded");

    resetLocalProviderStateForTests();
    const unloaded = await checkLocalProvider({
      override: { baseUrl: "http://localhost:1234/v1", pinnedModel: "pinned-unloaded" },
      fetchImpl,
    });
    assert.equal(unloaded.diagnostics?.selectedModel, "first-loaded");
    assert.equal(unloaded.diagnostics?.selectionReason, "first-loaded");
  });
});

test("Local provider reports no models when endpoint returns an empty list", async () => {
  await withLocalEnv({}, async () => {
    const result = await checkLocalProvider({
      fetchImpl: (async (input) => {
        if (String(input).includes("/api/v0/")) {
          return new Response(null, { status: 404 });
        }
        return jsonResponse({ data: [] });
      }) as typeof fetch,
    });

    assert.equal(result.status, "not-configured");
    assert.match(result.message ?? "", /no models were returned/i);
    assert.equal(result.diagnostics?.endpointCheckResult, "no-models");
  });
});

test("Local provider sends prompt to configured OpenAI-compatible base URL", async () => {
  await withLocalEnv({}, async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const deltas: string[] = [];
    const fetchImpl = (async (input, init) => {
      if (String(input).includes("/api/v0/")) {
        return new Response(null, { status: 404 });
      }
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) as unknown : null,
      });
      if (String(input).endsWith("/models")) {
        return jsonResponse({ data: [{ id: "google/gemma-4-26b-a4b" }] });
      }
      return jsonResponse({ choices: [{ message: { content: "Hello there" } }] });
    }) as typeof fetch;

    await checkLocalProvider({
      override: { baseUrl: "http://lmstudio.test/v1", apiKey: "dummy" },
      fetchImpl,
    });

    const text = await runLocalOpenAiCompatible(
      buildRequest({ localConfig: { baseUrl: "http://lmstudio.test/v1", apiKey: "dummy" } }),
      {
        onResponse: () => undefined,
        onError: assert.fail,
        onAssistantDelta: (chunk) => deltas.push(chunk),
      },
      { fetchImpl },
    );

    assert.equal(text, "Hello there");
    assert.equal(calls[1]?.url, "http://lmstudio.test/v1/chat/completions");
    const body = calls[1]?.body as { model?: string; messages?: Array<{ role: string; content: string }>; stream?: boolean };
    assert.equal(body.model, "google/gemma-4-26b-a4b");
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages?.map((message) => message.role), ["system", "user"]);
    assert.equal(body.messages?.at(-1)?.content, "hi");
    assert.deepEqual(deltas, ["Hello there"]);
  });
});

test("Local provider extracts common OpenAI-compatible response text shapes", async () => {
  const fixtures: Array<{ name: string; body: unknown; expected: string }> = [
    {
      name: "legacy choice text",
      body: { choices: [{ text: "Legacy completion" }] },
      expected: "Legacy completion",
    },
    {
      name: "array content parts",
      body: {
        choices: [{
          message: {
            content: [
              { type: "text", text: "Part one" },
              { type: "output_text", text: " and part two" },
            ],
          },
        }],
      },
      expected: "Part one and part two",
    },
    {
      name: "reasoning and final content split",
      body: {
        choices: [{
          message: {
            reasoning_content: "Internal reasoning",
            content: [{ type: "text", text: "Final answer" }],
          },
        }],
      },
      expected: "Final answer",
    },
    {
      name: "reasoning-only fallback",
      body: { choices: [{ message: { reasoning_content: "Useful reasoning-only response" } }] },
      expected: "Useful reasoning-only response",
    },
  ];

  for (const fixture of fixtures) {
    const text = await runLocalOpenAiCompatible(
      buildRequest({ localConfig: { baseUrl: "http://local.test/v1" } }),
      { onResponse: () => undefined, onError: assert.fail },
      { fetchImpl: (async () => jsonResponse(fixture.body)) as typeof fetch },
    );
    assert.equal(text, fixture.expected, fixture.name);
  }
});

test("Local provider reports safe response-shape diagnostics for a genuinely empty completion", async () => {
  await assert.rejects(
    () => runLocalOpenAiCompatible(
      buildRequest({ localConfig: { baseUrl: "http://local.test/v1" } }),
      { onResponse: () => undefined, onError: assert.fail },
      {
        fetchImpl: (async () => jsonResponse({
          id: "chatcmpl-test",
          choices: [{ message: { content: [] }, finish_reason: "stop" }],
        })) as typeof fetch,
      },
    ),
    (error: Error) => {
      assert.match(error.message, /returned no assistant text/i);
      assert.match(error.message, /Endpoint: http:\/\/local\.test\/v1\/chat\/completions/);
      assert.match(error.message, /choices=1/);
      assert.match(error.message, /finish_reason=stop/);
      assert.match(error.message, /top_level_keys=choices, id/);
      return true;
    },
  );
});

test("Local request payload uses refreshed LM Studio active loaded model", async () => {
  await withLocalEnv({}, async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (input, init) => {
      const url = String(input);
      if (url.includes("/api/v0/")) {
        return jsonResponse(QWEN_LM_STUDIO_LIST_FIXTURE);
      }
      if (url.endsWith("/models")) {
        return jsonResponse({ data: [{ id: "google/gemma-4-26b-a4b" }, { id: "qwen/qwen3.6-27b" }] });
      }
      if (init?.body) {
        payloads.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      }
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    }) as typeof fetch;

    await checkLocalProvider({
      override: {
        baseUrl: "http://localhost:1234/v1",
        currentModel: "google/gemma-4-26b-a4b",
        defaultModel: "google/gemma-4-26b-a4b",
      },
      fetchImpl,
    });
    await runLocalOpenAiCompatible(
      buildRequest({
        route: { providerId: "local", modelId: "google/gemma-4-26b-a4b", backendKind: "local-openai-compatible" },
        localConfig: {
          baseUrl: "http://localhost:1234/v1",
          currentModel: "google/gemma-4-26b-a4b",
          defaultModel: "google/gemma-4-26b-a4b",
        },
      }),
      { onResponse: () => undefined, onError: assert.fail },
      { fetchImpl },
    );

    assert.equal(payloads.at(-1)?.model, "qwen/qwen3.6-27b");
    assert.notEqual(payloads.at(-1)?.model, "google/gemma-4-26b-a4b");
  });
});

test("Local provider uses non-streaming agent chat completion", async () => {
  await withLocalEnv({}, async () => {
    const streamValues: boolean[] = [];
    const fetchImpl = (async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { stream?: boolean } : {};
      streamValues.push(Boolean(body.stream));
      return jsonResponse({ choices: [{ message: { content: "Fallback response" } }] });
    }) as typeof fetch;

    const text = await runLocalOpenAiCompatible(
      buildRequest({ localConfig: { baseUrl: "http://lmstudio.test/v1" } }),
      {
        onResponse: () => undefined,
        onError: assert.fail,
      },
      { fetchImpl },
    );

    assert.equal(text, "Fallback response");
    assert.deepEqual(streamValues, [false]);
  });
});

test("Local provider executes unterminated text tool calls before final answer", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const assistantDeltas: string[] = [];
    const bodies: Array<{ messages?: Array<{ role: string; content: string }> }> = [];
    let chatCount = 0;
    const fetchImpl = (async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { messages?: Array<{ role: string; content: string }> } : {};
      bodies.push(body);
      chatCount += 1;
      if (chatCount === 1) {
        return jsonResponse({ choices: [{ message: { content: '<tool_call>{"name":"list_files","arguments":{"path":"."}}' } }] });
      }
      return jsonResponse({ choices: [{ message: { content: "Listed the workspace." } }] });
    }) as typeof fetch;

    const text = await runLocalOpenAiCompatible(
      buildRequest({
        workspaceRoot,
        runtime: resolveRuntimeConfig(normalizeRuntimeConfig({ policy: { sandboxMode: "danger-full-access" } })),
        localConfig: { baseUrl: "http://local.test/v1" },
      }),
      {
        onResponse: () => undefined,
        onError: assert.fail,
        onAssistantDelta: (chunk) => assistantDeltas.push(chunk),
      },
      { fetchImpl },
    );

    assert.equal(text, "Listed the workspace.");
    assert.deepEqual(assistantDeltas, ["Listed the workspace."]);
    assert.match(bodies[1]?.messages?.at(-1)?.content ?? "", /<tool_result name="list_files">/);
    assert.match(bodies[1]?.messages?.at(-1)?.content ?? "", /list_files/);
  });
});

test("Local provider executes OpenAI-style tool_calls before final answer", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const assistantDeltas: string[] = [];
    const bodies: Array<{ messages?: Array<{ role: string; content: string }> }> = [];
    let chatCount = 0;
    const fetchImpl = (async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { messages?: Array<{ role: string; content: string }> } : {};
      bodies.push(body);
      chatCount += 1;
      if (chatCount === 1) {
        return jsonResponse({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: {
                  name: "write_file",
                  arguments: "{\"path\":\"main.rs\",\"content\":\"fn main() { println!(\\\"hi\\\"); }\\n\"}",
                },
              }],
            },
          }],
        });
      }
      return jsonResponse({ choices: [{ message: { content: "Created main.rs." } }] });
    }) as typeof fetch;

    const text = await runLocalOpenAiCompatible(
      buildRequest({
        workspaceRoot,
        runtime: resolveRuntimeConfig(normalizeRuntimeConfig({ policy: { sandboxMode: "danger-full-access" } })),
        localConfig: { baseUrl: "http://local.test/v1" },
      }),
      {
        onResponse: () => undefined,
        onError: assert.fail,
        onAssistantDelta: (chunk) => assistantDeltas.push(chunk),
      },
      { fetchImpl },
    );

    assert.equal(text, "Created main.rs.");
    assert.equal(await readFile(path.join(workspaceRoot, "main.rs"), "utf8"), "fn main() { println!(\"hi\"); }\n");
    assert.deepEqual(assistantDeltas, ["Created main.rs."]);
    assert.match(bodies[1]?.messages?.at(-1)?.content ?? "", /<tool_result name="write_file">/);
    assert.match(bodies[1]?.messages?.at(-1)?.content ?? "", /main\.rs/);
  });
});

test("Local provider run path does not use CLI startup labels", async () => {
  const progress: string[] = [];
  const fetchImpl = (async () => jsonResponse({ choices: [{ message: { content: "Local response" } }] })) as typeof fetch;
  const text = await runLocalOpenAiCompatible(
    buildRequest({ localConfig: { baseUrl: "http://local.test/v1" } }),
    {
      onResponse: () => undefined,
      onError: assert.fail,
      onProgress: (update) => progress.push(update.text),
    },
    { fetchImpl },
  );

  assert.equal(text, "Local response");
  assert.equal(progress.some((line) => /Gemini|Claude|Codex CLI/i.test(line)), false);
});

test("Local diagnostics show base URL, selected model, and discovered models", async () => {
  await withLocalEnv({}, async () => {
    const diagnostics = await runLocalDiagnostics({
      localConfig: { baseUrl: "http://diag.test/v1", defaultModel: "model-b" },
      fetchImpl: (async (input) => {
        if (String(input).includes("/api/v0/")) {
          return new Response(null, { status: 404 });
        }
        return jsonResponse({ data: [{ id: "model-a" }, { id: "model-b" }] });
      }) as typeof fetch,
    });

    assert.match(diagnostics, /Local: available/);
    assert.match(diagnostics, /Base URL: http:\/\/diag\.test\/v1/);
    assert.match(diagnostics, /Models: model-a, model-b/);
    assert.match(diagnostics, /Selected: model-b/);
  });
});

test("Local config uses CODEXA env first and common OpenAI-compatible env second", async () => {
  await withLocalEnv({
    OPENAI_BASE_URL: "http://openai-compatible.test/v1",
    OPENAI_API_KEY: "openai-env-key",
    CODEXA_LOCAL_BASE_URL: "http://codexa-local.test/v1",
    CODEXA_LOCAL_API_KEY: "local-env-key",
    CODEXA_LOCAL_MODEL: "local-env-model",
  }, async () => {
    const config = resolveLocalProviderConfig(null);
    assert.equal(config.baseUrl, "http://codexa-local.test/v1");
    assert.equal(config.apiKey, "local-env-key");
    assert.equal(config.defaultModel, "local-env-model");
  });
});

test("Local provider omits system prompt when supports_system_prompt: false in API metadata", async () => {
  await withLocalEnv({}, async () => {
    const calls: Array<{ body: unknown }> = [];
    const fetchImpl = (async (input, init) => {
      if (String(input).includes("/api/v0/")) {
        return new Response(null, { status: 404 });
      }
      if (String(input).endsWith("/models")) {
        return jsonResponse({ data: [{ id: "no-sys-model", supports_system_prompt: false }] });
      }
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) as unknown : null });
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    }) as typeof fetch;

    await checkLocalProvider({ fetchImpl });
    await runLocalOpenAiCompatible(
      buildRequest({
        route: { providerId: "local", modelId: "no-sys-model", backendKind: "local-openai-compatible" },
        projectInstructions: { content: "You are a helpful assistant.", path: "AGENTS.md" },
      }),
      { onResponse: () => undefined, onError: assert.fail },
      { fetchImpl },
    );

    const body = calls[0]?.body as { messages?: Array<{ role: string }> };
    const roles = body?.messages?.map((m) => m.role) ?? [];
    assert.deepEqual(roles, ["user"], "system message must be excluded when supportsSystemPrompt is false");
  });
});

test("Local provider includes system prompt when supportsSystemPrompt is unknown (absent from API metadata)", async () => {
  await withLocalEnv({}, async () => {
    const calls: Array<{ body: unknown }> = [];
    const fetchImpl = (async (input, init) => {
      if (String(input).includes("/api/v0/")) {
        return new Response(null, { status: 404 });
      }
      if (String(input).endsWith("/models")) {
        return jsonResponse({ data: [{ id: "unknown-caps-model" }] });
      }
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) as unknown : null });
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    }) as typeof fetch;

    await checkLocalProvider({ fetchImpl });
    await runLocalOpenAiCompatible(
      buildRequest({
        route: { providerId: "local", modelId: "unknown-caps-model", backendKind: "local-openai-compatible" },
        projectInstructions: { content: "You are a helpful assistant.", path: "AGENTS.md" },
      }),
      { onResponse: () => undefined, onError: assert.fail },
      { fetchImpl },
    );

    const body = calls[0]?.body as { messages?: Array<{ role: string }> };
    const roles = body?.messages?.map((m) => m.role) ?? [];
    assert.deepEqual(roles, ["system", "user"], "system message must be included when supportsSystemPrompt is unknown");
  });
});

test("Local provider keeps agent chat completion non-streaming when supports_streaming is false", async () => {
  await withLocalEnv({}, async () => {
    const streamValues: boolean[] = [];
    const fetchImpl = (async (input, init) => {
      if (String(input).includes("/api/v0/")) {
        return new Response(null, { status: 404 });
      }
      if (String(input).endsWith("/models")) {
        return jsonResponse({ data: [{ id: "no-stream-model", supports_streaming: false }] });
      }
      const body = init?.body ? JSON.parse(String(init.body)) as { stream?: boolean } : {};
      streamValues.push(Boolean(body.stream));
      return jsonResponse({ choices: [{ message: { content: "Non-streaming response" } }] });
    }) as typeof fetch;

    await checkLocalProvider({ fetchImpl });
    const text = await runLocalOpenAiCompatible(
      buildRequest({
        route: { providerId: "local", modelId: "no-stream-model", backendKind: "local-openai-compatible" },
      }),
      { onResponse: () => undefined, onError: assert.fail },
      { fetchImpl },
    );

    assert.equal(text, "Non-streaming response");
    assert.equal(streamValues.length, 1, "exactly one request should be made when streaming is unsupported");
    assert.equal(streamValues[0], false, "streaming must not be requested");
  });
});

test("Local config override supportsSystemPrompt: false omits system prompt without API metadata", async () => {
  await withLocalEnv({}, async () => {
    const calls: Array<{ body: unknown }> = [];
    const fetchImpl = (async (_input, init) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) as unknown : null });
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    }) as typeof fetch;

    await runLocalOpenAiCompatible(
      buildRequest({
        route: { providerId: "local", modelId: "config-gate-model", backendKind: "local-openai-compatible" },
        localConfig: {
          baseUrl: "http://localhost:1234/v1",
          models: {
            "config-gate-model": {
              supportsSystemPrompt: false,
            },
          },
        },
        projectInstructions: { content: "You are a helpful assistant.", path: "AGENTS.md" },
      }),
      { onResponse: () => undefined, onError: assert.fail },
      { fetchImpl },
    );

    const body = calls[0]?.body as { messages?: Array<{ role: string }> };
    const roles = body?.messages?.map((m) => m.role) ?? [];
    assert.deepEqual(roles, ["user"], "system message must be excluded when config overrides supportsSystemPrompt: false");
  });
});

test("resetLocalProviderStateForTests clears capability profile cache for test isolation", async () => {
  await withLocalEnv({}, async () => {
    // Seed the capability cache via discovery
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/v0/")) {
        return new Response(null, { status: 404 });
      }
      if (String(input).endsWith("/models")) {
        return jsonResponse({ data: [{ id: "isolation-model", supports_streaming: false }] });
      }
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    }) as typeof fetch;
    await checkLocalProvider({ fetchImpl });

    // Verify the cache has the capability
    const calls: boolean[] = [];
    const trackFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/v0/")) {
        return new Response(null, { status: 404 });
      }
      if (!String(input).endsWith("/models")) {
        const body = init?.body ? JSON.parse(String(init.body)) as { stream?: boolean } : {};
        calls.push(Boolean(body.stream));
        return jsonResponse({ choices: [{ message: { content: "ok" } }] });
      }
      return jsonResponse({ data: [{ id: "isolation-model", supports_streaming: false }] });
    }) as typeof fetch;

    await runLocalOpenAiCompatible(
      buildRequest({ route: { providerId: "local", modelId: "isolation-model", backendKind: "local-openai-compatible" } }),
      { onResponse: () => undefined, onError: assert.fail },
      { fetchImpl: trackFetch },
    );
    assert.equal(calls[0], false, "streaming should be disabled from cache");
  });

  // After withLocalEnv resets state, the capability cache should be cleared.
  // A fresh env with the same model should now have unknown capabilities.
  await withLocalEnv({}, async () => {
    const calls: boolean[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/v0/")) {
        return new Response(null, { status: 404 });
      }
      if (String(input).endsWith("/models")) {
        // Return model WITHOUT supports_streaming field (unknown)
        return jsonResponse({ data: [{ id: "isolation-model" }] });
      }
      const body = init?.body ? JSON.parse(String(init.body)) as { stream?: boolean } : {};
      calls.push(Boolean(body.stream));
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    }) as typeof fetch;

    await checkLocalProvider({ fetchImpl });
    await runLocalOpenAiCompatible(
      buildRequest({ route: { providerId: "local", modelId: "isolation-model", backendKind: "local-openai-compatible" } }),
      { onResponse: () => undefined, onError: assert.fail },
      { fetchImpl },
    );
    assert.equal(calls[0], false, "agent loop uses non-streaming completions so tool calls stay hidden");
  });
});

test("checkLocalProvider enriches selected model raw with LM Studio native API metadata", async () => {
  await withLocalEnv({}, async () => {
    const lmStudioFixture = {
      data: [{
        id: "google/gemma-4-26b-a4b",
        object: "model",
        type: "vlm",
        publisher: "google",
        arch: "gemma4",
        compatibility_type: "gguf",
        quantization: "Q4_K_M",
        state: "loaded",
        max_context_length: 262144,
        loaded_context_length: 64000,
        capabilities: ["tool_use"],
      }],
      object: "list",
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/v0/")) {
        return jsonResponse(lmStudioFixture);
      }
      if (String(input).endsWith("/models")) {
        return jsonResponse({ data: [{ id: "google/gemma-4-26b-a4b", context_length: 8192 }] });
      }
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    }) as typeof fetch;

    await checkLocalProvider({
      override: { baseUrl: "http://localhost:1234/v1", apiKey: "lm-studio" },
      fetchImpl,
    });

    const discovered = discoverLocalModels({ baseUrl: "http://localhost:1234/v1", apiKey: "lm-studio" });
    const model = discovered.models.find((m) => m.modelId === "google/gemma-4-26b-a4b");
    assert.ok(model, "model should be in discovered list");
    const raw = model?.raw as Record<string, unknown>;
    assert.equal(raw?.loaded_context_length, 64000, "loaded_context_length should be merged from LM Studio native API");
    assert.deepEqual(raw?.capabilities, ["tool_use"], "capabilities array should be present");
    assert.equal(raw?.arch, "gemma4", "arch should be present");
  });
});

test("checkLocalProvider LM Studio API failure leaves raw metadata from /v1/models intact", async () => {
  await withLocalEnv({}, async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/v0/")) {
        throw new Error("ECONNREFUSED");
      }
      if (String(input).endsWith("/models")) {
        return jsonResponse({ data: [{ id: "fallback-model", context_length: 4096 }] });
      }
      throw new Error("unexpected request");
    }) as typeof fetch;

    const result = await checkLocalProvider({
      override: { baseUrl: "http://localhost:1234/v1" },
      fetchImpl,
    });

    assert.equal(result.status, "ready");
    const discovered = discoverLocalModels({ baseUrl: "http://localhost:1234/v1" });
    const model = discovered.models.find((m) => m.modelId === "fallback-model");
    assert.ok(model, "model should still be discoverable after LM Studio API failure");
    const raw = model?.raw as Record<string, unknown>;
    assert.equal(raw?.context_length, 4096, "original /v1/models raw data preserved on LM Studio API failure");
  });
});

test("runLocalDiagnostics shows LM Studio metadata fields when available", async () => {
  await withLocalEnv({}, async () => {
    const lmStudioFixture = {
      data: [{
        id: "google/gemma-4-26b-a4b",
        type: "vlm",
        arch: "gemma4",
        quantization: "Q4_K_M",
        state: "loaded",
        max_context_length: 262144,
        loaded_context_length: 64000,
        capabilities: ["tool_use"],
      }],
      object: "list",
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/v0/")) {
        return jsonResponse(lmStudioFixture);
      }
      if (String(input).endsWith("/models")) {
        return jsonResponse({ data: [{ id: "google/gemma-4-26b-a4b" }] });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const diagnostics = await runLocalDiagnostics({
      localConfig: { baseUrl: "http://localhost:1234/v1" },
      fetchImpl,
    });

    assert.match(diagnostics, /State: loaded/);
    assert.match(diagnostics, /Type: vlm/);
    assert.match(diagnostics, /Architecture: gemma4/);
    assert.match(diagnostics, /Quantization: Q4_K_M/);
    assert.match(diagnostics, /Loaded context: 64,000/);
    assert.match(diagnostics, /Max context: 262,144/);
    assert.match(diagnostics, /Capabilities: tool_use/);
    assert.match(diagnostics, /Active context limit: 64,000/);
    assert.match(diagnostics, /Source: lmstudio-api/);
    assert.match(diagnostics, /Field: loaded_context_length/);
  });
});
