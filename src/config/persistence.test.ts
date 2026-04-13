import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RUNTIME_CONFIG } from "./runtimeConfig.js";
import { getDefaultSettings, parseSettingsData, serializeSettings } from "./persistence.js";

test("loads legacy flat settings into the nested runtime structure", () => {
  const parsed = parseSettingsData({
    backend: "codex-subprocess",
    model: "gpt-5.4-mini",
    mode: "suggest",
    reasoning_level: "medium",
    layout_style: "gemini-shell",
    theme: "mono",
    auth_preference: "api-key-first",
  });

  assert.equal(parsed.runtime.model, "gpt-5.4-mini");
  assert.equal(parsed.runtime.mode, "suggest");
  assert.equal(parsed.runtime.reasoningLevel, "medium");
  assert.equal(parsed.ui.theme, "mono");
  assert.equal(parsed.auth.preference, "api-key-first");
});

test("round-trips the nested settings structure", () => {
  const initial = {
    runtime: {
      ...DEFAULT_RUNTIME_CONFIG,
      policy: {
        ...DEFAULT_RUNTIME_CONFIG.policy,
        serviceTier: "fast" as const,
        personality: "pragmatic" as const,
        writableRoots: ["C:/Repo/extra"],
      },
    },
    ui: {
      layoutStyle: "gemini-shell",
      theme: "purple",
      customTheme: { TEXT: "#fff" },
    },
    auth: {
      preference: "runner-managed" as const,
    },
  };

  const serialized = serializeSettings(initial);
  const parsed = parseSettingsData(serialized);

  assert.deepEqual(parsed.runtime, initial.runtime);
  assert.equal(parsed.ui.theme, "purple");
  assert.equal(parsed.auth.preference, "runner-managed");
});

test("falls back to defaults for invalid runtime values", () => {
  const parsed = parseSettingsData({
    runtime: {
      provider: "unknown",
      model: "broken-model",
      mode: "chaos",
      reasoningLevel: "max",
      policy: {
        approvalPolicy: "maybe",
        sandboxMode: "world-write",
        networkAccess: "sometimes",
        writableRoots: [123, "", "C:/safe"],
        serviceTier: "turbo",
        personality: "robot",
      },
    },
  });

  const defaults = getDefaultSettings();
  assert.equal(parsed.runtime.provider, defaults.runtime.provider);
  assert.equal(parsed.runtime.model, defaults.runtime.model);
  assert.equal(parsed.runtime.mode, defaults.runtime.mode);
  assert.equal(parsed.runtime.reasoningLevel, defaults.runtime.reasoningLevel);
  assert.equal(parsed.runtime.policy.approvalPolicy, defaults.runtime.policy.approvalPolicy);
  assert.equal(parsed.runtime.policy.sandboxMode, defaults.runtime.policy.sandboxMode);
  assert.equal(parsed.runtime.policy.networkAccess, defaults.runtime.policy.networkAccess);
  assert.equal(parsed.runtime.policy.serviceTier, defaults.runtime.policy.serviceTier);
  assert.equal(parsed.runtime.policy.personality, defaults.runtime.policy.personality);
  assert.deepEqual(parsed.runtime.policy.writableRoots, ["C:\\safe"]);
});
