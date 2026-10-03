import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  checkLocalProvider,
  resetLocalProviderStateForTests,
  validateLocalProvider,
} from "./local.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetLocalProviderStateForTests();
});
const override = {
  enabled: true,
  type: "openai-compatible" as const,
  baseUrl: "http://127.0.0.1:9123/v1",
  apiKey: "test-key",
};

test("concurrent picker and activation share validation and reuse only successful results", async () => {
  let calls = 0;
  globalThis.fetch = (async (url) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return String(url).endsWith("/api/v0/models")
      ? new Response("", { status: 404 })
      : Response.json({ data: [{ id: "fixture" }] });
  }) as typeof fetch;
  const [first, second] = await Promise.all([
    validateLocalProvider({ override }),
    validateLocalProvider({ override }),
  ]);
  assert.equal(first.status, "ready");
  assert.equal(second, first);
  const before = calls;
  assert.equal(await validateLocalProvider({ override }), first);
  assert.equal(calls, before);
  await validateLocalProvider({ override }, true);
  assert.ok(calls > before);
  const refreshed = calls;
  await validateLocalProvider({ override: { ...override, apiKey: "different-key" } });
  assert.ok(calls > refreshed);
});

test("picker timeout is bounded and distinguishable from a stopped backend", async () => {
  globalThis.fetch = (async (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) as typeof fetch;
  const started = Date.now();
  const result = await checkLocalProvider({ override, timeoutMs: 30 });
  assert.match(result.message ?? "", /timed out/i);
  assert.ok(Date.now() - started < 500);
});

test("failed validation is retried rather than cached", async () => {
  let reachable = false;
  globalThis.fetch = (async (url) => {
    if (!reachable) throw new Error("Connection refused");
    return String(url).endsWith("/api/v0/models")
      ? new Response("", { status: 404 })
      : Response.json({ data: [{ id: "fixture" }] });
  }) as typeof fetch;
  assert.notEqual((await validateLocalProvider({ override })).status, "ready");
  reachable = true;
  assert.equal((await validateLocalProvider({ override })).status, "ready");
});
