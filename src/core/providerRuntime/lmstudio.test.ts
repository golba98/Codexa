import assert from "node:assert/strict";
import test from "node:test";
import { deriveLmStudioApiRoot, fetchLmStudioModelInfo, fetchLmStudioModels, parseLmStudioModelsResponse } from "./lmstudio.js";

const FIXTURE = {
  id: "google/gemma-4-26b-a4b",
  object: "model",
  type: "vlm",
  publisher: "google",
  arch: "gemma4",
  compatibility_type: "gguf",
  quantization: "Q4_K_M",
  state: "loaded",
  max_context_length: 262144,
  loaded_context_length: 64000,
  capabilities: ["tool_use"],
};

const LIST_FIXTURE = {
  data: [
    {
      id: "qwen/qwen3.6-27b",
      object: "model",
      type: "vlm",
      publisher: "qwen",
      arch: "qwen35",
      compatibility_type: "gguf",
      quantization: "Q4_K_M",
      state: "loaded",
      max_context_length: 262144,
      loaded_context_length: 32000,
      capabilities: [
        "tool_use",
      ],
    },
  ],
  object: "list",
};

test("deriveLmStudioApiRoot strips /v1 path", () => {
  assert.equal(deriveLmStudioApiRoot("http://localhost:1234/v1"), "http://localhost:1234/api/v0");
});

test("deriveLmStudioApiRoot strips trailing slash from /v1/", () => {
  assert.equal(deriveLmStudioApiRoot("http://localhost:1234/v1/"), "http://localhost:1234/api/v0");
});

test("deriveLmStudioApiRoot works with arbitrary host and port", () => {
  assert.equal(
    deriveLmStudioApiRoot("http://my-server.local:8080/api/v1"),
    "http://my-server.local:8080/api/v0",
  );
});

test("deriveLmStudioApiRoot returns null for invalid URL", () => {
  assert.equal(deriveLmStudioApiRoot("not-a-url"), null);
});

test("fetchLmStudioModelInfo URL-encodes model IDs containing slashes", async () => {
  let capturedUrl = "";
  const mockFetch = async (url: string) => {
    capturedUrl = url;
    return new Response(JSON.stringify(FIXTURE), { status: 200 });
  };

  await fetchLmStudioModelInfo({
    apiRoot: "http://localhost:1234/api/v0",
    modelId: "google/gemma-4-26b-a4b",
    fetchImpl: mockFetch as typeof fetch,
  });

  assert.match(capturedUrl, /google%2Fgemma-4-26b-a4b/);
  assert.doesNotMatch(capturedUrl, /google\/gemma/);
});

test("fetchLmStudioModelInfo returns fixture values on success", async () => {
  const mockFetch = async () => new Response(JSON.stringify(FIXTURE), { status: 200 });

  const result = await fetchLmStudioModelInfo({
    apiRoot: "http://localhost:1234/api/v0",
    modelId: "google/gemma-4-26b-a4b",
    fetchImpl: mockFetch as typeof fetch,
  });

  assert.deepEqual(result, FIXTURE);
});

test("fetchLmStudioModelInfo returns null on non-2xx response", async () => {
  const mockFetch = async () => new Response("Not Found", { status: 404 });

  const result = await fetchLmStudioModelInfo({
    apiRoot: "http://localhost:1234/api/v0",
    modelId: "some-model",
    fetchImpl: mockFetch as typeof fetch,
  });

  assert.equal(result, null);
});

test("fetchLmStudioModelInfo returns null on network error", async () => {
  const mockFetch = async (): Promise<Response> => {
    throw new Error("ECONNREFUSED");
  };

  const result = await fetchLmStudioModelInfo({
    apiRoot: "http://localhost:1234/api/v0",
    modelId: "some-model",
    fetchImpl: mockFetch as typeof fetch,
  });

  assert.equal(result, null);
});

test("fetchLmStudioModelInfo returns null on invalid JSON", async () => {
  const mockFetch = async () => new Response("not json{{{", { status: 200 });

  const result = await fetchLmStudioModelInfo({
    apiRoot: "http://localhost:1234/api/v0",
    modelId: "some-model",
    fetchImpl: mockFetch as typeof fetch,
  });

  assert.equal(result, null);
});

test("fetchLmStudioModelInfo returns null when response is missing id field", async () => {
  const mockFetch = async () =>
    new Response(JSON.stringify({ object: "model", type: "vlm" }), { status: 200 });

  const result = await fetchLmStudioModelInfo({
    apiRoot: "http://localhost:1234/api/v0",
    modelId: "some-model",
    fetchImpl: mockFetch as typeof fetch,
  });

  assert.equal(result, null);
});

test("parseLmStudioModelsResponse parses LM Studio data array list response", () => {
  const parsed = parseLmStudioModelsResponse(LIST_FIXTURE);

  assert.equal(parsed?.object, "list");
  assert.equal(parsed?.data[0]?.id, "qwen/qwen3.6-27b");
  assert.equal(parsed?.data[0]?.state, "loaded");
  assert.equal(parsed?.data[0]?.loaded_context_length, 32000);
  assert.equal(parsed?.data[0]?.max_context_length, 262144);
  assert.deepEqual(parsed?.data[0]?.capabilities, ["tool_use"]);
});

test("parseLmStudioModelsResponse does not expect the response itself to be an array", () => {
  assert.equal(parseLmStudioModelsResponse([LIST_FIXTURE.data[0]]), null);
});

test("fetchLmStudioModels reads native /api/v0/models list endpoint", async () => {
  let capturedUrl = "";
  const mockFetch = async (url: string) => {
    capturedUrl = url;
    return new Response(JSON.stringify(LIST_FIXTURE), { status: 200 });
  };

  const result = await fetchLmStudioModels({
    apiRoot: "http://localhost:1234/api/v0",
    fetchImpl: mockFetch as typeof fetch,
  });

  assert.equal(capturedUrl, "http://localhost:1234/api/v0/models");
  assert.equal(result?.data[0]?.id, "qwen/qwen3.6-27b");
});
