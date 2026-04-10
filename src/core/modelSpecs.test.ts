import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  areModelSpecsEqual,
  createLoadingModelSpec,
  createModelSpecService,
  createUnknownModelSpec,
  extractModelSpecFromDocText,
  loadModelSpecCache,
  MODEL_SPEC_DOC_URLS,
  parseTokenCount,
  saveModelSpecCache,
  stripHtmlToText,
  type ModelSpec,
} from "./modelSpecs.js";

test("parses token counts with commas and suffixes", () => {
  assert.equal(parseTokenCount("1,050,000"), 1_050_000);
  assert.equal(parseTokenCount("128,000"), 128_000);
  assert.equal(parseTokenCount("1.05M"), 1_050_000);
  assert.equal(parseTokenCount("400k"), 400_000);
  assert.equal(parseTokenCount("nope"), null);
});

test("extracts verified model specs from official-doc-like text", () => {
  const spec = extractModelSpecFromDocText(
    "gpt-5.4",
    "GPT-5.4 1,050,000 context window 128,000 max output tokens",
    123,
  );

  assert.deepEqual(spec, {
    status: "verified",
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    sourceUrl: MODEL_SPEC_DOC_URLS["gpt-5.4"],
    verifiedAt: 123,
  });
});

test("returns null for ambiguous or incomplete model spec text", () => {
  assert.equal(
    extractModelSpecFromDocText("gpt-5.4-mini", "GPT-5.4 mini supports coding and agents.", 123),
    null,
  );
  assert.equal(
    extractModelSpecFromDocText("gpt-5.4-mini", "400,000 context window but no output limit", 123),
    null,
  );
});

test("strips HTML before parsing model specs", () => {
  const html = `
    <html>
      <body>
        <h1>GPT-5.3-Codex</h1>
        <div>400,000 <strong>context window</strong></div>
        <div>128,000 <em>max output tokens</em></div>
      </body>
    </html>
  `;
  const text = stripHtmlToText(html);
  assert.match(text, /400,000 context window/i);
  assert.match(text, /128,000 max output tokens/i);
});

test("cache round-trip preserves verified values", () => {
  const dir = mkdtempSync(join(tmpdir(), "codexa-model-specs-"));
  const cacheFile = join(dir, "model-specs.json");

  try {
    const cache = {
      "gpt-5.2": {
        status: "verified" as const,
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
        sourceUrl: MODEL_SPEC_DOC_URLS["gpt-5.2"],
        verifiedAt: 456,
      },
    };
    saveModelSpecCache(cache, cacheFile);

    const loaded = loadModelSpecCache(cacheFile);
    assert.deepEqual(loaded, cache);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("background refresh updates specs and dedupes concurrent requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codexa-model-specs-"));
  const cacheFile = join(dir, "model-specs.json");
  let fetchCalls = 0;
  const service = createModelSpecService({
    cacheFile,
    now: () => 789,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response("400,000 context window 128,000 max output tokens", { status: 200 });
    },
  });

  try {
    const [left, right] = await Promise.all([
      service.refreshSpec("gpt-5.2"),
      service.refreshSpec("gpt-5.2"),
    ]);

    assert.equal(fetchCalls, 1);
    assert.equal(left.status, "verified");
    assert.equal(right.status, "verified");
    assert.equal(left.contextWindow, 400_000);
    assert.equal(left.maxOutputTokens, 128_000);

    const persisted = JSON.parse(readFileSync(cacheFile, "utf-8")) as Record<string, ModelSpec>;
    assert.equal(persisted["gpt-5.2"]?.verifiedAt, 789);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refresh returns unknown when a fetch fails even if cache exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codexa-model-specs-"));
  const cacheFile = join(dir, "model-specs.json");
  saveModelSpecCache({
    "gpt-5.3-codex": {
      status: "verified",
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      sourceUrl: MODEL_SPEC_DOC_URLS["gpt-5.3-codex"],
      verifiedAt: 123,
    },
  }, cacheFile);

  const service = createModelSpecService({
    cacheFile,
    fetchImpl: async () => new Response("broken page", { status: 200 }),
  });

  try {
    const spec = await service.refreshSpec("gpt-5.3-codex");
    assert.equal(spec.status, "unknown");
    assert.equal(spec.contextWindow, null);
    assert.equal(spec.maxOutputTokens, null);
    assert.equal(spec.error, "Unable to parse model spec for gpt-5.3-codex");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refresh returns unknown when there is no cache and verification fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codexa-model-specs-"));
  const cacheFile = join(dir, "model-specs.json");
  const service = createModelSpecService({
    cacheFile,
    fetchImpl: async () => new Response("no token limits here", { status: 200 }),
  });

  try {
    const spec = await service.refreshSpec("gpt-5.2");
    assert.deepEqual(spec, createUnknownModelSpec("gpt-5.2", "Unable to parse model spec for gpt-5.2"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reports equality across verified and unknown specs", () => {
  assert.equal(
    areModelSpecsEqual(
      createLoadingModelSpec("gpt-5.4"),
      createLoadingModelSpec("gpt-5.4"),
    ),
    true,
  );
  assert.equal(
    areModelSpecsEqual(
      createUnknownModelSpec("gpt-5.4", "a"),
      createUnknownModelSpec("gpt-5.4", "b"),
    ),
    false,
  );
});
