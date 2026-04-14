import assert from "node:assert/strict";
import test from "node:test";
import { mergeRuntimeIntoTomlConfig } from "./layeredConfig.js";
import { DEFAULT_RUNTIME_CONFIG } from "./runtimeConfig.js";
import {
  extractLegacyRuntime,
  getDefaultSettings,
  parseSettingsData,
  serializeSettings,
} from "./persistence.js";

test("extracts legacy flat runtime settings for migration", () => {
  const runtime = extractLegacyRuntime({
    backend: "codex-subprocess",
    model: "gpt-5.4-mini",
    mode: "suggest",
    reasoning_level: "medium",
  });

  assert.equal(runtime?.model, "gpt-5.4-mini");
  assert.equal(runtime?.mode, "suggest");
  assert.equal(runtime?.reasoningLevel, "medium");
});

test("keeps UI and auth settings separate from runtime persistence", () => {
  const initial = {
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

  assert.equal("runtime" in serialized, false);
  assert.equal(parsed.ui.theme, "purple");
  assert.equal(parsed.auth.preference, "runner-managed");
});

test("falls back to defaults for missing UI or auth preferences", () => {
  const parsed = parseSettingsData({});
  const defaults = getDefaultSettings();

  assert.equal(parsed.ui.layoutStyle, defaults.ui.layoutStyle);
  assert.equal(parsed.ui.theme, defaults.ui.theme);
  assert.equal(parsed.auth.preference, defaults.auth.preference);
});

test("merges legacy runtime fields into TOML without overwriting existing values", () => {
  const merged = mergeRuntimeIntoTomlConfig({
    model: "gpt-5.4",
    codexa: {
      mode: "suggest",
    },
  }, {
    ...DEFAULT_RUNTIME_CONFIG,
    model: "gpt-5.4-mini",
    mode: "full-auto",
    policy: {
      ...DEFAULT_RUNTIME_CONFIG.policy,
      networkAccess: "enabled",
      writableRoots: ["C:\\safe"],
      personality: "pragmatic",
    },
  });

  assert.equal(merged.model, "gpt-5.4");
  assert.deepEqual(merged.codexa, { mode: "suggest" });
  assert.deepEqual(merged.sandbox_workspace_write, {
    network_access: true,
    writable_roots: ["C:\\safe"],
  });
  assert.equal(merged.personality, "pragmatic");
});
