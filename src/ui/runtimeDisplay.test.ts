import assert from "node:assert/strict";
import test from "node:test";
import type { CodexModelCapability } from "../core/models/codexModelCapabilities.js";
import type { ModelContextMetadata } from "../core/providerRuntime/contextMetadata.js";
import type { ActiveProviderRoute } from "../core/providerRuntime/types.js";
import { buildActiveRuntimeDisplay } from "./runtimeDisplay.js";

function capability(model: string, label = model): CodexModelCapability {
  return {
    id: model,
    model,
    label,
    description: null,
    available: true,
    hidden: false,
    isDefault: true,
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
    reasoningLevelCount: null,
    source: "runtime",
    raw: null,
  };
}

function context(route: ActiveProviderRoute, contextLength: number | null, confidence: ModelContextMetadata["confidence"] = "known"): ModelContextMetadata {
  return {
    providerId: route.providerId,
    modelId: route.modelId,
    contextLength,
    source: contextLength === null ? "unknown" : "known-registry",
    confidence: contextLength === null ? "unknown" : confidence,
  };
}

test("Claude route display uses Claude model and context, not stale Gemini", () => {
  const route: ActiveProviderRoute = {
    providerId: "anthropic",
    modelId: "sonnet",
    backendKind: "claude-code-auth",
    reasoning: "low",
  };
  const display = buildActiveRuntimeDisplay({
    route,
    reasoningLevel: "medium",
    mode: "full-auto",
    tokensUsed: 0,
    modelCapability: capability("sonnet", "Sonnet 4.6"),
    contextMetadata: context(route, 200_000),
  });

  assert.equal(display.providerLabel, "Claude Code CLI");
  assert.equal(display.modelDisplay, "Claude Code CLI / Sonnet 4.6 / reasoning: Low");
  assert.equal(display.footerModelDisplay, "Claude Code CLI / Sonnet 4.6 (Low)");
  assert.equal(display.contextDisplay, "0 / 200K");
  assert.doesNotMatch(display.modelDisplay, /Gemini|OpenAI/i);
});

test("Gemini route display uses Gemini model and estimated context", () => {
  const route: ActiveProviderRoute = {
    providerId: "google",
    modelId: "gemini-3-flash-preview",
    backendKind: "gemini-cli-auth",
    reasoning: "medium",
  };
  const display = buildActiveRuntimeDisplay({
    route,
    reasoningLevel: "low",
    mode: "full-auto",
    tokensUsed: 12_400,
    contextMetadata: context(route, 1_048_576, "estimated"),
  });

  assert.equal(display.modelDisplay, "Gemini CLI / gemini-3-flash-preview / reasoning: Medium");
  assert.equal(display.footerModelDisplay, "Gemini CLI / gemini-3-flash-preview (Medium)");
  assert.equal(display.contextDisplay, "12.4K / ~1M");
  assert.doesNotMatch(display.modelDisplay, /Claude|OpenAI/i);
});

test("OpenAI route display uses OpenAI model and unknown context without stale Claude", () => {
  const route: ActiveProviderRoute = {
    providerId: "openai",
    modelId: "gpt-5.4-mini",
    backendKind: "codex-cli-auth",
    reasoning: "medium",
  };
  const staleClaude = context({
    providerId: "anthropic",
    modelId: "sonnet",
    backendKind: "claude-code-auth",
  }, 200_000);
  const display = buildActiveRuntimeDisplay({
    route,
    reasoningLevel: "medium",
    mode: "full-auto",
    tokensUsed: 0,
    contextMetadata: staleClaude,
  });

  assert.equal(display.modelDisplay, "OpenAI Codex CLI / gpt-5.4-mini / reasoning: Medium");
  assert.equal(display.footerModelDisplay, "OpenAI Codex CLI / gpt-5.4-mini (Medium)");
  assert.equal(display.contextDisplay, "Unknown");
  assert.equal(display.modelSpec.status, "unknown");
  assert.doesNotMatch(display.modelDisplay, /Claude|Gemini/i);
});

test("Header and footer display values share the same context string", () => {
  const route: ActiveProviderRoute = {
    providerId: "google",
    modelId: "gemini-2.5-flash",
    backendKind: "gemini-cli-auth",
    reasoning: "medium",
  };
  const display = buildActiveRuntimeDisplay({
    route,
    reasoningLevel: "medium",
    mode: "full-auto",
    tokensUsed: 0,
    contextMetadata: context(route, 1_048_576, "known"),
  });

  assert.equal(display.contextDisplay, "0 / 1M");
  assert.ok(display.modelDisplay.includes("Gemini CLI / gemini-2.5-flash"));
  assert.ok(display.footerModelDisplay.includes("Gemini CLI / gemini-2.5-flash"));
});
