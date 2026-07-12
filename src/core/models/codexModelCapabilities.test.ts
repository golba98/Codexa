import assert from "node:assert/strict";
import test from "node:test";
import {
  clearCodexModelCapabilityCache,
  createFallbackModelCapabilities,
  findModelCapability,
  formatModelCapabilitiesList,
  getCodexModelCapabilities,
  getPreferredModelFromCapabilities,
  normalizeCodexModelListResponses,
  normalizeReasoningForModelCapabilities,
  type CodexModelCapabilities,
} from "./codexModelCapabilities.js";

const SAMPLE_RESPONSE = {
  data: [
    {
      id: "gpt-5.4",
      model: "gpt-5.4",
      displayName: "gpt-5.4",
      description: "Frontier model",
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast" },
        { reasoningEffort: "medium", description: "Balanced" },
        { reasoningEffort: "high", description: "Deep" },
        { reasoningEffort: "xhigh", description: "Deepest" },
      ],
    },
    {
      id: "gpt-5.1-codex-mini",
      model: "gpt-5.1-codex-mini",
      displayName: "Codex Mini",
      description: "Small model",
      hidden: false,
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        { reasoningEffort: "medium", description: "Dynamic" },
        { reasoningEffort: "high", description: "Deep" },
      ],
    },
  ],
  nextCursor: null,
};

test("normalizes model/list responses with per-model reasoning metadata", () => {
  const capabilities = normalizeCodexModelListResponses([SAMPLE_RESPONSE], {
    discoveredAt: 123,
    executable: "codex.cmd",
  });

  assert.equal(capabilities.status, "ready");
  assert.equal(capabilities.source, "runtime");
  assert.equal(capabilities.executable, "codex.cmd");
  assert.equal(capabilities.models.length, 2);
  assert.equal(capabilities.models[0]?.model, "gpt-5.4");
  assert.equal(capabilities.models[0]?.reasoningLevelCount, 4);
  assert.deepEqual(capabilities.models[0]?.supportedReasoningLevels?.map((item) => item.id), [
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.equal(capabilities.models[1]?.label, "Codex Mini");
  assert.equal(capabilities.models[1]?.reasoningLevelCount, 2);
});

test("normalization rejects empty or malformed discovery output", () => {
  assert.throws(
    () => normalizeCodexModelListResponses([{ data: [] }]),
    /no usable models/i,
  );
  assert.throws(
    () => normalizeCodexModelListResponses([{ data: [{ id: "", model: "" }] }]),
    /no usable models/i,
  );
});

test("fallback keeps models but does not invent reasoning support", () => {
  const capabilities = createFallbackModelCapabilities(new Error("offline"), {
    discoveredAt: 456,
    executable: "codex.cmd",
  });

  assert.equal(capabilities.status, "fallback");
  assert.equal(capabilities.error, "offline");
  assert.ok(capabilities.models.length > 0);
  assert.equal(capabilities.models[0]?.available, false);
  assert.equal(capabilities.models[0]?.supportedReasoningLevels, null);
  assert.equal(capabilities.models[0]?.reasoningLevelCount, null);
});

test("normalizes reasoning by keeping valid values and clamping invalid ones", () => {
  const capabilities = normalizeCodexModelListResponses([SAMPLE_RESPONSE]);

  assert.equal(
    normalizeReasoningForModelCapabilities("gpt-5.4", "high", capabilities),
    "high",
  );
  assert.equal(
    normalizeReasoningForModelCapabilities("gpt-5.1-codex-mini", "xhigh", capabilities),
    "medium",
  );
});

test("handles unavailable selected model with runtime default", () => {
  const capabilities = normalizeCodexModelListResponses([SAMPLE_RESPONSE]);

  assert.equal(getPreferredModelFromCapabilities(capabilities, "missing-model"), "gpt-5.4");
  assert.equal(findModelCapability(capabilities, "Codex Mini"), null);
  assert.equal(findModelCapability(capabilities, "gpt-5.1-codex-mini")?.model, "gpt-5.1-codex-mini");
});

test("formats model list with dynamic reasoning counts", () => {
  const capabilities = normalizeCodexModelListResponses([SAMPLE_RESPONSE]);
  const message = formatModelCapabilitiesList(capabilities, "gpt-5.1-codex-mini");

  assert.match(message, /Detected from Codex runtime/i);
  assert.match(message, /gpt-5\.4.*4 reasoning levels/i);
  assert.match(message, /gpt-5\.1-codex-mini.*2 reasoning levels.*\*/i);
});

test("caches successful discovery and refreshes when forced", async () => {
  clearCodexModelCapabilityCache();
  let calls = 0;

  const discover = async () => {
    calls += 1;
    return normalizeCodexModelListResponses([
      {
        data: [
          {
            id: `model-${calls}`,
            model: `model-${calls}`,
            displayName: `Model ${calls}`,
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Default" }],
          },
        ],
      },
    ], { discoveredAt: calls, executable: "codex" });
  };

  const first = await getCodexModelCapabilities({
    executable: "codex",
    discover,
    persist: () => {},
    now: () => 100,
    ttlMs: 1000,
  });
  const cached = await getCodexModelCapabilities({
    executable: "codex",
    discover,
    persist: () => {},
    now: () => 200,
    ttlMs: 1000,
  });
  const refreshed = await getCodexModelCapabilities({
    executable: "codex",
    discover,
    persist: () => {},
    forceRefresh: true,
    now: () => 300,
    ttlMs: 1000,
  });

  assert.equal(calls, 2);
  assert.equal(first.models[0]?.model, "model-1");
  assert.equal(cached.models[0]?.model, "model-1");
  assert.equal(refreshed.models[0]?.model, "model-2");
  clearCodexModelCapabilityCache();
});

test("concurrent callers share a single in-flight discovery promise", async () => {
  clearCodexModelCapabilityCache();
  let calls = 0;
  let resolveDiscover: (value: unknown) => void = () => {};
  const gate = new Promise<unknown>((resolve) => {
    resolveDiscover = resolve;
  });

  const discover = async () => {
    calls += 1;
    await gate;
    return normalizeCodexModelListResponses([
      {
        data: [
          {
            id: "model-a",
            model: "model-a",
            displayName: "Model A",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Default" }],
          },
        ],
      },
    ], { discoveredAt: 1, executable: "codex" });
  };

  const firstPromise = getCodexModelCapabilities({
    executable: "codex",
    discover,
    persist: () => {},
    now: () => 100,
    ttlMs: 1000,
  });
  const secondPromise = getCodexModelCapabilities({
    executable: "codex",
    discover,
    persist: () => {},
    now: () => 100,
    ttlMs: 1000,
  });
  const thirdPromise = getCodexModelCapabilities({
    executable: "codex",
    discover,
    persist: () => {},
    now: () => 100,
    ttlMs: 1000,
  });

  resolveDiscover(undefined);
  const [first, second, third] = await Promise.all([firstPromise, secondPromise, thirdPromise]);

  assert.equal(calls, 1, "discovery should run exactly once when called concurrently");
  assert.equal(first.models[0]?.model, "model-a");
  assert.equal(second.models[0]?.model, "model-a");
  assert.equal(third.models[0]?.model, "model-a");
  clearCodexModelCapabilityCache();
});

test("falls back safely when discovery fails", async () => {
  clearCodexModelCapabilityCache();
  const capabilities = await getCodexModelCapabilities({
    executable: "codex",
    discover: async () => {
      throw new Error("broken json");
    },
    seed: () => null,
    persist: () => {},
    now: () => 100,
  });

  assert.equal(capabilities.status, "fallback");
  assert.match(capabilities.error ?? "", /broken json/);
  assert.equal(capabilities.models[0]?.supportedReasoningLevels, null);
  clearCodexModelCapabilityCache();
});

test("failed discovery returns seeded capabilities and stays retryable", async () => {
  clearCodexModelCapabilityCache();
  const seeded = {
    status: "ready" as const,
    source: "runtime" as const,
    models: [
      {
        id: "gpt-5.6-sol",
        model: "gpt-5.6-sol",
        label: "GPT-5.6-Sol",
        description: null,
        available: true,
        hidden: false,
        isDefault: true,
        defaultReasoningLevel: "medium",
        supportedReasoningLevels: [{ id: "low", label: "Low", description: null }],
        reasoningLevelCount: 1,
        source: "runtime" as const,
        raw: null,
      },
    ],
    discoveredAt: 50,
    executable: null,
    error: null,
  };

  const fromSeed = await getCodexModelCapabilities({
    executable: "codex",
    discover: async () => {
      throw new Error("app-server unavailable");
    },
    seed: () => seeded,
    persist: () => {},
    now: () => 100,
    ttlMs: 1000,
  });
  assert.equal(fromSeed.status, "ready");
  assert.equal(fromSeed.models[0]?.model, "gpt-5.6-sol");

  // The seeded result must not occupy the TTL cache: a later call retries live
  // discovery instead of serving the seed for the whole TTL window.
  let retried = false;
  const afterRetry = await getCodexModelCapabilities({
    executable: "codex",
    discover: async () => {
      retried = true;
      return normalizeCodexModelListResponses([
        { data: [{ id: "model-live", model: "model-live", displayName: "Live" }] },
      ], { discoveredAt: 2, executable: "codex" });
    },
    seed: () => seeded,
    persist: () => {},
    now: () => 100,
    ttlMs: 1000,
  });
  assert.equal(retried, true, "seeded fulfillment must not suppress the retry");
  assert.equal(afterRetry.models[0]?.model, "model-live");
  clearCodexModelCapabilityCache();
});

test("successful discovery is persisted for the next launch", async () => {
  clearCodexModelCapabilityCache();
  const persisted: CodexModelCapabilities[] = [];
  const result = await getCodexModelCapabilities({
    executable: "codex",
    discover: async () => normalizeCodexModelListResponses([
      { data: [{ id: "model-p", model: "model-p", displayName: "Persist Me" }] },
    ], { discoveredAt: 7, executable: "codex" }),
    seed: () => null,
    persist: (capabilities) => {
      persisted.push(capabilities);
    },
    now: () => 100,
  });
  assert.equal(result.status, "ready");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.models[0]?.model, "model-p");
  clearCodexModelCapabilityCache();
});
