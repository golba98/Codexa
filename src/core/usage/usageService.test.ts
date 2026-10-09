import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderRoute } from "../providerRuntime/types.js";
import type { ProviderUsageSnapshot, UsageAdapter, UsageRequestContext } from "./types.js";
import {
  createUsageService,
  DEFAULT_USAGE_COOLDOWN_MS,
  resolveUsageCooldownMs,
} from "./usageService.js";

const ROUTE: ProviderRoute = { providerId: "openai", modelId: "m", backendKind: "codex-cli-auth" };

function snapshot(
  scopeKey: string,
  overrides: Partial<ProviderUsageSnapshot> = {},
): ProviderUsageSnapshot {
  return {
    providerId: "openai",
    providerLabel: "OpenAI / Codex",
    scopeKey,
    billingMode: "subscription",
    status: "available",
    retrievedAt: 0,
    freshness: "live",
    source: "test",
    limits: [
      { id: "a", label: "5-hour limit", unit: "percent", usedPercent: 40, remainingPercent: 60 },
    ],
    facts: [],
    ...overrides,
  };
}

function scriptedAdapter(
  results: Array<ProviderUsageSnapshot | Error>,
  options: { passive?: boolean } = {},
) {
  const calls: UsageRequestContext[] = [];
  const resolvers: Array<() => void> = [];
  let manual = false;
  const adapter: UsageAdapter = {
    id: "scripted",
    passive: options.passive,
    fetch: (context) => {
      calls.push(context);
      const next = results.shift() ?? snapshot(context.scopeKey);
      const settle = () => (next instanceof Error ? Promise.reject(next) : Promise.resolve(next));
      if (!manual) return settle();
      return new Promise((resolve, reject) => {
        resolvers.push(() => settle().then(resolve, reject));
      });
    },
  };
  return {
    adapter,
    calls,
    hold() {
      manual = true;
    },
    release() {
      for (const resolve of resolvers.splice(0)) resolve();
    },
  };
}

function context(scopeKey: string) {
  return { route: ROUTE, workspaceRoot: "/tmp", scopeKey };
}

test("cooldown defaults to 30 seconds and honours a bounded environment override", () => {
  assert.equal(resolveUsageCooldownMs({}), DEFAULT_USAGE_COOLDOWN_MS);
  assert.equal(resolveUsageCooldownMs({ UBUME_USAGE_COOLDOWN_SECONDS: "5" }), 5000);
  assert.equal(resolveUsageCooldownMs({ UBUME_USAGE_COOLDOWN_SECONDS: "0" }), 0);
  assert.equal(resolveUsageCooldownMs({ UBUME_USAGE_COOLDOWN_SECONDS: "9999" }), 600_000);
  assert.equal(
    resolveUsageCooldownMs({ UBUME_USAGE_COOLDOWN_SECONDS: "-3" }),
    DEFAULT_USAGE_COOLDOWN_MS,
  );
  assert.equal(
    resolveUsageCooldownMs({ UBUME_USAGE_COOLDOWN_SECONDS: "abc" }),
    DEFAULT_USAGE_COOLDOWN_MS,
  );
});

test("a fresh request is live; a repeat within the cooldown is cached and not re-fetched", async () => {
  let now = 1_000;
  const service = createUsageService({ now: () => now, cooldownMs: 30_000 });
  const scripted = scriptedAdapter([]);
  const first = await service.request(scripted.adapter, context("codex"));
  assert.equal(first.origin, "live");
  assert.equal(scripted.calls.length, 1);

  now += 10_000;
  const second = await service.request(scripted.adapter, context("codex"));
  assert.equal(second.origin, "cached");
  assert.equal(scripted.calls.length, 1);
  assert.equal(second.nextRefreshAt, 31_000);

  now += 21_000;
  const third = await service.request(scripted.adapter, context("codex"));
  assert.equal(third.origin, "live");
  assert.equal(scripted.calls.length, 2);
});

test("concurrent refreshes share one in-flight provider request", async () => {
  const service = createUsageService({ now: () => 0, cooldownMs: 0 });
  const scripted = scriptedAdapter([]);
  scripted.hold();
  const a = service.request(scripted.adapter, context("codex"));
  const b = service.request(scripted.adapter, context("codex"));
  assert.equal(service.peek("codex").inFlight, true);
  scripted.release();
  const [viewA, viewB] = await Promise.all([a, b]);
  assert.equal(scripted.calls.length, 1);
  assert.equal(viewA, viewB);
  assert.equal(service.peek("codex").inFlight, false);
});

test("a failed refresh keeps the last good snapshot and labels it stale", async () => {
  let now = 0;
  const service = createUsageService({ now: () => now, cooldownMs: 0 });
  const good = snapshot("codex");
  const scripted = scriptedAdapter([
    good,
    snapshot("codex", {
      status: "temporarily_unavailable",
      limits: [],
      message: "HTTP 429 rate limited",
    }),
  ]);
  await service.request(scripted.adapter, context("codex"));
  now = 5_000;
  const view = await service.request(scripted.adapter, context("codex"));
  assert.equal(view.origin, "stale");
  assert.equal(view.snapshot, good);
  assert.equal(view.lastError, "HTTP 429 rate limited");
});

test("a failure with no earlier data is shown as the failure itself", async () => {
  const service = createUsageService({ now: () => 0, cooldownMs: 0 });
  const scripted = scriptedAdapter([new Error("spawn ENOENT")]);
  const view = await service.request(scripted.adapter, context("codex"));
  assert.equal(view.origin, "live");
  assert.equal(view.snapshot?.status, "temporarily_unavailable");
  assert.equal(view.snapshot?.message, "spawn ENOENT");
  assert.equal(view.snapshot?.limits.length, 0);
});

test("unsupported and authentication results replace earlier data instead of going stale", async () => {
  const service = createUsageService({ now: () => 0, cooldownMs: 0 });
  const scripted = scriptedAdapter([
    snapshot("claude"),
    snapshot("claude", { status: "authentication_required", limits: [], message: "Signed out" }),
  ]);
  await service.request(scripted.adapter, context("claude"));
  const view = await service.request(scripted.adapter, context("claude"));
  assert.equal(view.origin, "live");
  assert.equal(view.snapshot?.status, "authentication_required");
});

test("scopes never share cached snapshots", async () => {
  const service = createUsageService({ now: () => 0, cooldownMs: 60_000 });
  const scripted = scriptedAdapter([]);
  await service.request(scripted.adapter, context("codex"));
  assert.equal(service.peek("claude").snapshot, null);
  assert.equal(service.peek("claude").origin, null);
  const claude = await service.request(scripted.adapter, context("claude"));
  assert.equal(claude.snapshot?.scopeKey, "claude");
  assert.equal(scripted.calls.length, 2);
});

test("passive adapters bypass the cooldown because they make no provider request", async () => {
  const service = createUsageService({ now: () => 0, cooldownMs: 60_000 });
  const scripted = scriptedAdapter([], { passive: true });
  await service.request(scripted.adapter, context("local"));
  const again = await service.request(scripted.adapter, context("local"));
  assert.equal(again.origin, "live");
  assert.equal(scripted.calls.length, 2);
});

test("peek reports cached data without contacting the provider", async () => {
  const service = createUsageService({ now: () => 0, cooldownMs: 0 });
  const scripted = scriptedAdapter([]);
  assert.equal(service.peek("codex").snapshot, null);
  await service.request(scripted.adapter, context("codex"));
  assert.equal(service.peek("codex").origin, "cached");
  assert.equal(scripted.calls.length, 1);
});
