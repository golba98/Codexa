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

test("google runtime exposes configured Gemini models for in-Codexa routing", () => {
  const runtime = getProviderRuntime("google");
  const discovery = discoverProviderModels("google");

  assert.equal(runtime.routeAvailable, true);
  assert.equal(runtime.backendKind, "gemini-cli-headless");
  assert.equal(discovery.status, "ready");
  assert.deepEqual(discovery.models.map((model) => model.modelId), ["gemini-3.1-pro", "gemini-3-flash"]);
});

test("anthropic runtime exposes configured Claude models for in-Codexa routing", () => {
  const runtime = getProviderRuntime("anthropic");
  const discovery = discoverProviderModels("anthropic");

  assert.equal(runtime.routeAvailable, true);
  assert.equal(runtime.backendKind, "anthropic-api");
  assert.equal(discovery.status, "ready");
  assert.deepEqual(discovery.models.map((model) => model.modelId), [
    "claude-sonnet-4-20250514",
    "claude-opus-4-1-20250805",
    "claude-3-5-haiku-20241022",
  ]);
});

test("active route resolution preserves routable google routes", () => {
  const route = resolveActiveProviderRoute({
    workspaceConfigActiveRoute: {
      providerId: "google",
      modelId: "gemini-3-flash",
      backendKind: "gemini-cli-headless",
      reasoning: "medium",
    },
    currentModel: "gpt-5.4",
    currentReasoning: "high",
  });

  assert.deepEqual(route, {
    providerId: "google",
    modelId: "gemini-3-flash",
    backendKind: "gemini-cli-headless",
    reasoning: "medium",
  });
});

test("active route resolution preserves routable anthropic routes", () => {
  const route = resolveActiveProviderRoute({
    workspaceConfigActiveRoute: {
      providerId: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      backendKind: "anthropic-api",
      reasoning: "high",
    },
    currentModel: "gpt-5.4",
    currentReasoning: "medium",
  });

  assert.deepEqual(route, {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-20250514",
    backendKind: "anthropic-api",
    reasoning: "high",
  });
});

test("active route resolution falls back to OpenAI when provider is launch-only", () => {
  const route = resolveActiveProviderRoute({
    workspaceConfigActiveRoute: {
      providerId: "local",
      modelId: "llama-local",
      backendKind: "not-configured",
    },
    currentModel: "gpt-5.4",
    currentReasoning: "high",
  });

  assert.deepEqual(route, {
    providerId: "openai",
    modelId: "gpt-5.4",
    backendKind: "codex-cli",
    reasoning: "high",
  });
});

test("anthropic route configuration is gated by ANTHROPIC_API_KEY", () => {
  const original = process.env.ANTHROPIC_API_KEY;

  try {
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(isProviderRouteConfigured("anthropic"), false);
    assert.match(getProviderRouteSetupMessage("anthropic"), /Set ANTHROPIC_API_KEY/);

    process.env.ANTHROPIC_API_KEY = "test-key";
    assert.equal(isProviderRouteConfigured("anthropic"), true);
  } finally {
    if (original === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = original;
    }
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

    process.env.GOOGLE_API_KEY = "test-key";
    assert.equal(isProviderRouteConfigured("google"), true);
  } finally {
    if (originalGemini === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGemini;
    }
    if (originalGoogle === undefined) {
      delete process.env.GOOGLE_API_KEY;
    } else {
      process.env.GOOGLE_API_KEY = originalGoogle;
    }
    resetGeminiRouteValidationCacheForTests();
  }
});
