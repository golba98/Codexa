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
      modelId: "gemini-3-flash",
      backendKind: "gemini-cli-auth",
      reasoning: "medium",
    },
    currentModel: "gpt-5.4",
    currentReasoning: "high",
  });

  assert.deepEqual(route, {
    providerId: "google",
    modelId: "gemini-3-flash",
    backendKind: "gemini-cli-auth",
    reasoning: "medium",
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

test("active route resolution falls back to OpenAI when provider is launch-only", () => {
  const route = resolveActiveProviderRoute({
    workspaceConfigActiveRoute: {
      providerId: "local",
      modelId: "llama-local",
      backendKind: "unavailable",
    },
    currentModel: "gpt-5.4",
    currentReasoning: "high",
  });

  assert.deepEqual(route, {
    providerId: "openai",
    modelId: "gpt-5.4",
    backendKind: "codex-cli-auth",
    reasoning: "high",
  });
});

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
