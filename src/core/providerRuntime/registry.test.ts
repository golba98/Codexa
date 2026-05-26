import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverProviderModels,
  getProviderRouteSetupMessage,
  getProviderRuntime,
  isProviderRouteConfigured,
  resolveActiveProviderRoute,
} from "./registry.js";
import { resetGeminiRouteValidationCacheForTests } from "./gemini.js";
import { resetAnthropicRouteValidationCacheForTests } from "./anthropic.js";
import { checkLocalProvider, resetLocalProviderStateForTests } from "./local.js";

test("google runtime exposes configured Gemini models for in-Codexa routing", () => {
  const runtime = getProviderRuntime("google");
  const discovery = discoverProviderModels("google");

  assert.equal(runtime.routeAvailable, true);
  assert.equal(runtime.backendKind, "gemini-cli-auth");
  assert.equal(discovery.status, "ready");
  assert.ok(discovery.models.length > 0);
});

test("anthropic runtime exposes configured Claude models for in-Codexa routing", () => {
  const runtime = getProviderRuntime("anthropic");
  const discovery = discoverProviderModels("anthropic");

  assert.equal(runtime.routeAvailable, true);
  assert.equal(runtime.backendKind, "claude-code-auth");
  assert.equal(discovery.status, "ready");
  assert.ok(discovery.models.length > 0);
});

test("active route resolution preserves routable google routes", () => {
  const route = resolveActiveProviderRoute({
    workspaceConfigActiveRoute: {
      providerId: "google",
      modelId: "gemini-2.5-pro",
      backendKind: "gemini-cli-auth",
      reasoning: "medium",
    },
    currentModel: "gpt-5.4",
    currentReasoning: "high",
  });

  assert.deepEqual(route, {
    providerId: "google",
    modelId: "gemini-2.5-pro",
    backendKind: "gemini-cli-auth",
    reasoning: "medium",
  });
});

test("active route resolution normalizes legacy Gemini 3 Flash routes to preview", () => {
  const route = resolveActiveProviderRoute({
    workspaceConfigActiveRoute: {
      providerId: "google",
      modelId: "gemini-3-flash",
      backendKind: "gemini-cli-auth",
      reasoning: "high",
    },
    currentModel: "gpt-5.4",
    currentReasoning: "medium",
  });

  assert.deepEqual(route, {
    providerId: "google",
    modelId: "gemini-3-flash-preview",
    backendKind: "gemini-cli-auth",
    reasoning: "high",
  });
});

test("active route resolution preserves routable anthropic routes", () => {
  const route = resolveActiveProviderRoute({
    workspaceConfigActiveRoute: {
      providerId: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      backendKind: "anthropic-api-key",
      reasoning: "high",
    },
    currentModel: "gpt-5.4",
    currentReasoning: "medium",
  });

  assert.deepEqual(route, {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-20250514",
    backendKind: "anthropic-api-key",
    reasoning: "high",
  });
});

test("active route resolution preserves routable local routes", async () => {
  resetLocalProviderStateForTests();
  await checkLocalProvider({
    fetchImpl: (async () => new Response(JSON.stringify({
      data: [{ id: "llama-local" }],
    }), { status: 200 })) as typeof fetch,
  });
  const route = resolveActiveProviderRoute({
    workspaceConfigActiveRoute: {
      providerId: "local",
      modelId: "llama-local",
      backendKind: "local-openai-compatible",
    },
    currentModel: "gpt-5.4",
    currentReasoning: "high",
  });

  assert.deepEqual(route, {
    providerId: "local",
    modelId: "llama-local",
    backendKind: "local-openai-compatible",
  });
  resetLocalProviderStateForTests();
});

// ─── CLI --model override precedence ─────────────────────────────────────────
// These tests mirror the app-level logic: when --model is given on the CLI,
// the caller constructs effectiveRoute = { ...savedRoute, modelId: cliModel }
// before passing it to resolveActiveProviderRoute. The tests verify the resolver
// honours that override correctly.

test("CLI model override wins over persisted OpenAI activeRoute model", () => {
  // Simulate: providers.json has gpt-5.4-mini, but user ran --model gpt-5.5
  const cliModel = "gpt-5.5";
  const savedRoute = {
    providerId: "openai" as const,
    modelId: "gpt-5.4-mini",
    backendKind: "codex-cli-auth" as const,
    reasoning: "low",
  };
  const effectiveRoute = { ...savedRoute, modelId: cliModel };

  const route = resolveActiveProviderRoute({
    workspaceConfigActiveRoute: effectiveRoute,
    currentModel: "gpt-5.5",
    currentReasoning: "low",
  });

  assert.equal(route.modelId, "gpt-5.5", "CLI model must be used for the run, not providers.json model");
  assert.equal(route.providerId, "openai");
});

test("without CLI model override the persisted providers.json activeRoute model is used", () => {
  const savedRoute = {
    providerId: "openai" as const,
    modelId: "gpt-5.4-mini",
    backendKind: "codex-cli-auth" as const,
    reasoning: "low",
  };

  const route = resolveActiveProviderRoute({
    workspaceConfigActiveRoute: savedRoute,
    currentModel: "gpt-5.4",
    currentReasoning: "high",
  });

  assert.equal(route.modelId, "gpt-5.4-mini", "Without CLI override, persisted model must win over layered-config default");
});

test("CLI model override preserves provider from providers.json activeRoute", () => {
  // --model on the CLI should not change the provider, only the modelId
  const cliModel = "gpt-5.5";
  const savedRoute = {
    providerId: "openai" as const,
    modelId: "gpt-5.4-mini",
    backendKind: "codex-cli-auth" as const,
    reasoning: "low",
  };
  const effectiveRoute = { ...savedRoute, modelId: cliModel };

  const route = resolveActiveProviderRoute({
    workspaceConfigActiveRoute: effectiveRoute,
    currentModel: cliModel,
    currentReasoning: "low",
  });

  assert.equal(route.providerId, "openai", "Provider from providers.json must be preserved");
  assert.equal(route.modelId, cliModel);
  assert.equal(route.reasoning, "low", "Reasoning from providers.json must be preserved");
});

// ─── Authentication and setup gates ──────────────────────────────────────────

test("anthropic route configuration is gated by ANTHROPIC_API_KEY or Claude Code", () => {
  const original = process.env.ANTHROPIC_API_KEY;

  try {
    delete process.env.ANTHROPIC_API_KEY;
    resetAnthropicRouteValidationCacheForTests();
    assert.equal(isProviderRouteConfigured("anthropic"), false);
    assert.match(getProviderRouteSetupMessage("anthropic"), /set ANTHROPIC_API_KEY/);
  } finally {
    if (original) process.env.ANTHROPIC_API_KEY = original;
  }
});

test("google route configuration is gated by Gemini API key or validated headless CLI", () => {
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalGoogle = process.env.GOOGLE_API_KEY;

  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    resetGeminiRouteValidationCacheForTests();
    assert.equal(isProviderRouteConfigured("google"), false);
    assert.match(getProviderRouteSetupMessage("google"), /GEMINI_API_KEY \/ GOOGLE_API_KEY/);
  } finally {
    if (originalGemini) process.env.GEMINI_API_KEY = originalGemini;
    if (originalGoogle) process.env.GOOGLE_API_KEY = originalGoogle;
  }
});

test("local route configuration is gated by endpoint model discovery", async () => {
  resetLocalProviderStateForTests();
  assert.equal(isProviderRouteConfigured("local"), false);

  await checkLocalProvider({
    fetchImpl: (async (input) => {
      if (String(input).includes("/api/v0/")) {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify({
        data: [{ id: "google/gemma-4-26b-a4b" }],
      }), { status: 200 });
    }) as typeof fetch,
  });

  assert.equal(isProviderRouteConfigured("local"), true);
  resetLocalProviderStateForTests();
});
