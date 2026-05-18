import assert from "node:assert/strict";
import test from "node:test";
import {
  clearModelContextMetadataCache,
  contextMetadataToModelSpec,
  formatContextLength,
  formatContextMeter,
  resolveModelContextLength,
  resolveModelContextLengthCached,
} from "./contextMetadata.js";

test("Local /v1/models context_length metadata is used as verified API context", async () => {
  clearModelContextMetadataCache();
  const metadata = await resolveModelContextLength({
    providerId: "local",
    modelId: "google/gemma-4-26b-a4b",
    rawMetadata: {
      id: "google/gemma-4-26b-a4b",
      context_length: 8192,
    },
  });

  assert.equal(metadata.contextLength, 8192);
  assert.equal(metadata.source, "api");
  assert.equal(metadata.confidence, "verified");
  assert.equal(metadata.rawField, "context_length");
});

test("Local /v1/models nested context metadata is detected", async () => {
  clearModelContextMetadataCache();
  const metadata = await resolveModelContextLength({
    providerId: "local",
    modelId: "local-model",
    rawMetadata: {
      id: "local-model",
      model_info: {
        max_context_length: 32768,
      },
    },
  });

  assert.equal(metadata.contextLength, 32768);
  assert.equal(metadata.source, "api");
  assert.equal(metadata.rawField, "model_info.max_context_length");
});

test("Local /v1/models without context metadata returns Unknown", async () => {
  clearModelContextMetadataCache();
  const metadata = await resolveModelContextLength({
    providerId: "local",
    modelId: "google/gemma-4-26b-a4b",
    rawMetadata: {
      id: "google/gemma-4-26b-a4b",
    },
  });

  assert.equal(metadata.contextLength, null);
  assert.equal(metadata.source, "unknown");
  assert.equal(metadata.confidence, "unknown");
  assert.match(metadata.error ?? "", /did not include context length metadata/);
  assert.equal(formatContextLength(metadata.contextLength), "Unknown");
});

test("config override supplies context length when API metadata is unknown", async () => {
  clearModelContextMetadataCache();
  const metadata = await resolveModelContextLength({
    providerId: "local",
    modelId: "google/gemma-4-26b-a4b",
    rawMetadata: {
      id: "google/gemma-4-26b-a4b",
    },
    providerConfig: {
      models: {
        "google/gemma-4-26b-a4b": {
          contextLength: 8192,
        },
      },
    },
  });

  assert.equal(metadata.contextLength, 8192);
  assert.equal(metadata.source, "config");
  assert.equal(metadata.confidence, "configured");
});

test("invalid config context length is rejected as Unknown", async () => {
  clearModelContextMetadataCache();
  const metadata = await resolveModelContextLength({
    providerId: "local",
    modelId: "bad-model",
    providerConfig: {
      models: {
        "bad-model": {
          contextLength: 0,
        },
      },
    },
  });

  assert.equal(metadata.contextLength, null);
  assert.equal(metadata.source, "unknown");
  assert.match(metadata.error ?? "", /Invalid configured contextLength/);
});

test("known registry values are exact provider/model matches only", async () => {
  clearModelContextMetadataCache();
  const exact = await resolveModelContextLength({
    providerId: "google",
    modelId: "gemini-2.5-flash",
  });
  const unknown = await resolveModelContextLength({
    providerId: "google",
    modelId: "gemini-2.5-flash-custom",
  });
  const gemini3 = await resolveModelContextLength({
    providerId: "google",
    modelId: "gemini-3-flash-preview",
  });

  assert.equal(exact.contextLength, 1_048_576);
  assert.equal(exact.source, "known-registry");
  assert.equal(exact.confidence, "known");
  assert.equal(unknown.contextLength, null);
  assert.equal(gemini3.contextLength, null);
});

test("unknown context converts to model spec without fake percentage inputs", async () => {
  clearModelContextMetadataCache();
  const metadata = await resolveModelContextLength({
    providerId: "local",
    modelId: "unknown-local-model",
  });
  const spec = contextMetadataToModelSpec(metadata);

  assert.equal(spec.status, "unknown");
  assert.equal(spec.contextWindow, null);
  assert.equal(spec.maxOutputTokens, null);
});

test("context metadata cache can be upgraded from Unknown when raw API metadata arrives", async () => {
  clearModelContextMetadataCache();
  const first = resolveModelContextLengthCached({
    providerId: "local",
    modelId: "cached-local-model",
  });
  const second = await resolveModelContextLength({
    providerId: "local",
    modelId: "cached-local-model",
    rawMetadata: {
      id: "cached-local-model",
      n_ctx: 4096,
    },
  });
  const third = resolveModelContextLengthCached({
    providerId: "local",
    modelId: "cached-local-model",
  });

  assert.equal(first.contextLength, null);
  assert.equal(second.contextLength, 4096);
  assert.equal(third.contextLength, 4096);
});

test("loaded_context_length takes priority over max_context_length and uses lmstudio-api source", async () => {
  clearModelContextMetadataCache();
  const metadata = await resolveModelContextLength({
    providerId: "local",
    modelId: "google/gemma-4-26b-a4b",
    rawMetadata: {
      id: "google/gemma-4-26b-a4b",
      loaded_context_length: 64000,
      max_context_length: 262144,
    },
  });

  assert.equal(metadata.contextLength, 64000);
  assert.equal(metadata.source, "lmstudio-api");
  assert.equal(metadata.rawField, "loaded_context_length");
  assert.equal(metadata.confidence, "verified");
});

test("max_context_length alone uses api source (not lmstudio-api)", async () => {
  clearModelContextMetadataCache();
  const metadata = await resolveModelContextLength({
    providerId: "local",
    modelId: "test-model",
    rawMetadata: {
      id: "test-model",
      max_context_length: 262144,
    },
  });

  assert.equal(metadata.contextLength, 262144);
  assert.equal(metadata.source, "api");
  assert.equal(metadata.rawField, "max_context_length");
});

test("full LM Studio fixture uses loaded_context_length with lmstudio-api source", async () => {
  clearModelContextMetadataCache();
  const fixture = {
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
  const metadata = await resolveModelContextLength({
    providerId: "local",
    modelId: "google/gemma-4-26b-a4b",
    rawMetadata: fixture,
  });

  assert.equal(metadata.contextLength, 64000);
  assert.equal(metadata.source, "lmstudio-api");
  assert.equal(metadata.rawField, "loaded_context_length");
});

// ─── formatContextMeter ───────────────────────────────────────────────────────

test("formatContextMeter(0, 64000) returns '0 / 64,000 · 0%'", () => {
  assert.equal(formatContextMeter(0, 64000), "0 / 64,000 · 0%");
});

test("formatContextMeter(640, 64000) returns '640 / 64,000 · 1%'", () => {
  assert.equal(formatContextMeter(640, 64000), "640 / 64,000 · 1%");
});

test("formatContextMeter(32000, 64000) returns '32,000 / 64,000 · 50%'", () => {
  assert.equal(formatContextMeter(32000, 64000), "32,000 / 64,000 · 50%");
});

test("formatContextMeter(null, 64000) treats null as 0 and returns '0 / 64,000 · 0%'", () => {
  assert.equal(formatContextMeter(null, 64000), "0 / 64,000 · 0%");
});

test("formatContextMeter(undefined, 64000) treats undefined as 0 and returns '0 / 64,000 · 0%'", () => {
  assert.equal(formatContextMeter(undefined, 64000), "0 / 64,000 · 0%");
});

test("formatContextMeter(0, null) returns 'Unknown'", () => {
  assert.equal(formatContextMeter(0, null), "Unknown");
});

test("formatContextMeter(32000, null) returns 'Unknown'", () => {
  assert.equal(formatContextMeter(32000, null), "Unknown");
});

// ─── Nested raw.loaded_context_length lookup ─────────────────────────────────

test("context is resolved from nested raw.loaded_context_length when ProviderModel is passed as rawMetadata", async () => {
  clearModelContextMetadataCache();
  // app.tsx passes the whole ProviderModel as rawMetadata (via currentModelCapability.raw).
  // providerModelsToCodexCapabilities sets raw: model (the ProviderModel), not model.raw.
  // The nested "raw" key scan must reach loaded_context_length inside ProviderModel.raw.
  const providerModelShaped = {
    id: "google/gemma-4-26b-a4b",
    modelId: "google/gemma-4-26b-a4b",
    label: "google/gemma-4-26b-a4b",
    source: "discovered",
    raw: {
      id: "google/gemma-4-26b-a4b",
      loaded_context_length: 64000,
      max_context_length: 262144,
      capabilities: ["tool_use"],
    },
  };
  const metadata = await resolveModelContextLength({
    providerId: "local",
    modelId: "google/gemma-4-26b-a4b",
    rawMetadata: providerModelShaped,
  });

  assert.equal(metadata.contextLength, 64000, "should resolve loaded_context_length from nested raw field");
  assert.equal(metadata.source, "lmstudio-api", "nested loaded_context_length should use lmstudio-api source");
});
