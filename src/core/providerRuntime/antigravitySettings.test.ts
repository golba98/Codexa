import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  SUPPORTED_ANTIGRAVITY_MODELS,
  overrideAntigravitySettingsPathForTests,
  readCurrentAntigravityModel,
  resetAntigravitySettingsStateForTests,
  writeAntigravityModel,
} from "./antigravitySettings.js";

function makeTmpSettingsPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "agy-settings-test-"));
  return join(dir, "settings.json");
}

test("SUPPORTED_ANTIGRAVITY_MODELS has exactly 7 entries", () => {
  assert.equal(SUPPORTED_ANTIGRAVITY_MODELS.length, 7);
});

test("SUPPORTED_ANTIGRAVITY_MODELS all have unique settingsStrings", () => {
  const strings = SUPPORTED_ANTIGRAVITY_MODELS.map((m) => m.settingsString);
  assert.equal(new Set(strings).size, 7);
});

test("readCurrentAntigravityModel returns null when file does not exist", () => {
  const settingsPath = join(mkdtempSync(join(tmpdir(), "agy-read-test-")), "settings.json");
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    assert.equal(readCurrentAntigravityModel(), null);
  } finally {
    resetAntigravitySettingsStateForTests();
  }
});

test("readCurrentAntigravityModel returns model string from settings file", () => {
  const settingsPath = makeTmpSettingsPath();
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    writeFileSync(settingsPath, JSON.stringify({ colorScheme: "dark", model: "Gemini 3.5 Flash (High)" }), "utf-8");
    assert.equal(readCurrentAntigravityModel(), "Gemini 3.5 Flash (High)");
  } finally {
    resetAntigravitySettingsStateForTests();
  }
});

test("readCurrentAntigravityModel returns null when JSON is malformed", () => {
  const settingsPath = makeTmpSettingsPath();
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    writeFileSync(settingsPath, "not valid json", "utf-8");
    assert.equal(readCurrentAntigravityModel(), null);
  } finally {
    resetAntigravitySettingsStateForTests();
  }
});

test("readCurrentAntigravityModel returns null when model key is missing", () => {
  const settingsPath = makeTmpSettingsPath();
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    writeFileSync(settingsPath, JSON.stringify({ colorScheme: "dark" }), "utf-8");
    assert.equal(readCurrentAntigravityModel(), null);
  } finally {
    resetAntigravitySettingsStateForTests();
  }
});

test("writeAntigravityModel throws for unsupported model string", () => {
  const settingsPath = makeTmpSettingsPath();
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    assert.throws(
      () => writeAntigravityModel("Totally Fake Model (Ultra)"),
      /Unsupported Antigravity model/,
    );
  } finally {
    resetAntigravitySettingsStateForTests();
  }
});

test("writeAntigravityModel writes the model key to settings file", () => {
  const settingsPath = makeTmpSettingsPath();
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    writeAntigravityModel("Gemini 3.5 Flash (High)");
    const saved = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    assert.equal(saved.model, "Gemini 3.5 Flash (High)");
  } finally {
    resetAntigravitySettingsStateForTests();
  }
});

test("writeAntigravityModel preserves other keys in existing settings", () => {
  const settingsPath = makeTmpSettingsPath();
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    writeFileSync(settingsPath, JSON.stringify({ colorScheme: "dark", trustedWorkspaces: ["/home/user/proj"], model: "old" }), "utf-8");
    writeAntigravityModel("Gemini 3.1 Pro (High)");
    const saved = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    assert.equal(saved.model, "Gemini 3.1 Pro (High)");
    assert.equal(saved.colorScheme, "dark");
    assert.deepEqual(saved.trustedWorkspaces, ["/home/user/proj"]);
  } finally {
    resetAntigravitySettingsStateForTests();
  }
});

test("writeAntigravityModel creates backup before first write", () => {
  const settingsPath = makeTmpSettingsPath();
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    writeFileSync(settingsPath, JSON.stringify({ model: "original" }), "utf-8");
    writeAntigravityModel("Gemini 3.5 Flash (Medium)");
    assert.ok(existsSync(`${settingsPath}.bak`), "backup file should exist");
    const bak = JSON.parse(readFileSync(`${settingsPath}.bak`, "utf-8")) as Record<string, unknown>;
    assert.equal(bak.model, "original");
  } finally {
    resetAntigravitySettingsStateForTests();
  }
});

test("writeAntigravityModel does not create backup on second write", () => {
  const settingsPath = makeTmpSettingsPath();
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    writeFileSync(settingsPath, JSON.stringify({ model: "original" }), "utf-8");
    writeAntigravityModel("Gemini 3.5 Flash (High)");
    // Overwrite backup with sentinel to detect if it gets overwritten again
    writeFileSync(`${settingsPath}.bak`, JSON.stringify({ model: "sentinel" }), "utf-8");
    writeAntigravityModel("Gemini 3.1 Pro (Low)");
    const bak = JSON.parse(readFileSync(`${settingsPath}.bak`, "utf-8")) as Record<string, unknown>;
    assert.equal(bak.model, "sentinel", "backup should not be overwritten on second write");
  } finally {
    resetAntigravitySettingsStateForTests();
  }
});

test("writeAntigravityModel creates parent directory if missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-mkdir-test-"));
  const settingsPath = join(dir, "subdir", "settings.json");
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    writeAntigravityModel("Claude Sonnet 4.6 (Thinking)");
    assert.ok(existsSync(settingsPath), "settings file should be created");
  } finally {
    resetAntigravitySettingsStateForTests();
  }
});

test("writeAntigravityModel uses atomic write (tmp file is cleaned up)", () => {
  const settingsPath = makeTmpSettingsPath();
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    writeAntigravityModel("GPT-OSS 120B (Medium)");
    assert.ok(!existsSync(`${settingsPath}.tmp`), ".tmp file should not remain after write");
    assert.ok(existsSync(settingsPath), "settings file should exist");
  } finally {
    resetAntigravitySettingsStateForTests();
  }
});

test("all SUPPORTED_ANTIGRAVITY_MODELS can be written without error", () => {
  for (const entry of SUPPORTED_ANTIGRAVITY_MODELS) {
    const settingsPath = makeTmpSettingsPath();
    overrideAntigravitySettingsPathForTests(settingsPath);
    try {
      assert.doesNotThrow(() => writeAntigravityModel(entry.settingsString));
      assert.equal(readCurrentAntigravityModel(), entry.settingsString);
    } finally {
      resetAntigravitySettingsStateForTests();
    }
  }
});
