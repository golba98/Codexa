import { expect, test } from "bun:test";
import { discoverGeminiModels, parseGeminiModels } from "./geminiDiscovery.js";
import { formatGeminiModelLabel, normalizeGeminiModelId } from "./models.js";

const item = (name: string, extra = {}) => ({
  name,
  supportedGenerationMethods: ["generateContent"],
  ...extra,
});
for (const [id, label] of [
  ["models/gemini-3.8-flash", "Gemini 3.8 Flash"],
  ["gemini-3.7-flash", "Gemini 3.7 Flash"],
  ["gemini-3.6-flash", "Gemini 3.6 Flash"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro (Preview)"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite"],
  ["models/gemini-2.5-pro", "Gemini 2.5 Pro"],
  ["gemini-99.8-pro-experimental", "Gemini 99.8 Pro (Experimental)"],
  ["gemini-3.8-flash-high", "Gemini 3.8 Flash High"],
  ["gemini-4.0-pro-image", "Gemini 4.0 Pro Image"],
  ["future-route", "future route"],
])
  test(`clean Gemini label preserves exact identifier ${id}`, () => {
    expect(formatGeminiModelLabel(id)).toBe(label);
    expect(normalizeGeminiModelId(id)).toBe(id);
    expect(parseGeminiModels({ models: [item(id)] })[0]?.modelId).toBe(id);
  });
test("metadata fallback, duplicate provider prefixes and malformed names", () => {
  expect(formatGeminiModelLabel("unknown", "Gemini Gemini Future Model")).toBe(
    "Gemini Future Model",
  );
  expect(formatGeminiModelLabel("")).toBe("");
  expect(
    parseGeminiModels({
      models: [
        null,
        {},
        item(""),
        item("embeddings", { supportedGenerationMethods: ["embedContent"] }),
      ],
    }),
  ).toEqual([]);
});
test("duplicate IDs and collisions are deterministic, capabilities not inferred from names", () => {
  const models = parseGeminiModels({
    models: [item("models/gemini-2.5-pro"), item("gemini-2.5-pro"), item("gemini-2.5-pro")],
  });
  expect(models.length).toBe(2);
  expect(models[0]?.label).not.toBe(models[1]?.label);
  expect(models[0]?.capabilities?.tools).toBeNull();
});
test("account-scoped ACP IDs stay native while documented controls use correct shape", () => {
  const models = parseGeminiModels(
    {
      availableModels: [
        { modelId: "gemini-2.5-flash", name: "Technical Gemini" },
        { modelId: "future-id", name: "Future Model" },
      ],
    },
    true,
  );
  expect(models[0]?.modelId).toBe("gemini-2.5-flash");
  expect(models[0]?.reasoningControl?.kind).toBe("budget");
  expect(models[1]?.label).toBe("Future Model");
  expect(models[1]?.reasoningControl?.kind).toBe("unknown");
});
for (const body of [null, {}, { models: "bad" }])
  test(`malformed Google inventory ${JSON.stringify(body)}`, () =>
    expect(() => parseGeminiModels(body)).toThrow());
test("native API discovery paginates with header authentication and no identifier rewrite", async () => {
  const urls: string[] = [];
  const headers: string[] = [];
  const result = await discoverGeminiModels({
    cwd: "/tmp",
    providerConfig: { apiKey: "test-google-key", baseUrl: "https://fixture.test/v1beta" },
    fetchImpl: (async (url, init) => {
      urls.push(String(url));
      headers.push(new Headers(init?.headers).get("x-goog-api-key") ?? "");
      return Response.json(
        urls.length === 1
          ? { models: [item("models/gemini-99.8-pro")], nextPageToken: "page2" }
          : { models: [item("models/gemini-99.8-flash")] },
      );
    }) as typeof fetch,
  });
  expect(result.freshness).toBe("verified");
  expect(result.models.length).toBe(2);
  expect(urls[1]).toContain("pageToken=page2");
  expect(urls.join()).not.toContain("test-google-key");
  expect(headers).toEqual(["test-google-key", "test-google-key"]);
});
for (const status of [401, 403, 429, 503])
  test(`Google HTTP ${status} refresh is unverified`, async () => {
    const result = await discoverGeminiModels({
      cwd: "/tmp",
      providerConfig: { apiKey: "fixture" },
      fetchImpl: (async () => new Response("sensitive", { status })) as typeof fetch,
    });
    expect(result.freshness).toBe("unverified");
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
test("repeated page tokens fail safely", async () => {
  const result = await discoverGeminiModels({
    cwd: "/tmp",
    providerConfig: { apiKey: "fixture" },
    fetchImpl: (async () => Response.json({ models: [], nextPageToken: "same" })) as typeof fetch,
  });
  expect(result.refreshState).toBe("failed");
});

for (const [id, levels, defaultLevel] of [
  ["models/gemini-3.1-pro-preview", ["low", "medium", "high"], "high"],
  ["gemini-3.8-flash", ["low", "medium", "high"], "medium"],
  ["gemini-3.6-flash", ["minimal", "low", "medium", "high"], "medium"],
  ["gemini-3.1-flash-lite-image", ["minimal", "high"], "minimal"],
] as const)
  test(`documented native Gemini controls ${id}`, () => {
    const model = parseGeminiModels({ models: [item(id)] })[0];
    expect(model?.supportedReasoningLevels?.map((level) => level.id)).toEqual([...levels]);
    expect(model?.defaultReasoningLevel).toBe(defaultLevel);
    expect(model?.modelId).toBe(id);
  });
test("Flash Lite defaults off and explicit negative metadata overrides documented controls", () => {
  const models = parseGeminiModels({
    models: [
      item("gemini-2.5-flash-lite"),
      item("gemini-3.1-pro", { thinking: false }),
      item("gemini-99.8-pro"),
    ],
  });
  expect(models[0]?.defaultReasoningLevel).toBe("budget:0");
  expect(models[0]?.reasoningControl).toMatchObject({
    kind: "budget",
    default: 0,
    min: 512,
    canDisable: true,
  });
  expect(models[1]?.reasoningControl?.kind).toBe("unsupported");
  expect(models[2]?.reasoningControl?.kind).toBe("unknown");
});
