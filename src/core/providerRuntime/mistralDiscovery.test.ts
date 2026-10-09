import { expect, test } from "bun:test";
import { resolveCatalogModel } from "../models/modelSelection.js";
import {
  fetchMistralModels,
  parseMistralModels,
  resolveMistralConnection,
} from "./mistralDiscovery.js";

const item = (id: string, capabilities: Record<string, unknown> = { completion_chat: true }) => ({
  id,
  capabilities,
});

test("live inventory preserves future IDs, extracts real metadata and filters incompatible operations", () => {
  const models = parseMistralModels({
    data: [
      item("devstral-future", {
        completion_chat: true,
        function_calling: true,
        vision: false,
        reasoning: true,
      }),
      item("embedding", { completion_chat: false }),
      item("unknown"),
      item("archived", { completion_chat: true }),
      { id: "archived", archived: true, capabilities: { completion_chat: true } },
    ],
  });
  expect(models[0]?.modelId).toBe("devstral-future");
  expect(models[0]?.capabilities).toEqual({
    chat: true,
    tools: true,
    vision: false,
    reasoning: true,
  });
  expect(models[0]?.supportedReasoningLevels).toBeNull();
  expect(models.find((model) => model.modelId === "embedding")).toBeUndefined();
});

test("aliases remain metadata, duplicate identities deduplicate and label collisions disambiguate", () => {
  const models = parseMistralModels({
    data: [
      { ...item("native"), aliases: ["alias"], name: "Same", max_context_length: 32000 },
      { ...item("other"), name: "Same" },
      { ...item("native"), aliases: ["alias"], name: "Same", max_context_length: 32000 },
    ],
  });
  expect(models.length).toBe(2);
  expect(models[0]?.contextWindow).toBe(32000);
  expect(models[0]?.label).not.toBe(models[1]?.label);
  expect(resolveCatalogModel(models, "alias")?.modelId).toBe("native");
});

for (const body of [null, {}, { data: "bad" }, { data: [{ broken: true }] }])
  test(`malformed inventory rejects ${JSON.stringify(body)}`, () =>
    expect(() => parseMistralModels(body)).toThrow());
test("empty and non-chat inventories are valid empty results", () => {
  expect(parseMistralModels({ data: [] })).toEqual([]);
  expect(parseMistralModels({ data: [item("ocr", { completion_chat: false })] })).toEqual([]);
});
test("unknown capability metadata stays unknown", () =>
  expect(parseMistralModels({ data: [item("future")] })[0]?.capabilities?.tools).toBeNull());
test("documented effective effort values are none/high, not another provider's options", () =>
  expect(
    parseMistralModels({
      data: [item("mistral-medium-3-5", { completion_chat: true, reasoning: true })],
    })[0]?.supportedReasoningLevels?.map((level) => level.id),
  ).toEqual(["none", "high"]));
test("connection respects explicit endpoint and key without duplicate v1", () => {
  const connection = resolveMistralConnection(
    "/tmp",
    { baseUrl: "https://fixture.test/v1/", apiKey: "test-key" },
    {},
  );
  expect(connection.baseUrl).toBe("https://fixture.test/v1");
  expect(connection.apiKey).toBe("test-key");
});

for (const status of [401, 403, 429, 500])
  test(`HTTP ${status} reports failure without echoing server secrets`, async () => {
    const result = await fetchMistralModels({
      cwd: "/tmp",
      providerConfig: { apiKey: "test-key" },
      fetchImpl: (async () =>
        new Response("secret-server-body", {
          status,
          headers: { "retry-after": "10" },
        })) as typeof fetch,
    });
    expect(result.freshness).toBe("unverified");
    expect(result.refreshState).toBe(status === 401 || status === 403 ? "auth-required" : "failed");
    expect(JSON.stringify(result)).not.toContain("secret-server-body");
  });
test("authenticated request uses configured endpoint and returns selectable native IDs", async () => {
  let url = "";
  let authorization = "";
  const result = await fetchMistralModels({
    cwd: "/tmp",
    providerConfig: { apiKey: "test-key", baseUrl: "https://fixture.test/v1" },
    fetchImpl: (async (input, init) => {
      url = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({ data: [item("new-chat")] });
    }) as typeof fetch,
  });
  expect(url).toBe("https://fixture.test/v1/models");
  expect(authorization).toBe("Bearer test-key");
  expect(result.models[0]?.modelId).toBe("new-chat");
  expect(result.freshness).toBe("verified");
});
test("network and malformed body failures are bounded safe states", async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error("sensitive diagnostic");
    },
    async () => Response.json({ nope: [] }),
  ]) {
    const result = await fetchMistralModels({
      cwd: "/tmp",
      providerConfig: { apiKey: "test-key" },
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.refreshState).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("sensitive diagnostic");
  }
});
