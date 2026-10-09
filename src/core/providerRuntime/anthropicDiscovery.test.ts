import { expect, test } from "bun:test";
import { fetchAnthropicModels, parseAnthropicModels } from "./anthropicDiscovery.js";

const entry = {
  id: "claude-future-99-8",
  display_name: "Claude Future 99.8",
  line: "future",
  max_input_tokens: 131072,
  capabilities: {
    image_input: { supported: true },
    thinking: { supported: true },
    effort: {
      supported: true,
      low: { supported: true },
      medium: { supported: false },
      max: { supported: true },
    },
  },
};
test("Claude API metadata exposes only advertised effort levels and exact future IDs", () => {
  const models = parseAnthropicModels({
    data: [entry, entry, { id: "retired", lifecycle: "retired" }, { id: "unknown" }],
  });
  expect(models.map((m) => m.modelId)).toEqual([entry.id, "unknown"]);
  expect(models[0]?.supportedReasoningLevels?.map((l) => l.id)).toEqual(["low", "max"]);
  expect(models[0]?.contextWindow).toBe(131072);
  expect(models[1]?.capabilities?.vision).toBeNull();
  expect(models[1]?.reasoningControl).toEqual({ kind: "unknown" });
});
test("Claude API rejects malformed root and entries but accepts empty inventories", () => {
  expect(() => parseAnthropicModels({})).toThrow();
  expect(() => parseAnthropicModels({ data: [{}, null] })).toThrow();
  expect(parseAnthropicModels({ data: [] })).toEqual([]);
});
test("Claude API pagination authenticates with configured key and endpoint without changing IDs", async () => {
  const urls: string[] = [];
  const result = await fetchAnthropicModels({
    providerConfig: { apiKey: "fixture", baseUrl: "https://fixture.test/v1" },
    fetchImpl: (async (url, init) => {
      urls.push(String(url));
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("fixture");
      return Response.json(
        urls.length === 1
          ? { data: [entry], has_more: true, last_id: entry.id }
          : { data: [entry, { id: "new" }], has_more: false },
      );
    }) as typeof fetch,
  });
  expect(result.models.map((m) => m.modelId)).toEqual([entry.id, "new"]);
  expect(urls[1]).toContain(`after_id=${entry.id}`);
  expect(result.freshness).toBe("verified");
});
for (const code of [401, 403, 429, 500])
  test(`Claude API HTTP ${code} is safe and explicit`, async () => {
    const result = await fetchAnthropicModels({
      providerConfig: { apiKey: "secret-fixture" },
      fetchImpl: (async () => new Response("secret-fixture", { status: code })) as typeof fetch,
    });
    expect(result.freshness).toBe("unverified");
    expect(result.message).not.toContain("secret-fixture");
    expect(result.refreshState).toBe(code === 401 || code === 403 ? "auth-required" : "failed");
  });
test("Claude API invalid pagination fails rather than retaining a partial verified catalog", async () => {
  const result = await fetchAnthropicModels({
    providerConfig: { apiKey: "fixture" },
    fetchImpl: (async () =>
      Response.json({ data: [entry], has_more: true, last_id: entry.id })) as typeof fetch,
  });
  expect(result.refreshState).toBe("failed");
  expect(result.models).toEqual([]);
});
