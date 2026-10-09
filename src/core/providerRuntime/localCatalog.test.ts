import { expect, test } from "bun:test";
import { localRuntime, resetLocalProviderStateForTests } from "./local.js";

test("reachable compatible server with no models returns authoritative empty inventory", async () => {
  const original = globalThis.fetch;
  resetLocalProviderStateForTests();
  try {
    globalThis.fetch = (async (input) =>
      String(input).endsWith("/v1/models")
        ? Response.json({ object: "list", data: [] })
        : new Response("not found", { status: 404 })) as typeof fetch;
    const discovery = await localRuntime.refreshModels!({
      cwd: "/tmp/local-empty-fixture",
      localConfig: { baseUrl: "http://localhost:11434/v1", type: "openai-compatible" },
    });
    expect(discovery.models).toEqual([]);
    expect(discovery.freshness).toBe("verified");
    expect(discovery.status).toBe("ready");
    expect(discovery.message).toContain("configured local server");
  } finally {
    globalThis.fetch = original;
    resetLocalProviderStateForTests();
  }
});
