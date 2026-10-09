import assert from "node:assert/strict";

import test, { afterEach } from "node:test";
import { buildAnthropicApiUsageSnapshot } from "./anthropicApiUsage.js";
import { buildLocalUsageSnapshot } from "./localUsage.js";
import { recordLocalContextUsage, resetLocalUsageRecords } from "./localUsageTracker.js";
import { mistralVibeUsageAdapter } from "./mistralVibeUsage.js";
import {
  getObservedRateLimits,
  parseAnthropicRateLimitHeaders,
  recordObservedRateLimits,
  resetObservedRateLimitsForTests,
} from "./observedRateLimits.js";
import type { LocalUsageFacts, UsageRequestContext } from "./types.js";

const NOW = Date.parse("2026-10-09T12:00:00Z");

function ctx(overrides: Partial<UsageRequestContext> = {}): UsageRequestContext {
  return {
    route: { providerId: "anthropic", modelId: "m", backendKind: "anthropic-api-key" },
    workspaceRoot: "/tmp",
    scopeKey: "scope",
    signal: new AbortController().signal,
    now: () => NOW,
    ...overrides,
  };
}

afterEach(() => {
  resetObservedRateLimitsForTests();
  resetLocalUsageRecords();
});

test("Anthropic rate-limit headers parse only well-formed counts", () => {
  const headers = new Headers({
    "anthropic-ratelimit-requests-limit": "50",
    "anthropic-ratelimit-requests-remaining": "49",
    "anthropic-ratelimit-requests-reset": "2026-10-09T12:01:00Z",
    "anthropic-ratelimit-tokens-limit": "abc",
    "anthropic-ratelimit-tokens-remaining": "",
    "x-api-key": "sk-ant-never-read",
  });
  const parsed = parseAnthropicRateLimitHeaders(headers, NOW);
  assert.deepEqual(parsed, {
    observedAt: NOW,
    windows: { requests: { limit: 50, remaining: 49, reset: "2026-10-09T12:01:00Z" } },
  });
  assert.equal(parseAnthropicRateLimitHeaders(new Headers(), NOW), null);
});

test("API-key usage without an observation explains that keys cannot query usage", () => {
  const snapshot = buildAnthropicApiUsageSnapshot(ctx());
  assert.equal(snapshot.status, "unsupported");
  assert.equal(snapshot.billingMode, "api");
  assert.equal(snapshot.freshness, "observed");
  assert.equal(snapshot.limits.length, 0);
});

test("observed API rate limits are reported as observed, with verified denominators", () => {
  recordObservedRateLimits("scope", {
    observedAt: NOW - 60_000,
    windows: {
      requests: { limit: 50, remaining: 0, reset: "2026-10-09T12:00:30Z" },
      "output-tokens": { limit: undefined, remaining: 900 },
    },
  });
  const snapshot = buildAnthropicApiUsageSnapshot(ctx());
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.retrievedAt, NOW - 60_000);
  assert.match(snapshot.message ?? "", /not a live query/);
  const [requests, output] = snapshot.limits;
  assert.equal(requests?.usedPercent, 100);
  assert.equal(requests?.state, "exhausted");
  assert.equal(requests?.used, 50);
  // No limit header means no denominator, so no percentage.
  assert.equal(output?.remaining, 900);
  assert.equal(output?.usedPercent, undefined);
  assert.equal(getObservedRateLimits("other-scope"), undefined);
});

function localCtx(facts: Partial<LocalUsageFacts>, scopeKey = "local|lm") {
  return ctx({
    route: {
      providerId: "local",
      modelId: "qwen",
      backendKind: "local-openai-compatible",
      localBackend: "lm-studio",
    },
    scopeKey,
    localFacts: {
      modelId: "qwen",
      localBackend: "lm-studio",
      isLocalInference: true,
      contextWindow: 32768,
      contextConfidence: "verified",
      ...facts,
    },
  });
}

test("local inference marks account quota N/A and shows verified context usage", () => {
  recordLocalContextUsage(
    "local|lm",
    {
      inputTokens: 8000,
      outputTokens: 192,
      contextTokens: 8192,
      contextWindow: 32768,
      exact: true,
    },
    NOW,
  );
  recordLocalContextUsage(
    "local|lm",
    {
      inputTokens: 8192,
      outputTokens: 192,
      contextTokens: 8384,
      contextWindow: 32768,
      exact: true,
    },
    NOW + 1000,
  );
  // Compaction re-emits the last usage and must not be counted twice.
  recordLocalContextUsage(
    "local|lm",
    {
      inputTokens: 8192,
      outputTokens: 192,
      contextTokens: 8384,
      contextWindow: 32768,
      exact: true,
      compacted: true,
    },
    NOW + 2000,
  );
  const snapshot = buildLocalUsageSnapshot(localCtx({}));
  assert.equal(snapshot.billingMode, "local");
  assert.equal(snapshot.status, "available");
  assert.equal(snapshot.freshness, "observed");
  const quota = snapshot.facts.find((fact) => fact.id === "local.quota");
  assert.equal(quota?.value, "N/A — local inference");
  const context = snapshot.limits[0];
  assert.equal(context?.used, 8384);
  assert.equal(context?.total, 32768);
  assert.ok(Math.abs((context?.usedPercent ?? 0) - (8384 / 32768) * 100) < 1e-9);
  const totals = snapshot.facts.find((fact) => fact.id === "local.totals");
  assert.equal(totals?.value, "16,192 in · 384 out · 2 requests");
});

test("an estimated context window is shown without a percentage", () => {
  recordLocalContextUsage(
    "local|lm",
    { inputTokens: 100, outputTokens: 10, contextTokens: 110, contextWindow: null, exact: true },
    NOW,
  );
  const snapshot = buildLocalUsageSnapshot(localCtx({ contextConfidence: "estimated" }));
  assert.equal(snapshot.limits[0]?.usedPercent, undefined);
  assert.equal(snapshot.limits[0]?.total, undefined);
  assert.match(snapshot.limits[0]?.note ?? "", /estimate/);
});

test("a remote OpenAI-compatible endpoint is never treated as unlimited", () => {
  const snapshot = buildLocalUsageSnapshot(localCtx({ isLocalInference: false }));
  assert.equal(snapshot.billingMode, "unknown");
  assert.equal(snapshot.status, "partial");
  const quota = snapshot.facts.find((fact) => fact.id === "local.quota");
  assert.match(quota?.value ?? "", /^Unavailable/);
  assert.ok(!JSON.stringify(snapshot).includes("N/A"));
});

test("local usage is scoped: another backend's tokens never appear", () => {
  recordLocalContextUsage(
    "local|unsloth",
    { inputTokens: 5, outputTokens: 5, contextTokens: 10, contextWindow: null, exact: true },
    NOW,
  );
  const snapshot = buildLocalUsageSnapshot(localCtx({}));
  assert.equal(snapshot.limits.length, 0);
  assert.equal(snapshot.retrievedAt, undefined);
});

test("Mistral Vibe reports the missing interface without claiming unlimited usage", async () => {
  const snapshot = await mistralVibeUsageAdapter.fetch(
    ctx({
      route: { providerId: "mistral", modelId: "devstral", backendKind: "mistral-vibe-cli-auth" },
    }),
  );
  assert.equal(snapshot.status, "unsupported");
  assert.equal(snapshot.limits.length, 0);
  assert.ok(!/unlimited/i.test(JSON.stringify(snapshot)));
  assert.deepEqual(
    snapshot.facts.map((fact) => [fact.label, fact.value]),
    [
      ["Vibe subscription budget", "Unavailable"],
      ["API rate limits", "Unavailable"],
    ],
  );
});
