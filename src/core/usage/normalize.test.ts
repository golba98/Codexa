import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUsageScopeKey,
  cleanProviderText,
  completePercentPair,
  deriveLimitState,
  formatPlanName,
  normalizePercent,
  parseResetTime,
  percentFromFraction,
  percentOfTotal,
  windowLabel,
} from "./normalize.js";

const NOW = Date.parse("2026-10-09T12:00:00Z");

test("percentages outside 0–100 or non-numeric are unknown, not clamped", () => {
  assert.equal(normalizePercent(0), 0);
  assert.equal(normalizePercent(100), 100);
  assert.equal(normalizePercent(42.5), 42.5);
  assert.equal(normalizePercent(-1), undefined);
  assert.equal(normalizePercent(101), undefined);
  assert.equal(normalizePercent(Number.NaN), undefined);
  assert.equal(normalizePercent("50"), undefined);
  assert.equal(normalizePercent(null), undefined);
});

test("fractions convert to percentages and reject out-of-range values", () => {
  assert.equal(percentFromFraction(1), 100);
  assert.equal(percentFromFraction(0), 0);
  assert.equal(percentFromFraction(0.25), 25);
  assert.equal(percentFromFraction(1.2), undefined);
  assert.equal(percentFromFraction(undefined), undefined);
});

test("a percentage of a total needs a verified positive denominator", () => {
  assert.equal(percentOfTotal(25, 100), 25);
  assert.equal(percentOfTotal(0, 50), 0);
  assert.equal(percentOfTotal(10, 0), undefined);
  assert.equal(percentOfTotal(10, undefined), undefined);
  assert.equal(percentOfTotal(undefined, 100), undefined);
  assert.equal(percentOfTotal(120, 100), undefined);
});

test("reset times accept epoch seconds, epoch milliseconds and ISO 8601", () => {
  const target = Date.parse("2026-10-09T17:00:00Z");
  assert.equal(parseResetTime(target / 1000, NOW), target);
  assert.equal(parseResetTime(target, NOW), target);
  assert.equal(parseResetTime("2026-10-09T17:00:00Z", NOW), target);
  assert.equal(parseResetTime("2026-10-09T17:00:00.000000+00:00", NOW), target);
  assert.equal(parseResetTime(String(target / 1000), NOW), target);
});

test("invalid or implausible reset times are dropped", () => {
  assert.equal(parseResetTime("not a date", NOW), undefined);
  assert.equal(parseResetTime("", NOW), undefined);
  assert.equal(parseResetTime(null, NOW), undefined);
  assert.equal(parseResetTime(-5, NOW), undefined);
  assert.equal(parseResetTime(Number.POSITIVE_INFINITY, NOW), undefined);
  assert.equal(parseResetTime("2199-01-01T00:00:00Z", NOW), undefined);
  assert.equal(parseResetTime(1, NOW), undefined);
});

test("window labels name known durations and fall back for unknown ones", () => {
  assert.equal(windowLabel(300), "5-hour limit");
  assert.equal(windowLabel(10080), "Weekly limit");
  assert.equal(windowLabel(1440), "1-day limit");
  assert.equal(windowLabel(45), "45-minute limit");
  assert.equal(windowLabel(0), undefined);
  assert.equal(windowLabel(undefined), undefined);
});

test("percent pairs are derived only from a reported percentage", () => {
  assert.deepEqual(completePercentPair({ usedPercent: 30 }), {
    usedPercent: 30,
    remainingPercent: 70,
  });
  assert.deepEqual(completePercentPair({ remainingPercent: 0 }), {
    usedPercent: 100,
    remainingPercent: 0,
  });
  assert.deepEqual(completePercentPair({}), {});
});

test("limit state marks exhausted quotas and leaves unknown ones unknown", () => {
  assert.equal(
    deriveLimitState({ id: "a", label: "a", unit: "percent", remainingPercent: 0 }),
    "exhausted",
  );
  assert.equal(
    deriveLimitState({
      id: "a",
      label: "a",
      unit: "percent",
      usedPercent: 10,
      remainingPercent: 90,
    }),
    "ok",
  );
  assert.equal(deriveLimitState({ id: "a", label: "a", unit: "percent" }), undefined);
  assert.equal(
    deriveLimitState({ id: "a", label: "a", unit: "requests", remaining: 0, total: 50 }),
    "exhausted",
  );
});

test("provider text is sanitised, collapsed and bounded", () => {
  assert.equal(cleanProviderText("  Gemini\n\u001b[31mModels\u001b[0m  "), "Gemini Models");
  assert.equal(cleanProviderText(42), undefined);
  assert.equal(cleanProviderText("   "), undefined);
  assert.equal(cleanProviderText("abcdef", 4), "abc…");
  assert.equal(formatPlanName("plus"), "Plus");
  assert.equal(formatPlanName("max_20x"), "Max 20x");
});

test("scope keys separate providers, billing routes and endpoints without secrets", () => {
  const claudeCli = buildUsageScopeKey({
    providerId: "anthropic",
    backendKind: "claude-code-auth",
  });
  const claudeApi = buildUsageScopeKey(
    { providerId: "anthropic", backendKind: "anthropic-api-key" },
    { apiKey: "sk-ant-secret" },
  );
  const codex = buildUsageScopeKey({ providerId: "openai", backendKind: "codex-cli-auth" });
  assert.notEqual(claudeCli, claudeApi);
  assert.notEqual(claudeCli, codex);
  assert.ok(!claudeApi.includes("secret"));
  const lmStudio = buildUsageScopeKey(
    { providerId: "local", backendKind: "local-openai-compatible", localBackend: "lm-studio" },
    { baseUrl: "http://127.0.0.1:1234/v1" },
  );
  const unsloth = buildUsageScopeKey(
    { providerId: "local", backendKind: "local-openai-compatible", localBackend: "unsloth" },
    { baseUrl: "http://127.0.0.1:1234/v1" },
  );
  assert.notEqual(lmStudio, unsloth);
});
