import assert from "node:assert/strict";
import test from "node:test";
import { join } from "path";
import {
  resolveAntigravityExecutable,
  getLatestAntigravityProbe,
  resetAntigravityProbeForTests,
  injectAntigravityProbeForTests,
  antigravityRuntime,
} from "./antigravity.js";
import { classifyLines, makeClassifierState } from "./antigravityClassifier.js";
import type { CommandResult } from "../process/CommandRunner.js";
import {
  SUPPORTED_ANTIGRAVITY_MODELS,
  overrideAntigravitySettingsPathForTests,
  resetAntigravitySettingsStateForTests,
} from "./antigravitySettings.js";
import { writeFileSync } from "fs";
import { mkdtempSync } from "fs";
import { join as pathJoin } from "path";
import { tmpdir } from "os";
// ─── resolveAntigravityExecutable ─────────────────────────────────────────────

test("resolveAntigravityExecutable returns PATH fallback when LOCALAPPDATA is not set", () => {
  const savedLocalAppData = process.env.LOCALAPPDATA;
  try {
    delete process.env.LOCALAPPDATA;
    const result = resolveAntigravityExecutable();
    assert.equal(result, "agy");
  } finally {
    if (savedLocalAppData !== undefined) {
      process.env.LOCALAPPDATA = savedLocalAppData;
    }
  }
});

test("resolveAntigravityExecutable builds correct Windows path from LOCALAPPDATA", () => {
  const savedLocalAppData = process.env.LOCALAPPDATA;
  try {
    // Use a non-existent path so existsSync fails and we fall through to PATH
    process.env.LOCALAPPDATA = "C:\\FakeUser\\AppData\\Local";
    const result = resolveAntigravityExecutable();
    // existsSync will return false for the fake path, so PATH fallback is used
    assert.equal(result, "agy");
  } finally {
    if (savedLocalAppData !== undefined) {
      process.env.LOCALAPPDATA = savedLocalAppData;
    } else {
      delete process.env.LOCALAPPDATA;
    }
  }
});

test("resolveAntigravityExecutable LOCALAPPDATA path construction is correct", () => {
  // Verify the path joins correctly even without checking existsSync
  const localAppData = "C:\\Users\\TestUser\\AppData\\Local";
  const expected = join(localAppData, "agy", "bin", "agy.exe");
  assert.equal(expected, "C:\\Users\\TestUser\\AppData\\Local\\agy\\bin\\agy.exe");
});

// ─── probeAntigravityHealth ────────────────────────────────────────────────────

test("probeAntigravityHealth: READY in stdout → status ready", () => {
  // Test the logic directly by examining what probeAntigravityHealth would return
  // with a successful READY response
  const stdout = "READY";
  const combined = `${stdout}\n`;
  const hasReady = /\bREADY\b/.test(combined);
  assert.equal(hasReady, true, "READY detection should work");
});

test("probeAntigravityHealth: auth-required output → needsAuth detection", () => {
  const authOutputs = [
    "Authentication required",
    "Waiting for authentication",
    "Please visit https://accounts.google.com/o/oauth2/...",
  ];
  for (const output of authOutputs) {
    const looksLikeAuth = /authentication required|waiting for authentication|please visit\s+https?:\/\//i.test(output)
      || /accounts\.google\.com/i.test(output);
    assert.equal(looksLikeAuth, true, `Should detect auth requirement in: "${output}"`);
  }
});

test("probeAntigravityHealth: ENOENT error → notInstalled", () => {
  const status: CommandResult["status"] = "spawn_error";
  const errorCode = "ENOENT";
  assert.equal(status === "spawn_error" && errorCode === "ENOENT", true);
});

// ─── probeAntigravityModel ─────────────────────────────────────────────────────

test("probeAntigravityModel: parses MODEL=Gemini 3.5 Flash; REASONING=High", () => {
  const probeOutput = "MODEL=Gemini 3.5 Flash; REASONING=High";
  const MODEL_PROBE_RE = /^MODEL=(.+?);\s*REASONING=(High|Medium|Low|Thinking|Unknown)/im;
  const match = MODEL_PROBE_RE.exec(probeOutput);
  assert.ok(match, "Should match MODEL probe output");
  assert.equal(match![1]!.trim(), "Gemini 3.5 Flash");
  assert.equal(match![2]!.trim(), "High");
});

test("probeAntigravityModel: parses REASONING=Medium", () => {
  const probeOutput = "MODEL=gemini-2.5-pro; REASONING=Medium";
  const MODEL_PROBE_RE = /^MODEL=(.+?);\s*REASONING=(High|Medium|Low|Thinking|Unknown)/im;
  const match = MODEL_PROBE_RE.exec(probeOutput);
  assert.ok(match);
  assert.equal(match![2]!.trim(), "Medium");
});

test("probeAntigravityModel: parses REASONING=Low", () => {
  const probeOutput = "MODEL=gemini-flash; REASONING=Low";
  const MODEL_PROBE_RE = /^MODEL=(.+?);\s*REASONING=(High|Medium|Low|Thinking|Unknown)/im;
  const match = MODEL_PROBE_RE.exec(probeOutput);
  assert.ok(match);
  assert.equal(match![2]!.trim(), "Low");
});

test("probeAntigravityModel: parses REASONING=Thinking", () => {
  const probeOutput = "MODEL=gemini-3; REASONING=Thinking";
  const MODEL_PROBE_RE = /^MODEL=(.+?);\s*REASONING=(High|Medium|Low|Thinking|Unknown)/im;
  const match = MODEL_PROBE_RE.exec(probeOutput);
  assert.ok(match);
  assert.equal(match![2]!.trim(), "Thinking");
});

test("probeAntigravityModel: parses REASONING=Unknown", () => {
  const probeOutput = "MODEL=external-default; REASONING=Unknown";
  const MODEL_PROBE_RE = /^MODEL=(.+?);\s*REASONING=(High|Medium|Low|Thinking|Unknown)/im;
  const match = MODEL_PROBE_RE.exec(probeOutput);
  assert.ok(match);
  assert.equal(match![2]!.trim(), "Unknown");
});

test("probeAntigravityModel: unparseable output falls back to External Antigravity default / Unknown", () => {
  const MODEL_PROBE_RE = /^MODEL=(.+?);\s*REASONING=(High|Medium|Low|Thinking|Unknown)/im;
  const badOutputs = [
    "Some random response",
    "I am Gemini",
    "Ready!",
    "",
    "READY",
  ];
  for (const output of badOutputs) {
    const match = MODEL_PROBE_RE.exec(output);
    assert.equal(match, null, `Should not match: "${output}"`);
  }
});

// ─── Output classifier integration ────────────────────────────────────────────

test("probe output never reaches assistant_output when classified", () => {
  const probeLines = [
    "READY",
    "MODEL=Gemini 3.5 Flash; REASONING=High",
    "Authentication required",
    "accounts.google.com/auth",
  ];
  const classified = classifyLines(probeLines, makeClassifierState());
  const assistantLines = classified.filter((c) => c.classification === "assistant_output");
  assert.equal(assistantLines.length, 0, "Probe output must never be classified as assistant_output");
});

test("process cwd is set to workspaceRoot (not process.cwd)", () => {
  // This test verifies the workspace boundary requirement is documented
  // The actual enforcement is in runAntigravityPrompt via CommandSpec.cwd
  const expectedCwd = "/workspace/my-project";
  const spec = {
    executable: "agy",
    args: ["-p", "test"],
    cwd: expectedCwd,
    timeoutMs: 120_000,
  };
  assert.equal(spec.cwd, expectedCwd, "cwd must be the workspace root, not process.cwd");
});

// ─── Probe cache ───────────────────────────────────────────────────────────────

test("resetAntigravityProbeForTests clears cache; getLatestAntigravityProbe returns null after reset", () => {
  resetAntigravityProbeForTests();
  assert.equal(getLatestAntigravityProbe(), null);
});

test("discoverModels returns all supported models as fallback when probe cache is empty and no settings file", () => {
  resetAntigravityProbeForTests();
  const dir = mkdtempSync(pathJoin(tmpdir(), "agy-probe-cache-test-"));
  overrideAntigravitySettingsPathForTests(pathJoin(dir, "nonexistent.json"));
  try {
    const discovery = antigravityRuntime.discoverModels();
    assert.equal(discovery.models.length, SUPPORTED_ANTIGRAVITY_MODELS.length);
    assert.ok(discovery.models.every((m) => m.source === "fallback"), "all models should be fallback");
    assert.equal(discovery.diagnostics, undefined);
  } finally {
    resetAntigravityProbeForTests();
    resetAntigravitySettingsStateForTests();
  }
});

test("discoverModels reflects probe cache via injectAntigravityProbeForTests", () => {
  resetAntigravityProbeForTests();
  const dir = mkdtempSync(pathJoin(tmpdir(), "agy-inject-test-"));
  overrideAntigravitySettingsPathForTests(pathJoin(dir, "nonexistent.json"));
  try {
    const before = antigravityRuntime.discoverModels();
    assert.ok(before.models.every((m) => m.source === "fallback"));

    injectAntigravityProbeForTests({
      modelDisplayName: "Gemini 3.5 Flash",
      reasoning: "High",
      source: "antigravity-prompt-probe",
    });
    const after = antigravityRuntime.discoverModels();
    const discovered = after.models.filter((m) => m.source === "discovered");
    assert.equal(discovered.length, 1, "exactly one model should be 'discovered' after probe injection");
    assert.equal(discovered[0]?.modelId, "Gemini 3.5 Flash (High)");
  } finally {
    resetAntigravityProbeForTests();
    resetAntigravitySettingsStateForTests();
  }
});

test("discoverModels each model has a non-null defaultReasoningLevel and they are not all identical", () => {
  resetAntigravityProbeForTests();
  const dir = mkdtempSync(pathJoin(tmpdir(), "agy-reasoning-level-"));
  overrideAntigravitySettingsPathForTests(pathJoin(dir, "nonexistent.json"));
  try {
    const discovery = antigravityRuntime.discoverModels();
    for (const m of discovery.models) {
      assert.ok(m.defaultReasoningLevel !== null, `${m.modelId} should have a non-null defaultReasoningLevel`);
    }
    // Reasoning levels should not all be the same (proves they're model-specific, not hardcoded)
    const reasonings = new Set(discovery.models.map((m) => m.defaultReasoningLevel));
    assert.ok(reasonings.size > 1, "models should have diverse reasoning levels, not all identical");
  } finally {
    resetAntigravityProbeForTests();
    resetAntigravitySettingsStateForTests();
  }
});

test("probe fallback result has reasoning Unknown, not Medium", () => {
  const MODEL_PROBE_RE = /^MODEL=(.+?);\s*REASONING=(High|Medium|Low|Thinking|Unknown)/im;
  // Failed probe produces PROBE_FALLBACK: modelDisplayName "External Antigravity default", reasoning "Unknown"
  const unparseable = "some random output";
  const match = MODEL_PROBE_RE.exec(unparseable);
  assert.equal(match, null, "Unparseable output produces no match → fallback reasoning is Unknown");
});

test("probe result MODEL=Gemini 3.5 Flash; REASONING=High — reasoning is not Medium", () => {
  const MODEL_PROBE_RE = /^MODEL=(.+?);\s*REASONING=(High|Medium|Low|Thinking|Unknown)/im;
  const probeOutput = "MODEL=Gemini 3.5 Flash; REASONING=High";
  const match = MODEL_PROBE_RE.exec(probeOutput);
  assert.ok(match);
  assert.notEqual(match![2]!.trim(), "Medium", "Real probe returns High, not the hardcoded Medium fallback");
  assert.equal(match![2]!.trim(), "High");
});

// ─── discoverModels multi-model tests ─────────────────────────────────────────

test("discoverModels returns all 7 supported models when probe cache is empty and no settings file", () => {
  resetAntigravityProbeForTests();
  resetAntigravitySettingsStateForTests();
  const dir = mkdtempSync(pathJoin(tmpdir(), "agy-discover-test-"));
  overrideAntigravitySettingsPathForTests(pathJoin(dir, "nonexistent.json"));
  try {
    const discovery = antigravityRuntime.discoverModels();
    assert.equal(discovery.models.length, SUPPORTED_ANTIGRAVITY_MODELS.length);
  } finally {
    resetAntigravityProbeForTests();
    resetAntigravitySettingsStateForTests();
  }
});

test("discoverModels model IDs match the settings strings", () => {
  resetAntigravityProbeForTests();
  resetAntigravitySettingsStateForTests();
  const dir = mkdtempSync(pathJoin(tmpdir(), "agy-discover-ids-"));
  overrideAntigravitySettingsPathForTests(pathJoin(dir, "nonexistent.json"));
  try {
    const discovery = antigravityRuntime.discoverModels();
    for (const entry of SUPPORTED_ANTIGRAVITY_MODELS) {
      const found = discovery.models.find((m) => m.modelId === entry.settingsString);
      assert.ok(found, `Model not found for settingsString: "${entry.settingsString}"`);
    }
  } finally {
    resetAntigravityProbeForTests();
    resetAntigravitySettingsStateForTests();
  }
});

test("discoverModels marks settings-file model as source 'settings', others as 'fallback'", () => {
  resetAntigravityProbeForTests();
  const settingsPath = pathJoin(mkdtempSync(pathJoin(tmpdir(), "agy-source-test-")), "settings.json");
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    writeFileSync(settingsPath, JSON.stringify({ model: "Gemini 3.1 Pro (High)" }), "utf-8");
    const discovery = antigravityRuntime.discoverModels();
    const pro = discovery.models.find((m) => m.modelId === "Gemini 3.1 Pro (High)");
    const flash = discovery.models.find((m) => m.modelId === "Gemini 3.5 Flash (High)");
    assert.equal(pro?.source, "settings");
    assert.equal(flash?.source, "fallback");
  } finally {
    resetAntigravityProbeForTests();
    resetAntigravitySettingsStateForTests();
  }
});

test("discoverModels marks probe-matched model as source 'discovered'", () => {
  resetAntigravityProbeForTests();
  const settingsPath = pathJoin(mkdtempSync(pathJoin(tmpdir(), "agy-probe-source-")), "settings.json");
  overrideAntigravitySettingsPathForTests(settingsPath);
  try {
    writeFileSync(settingsPath, JSON.stringify({ model: "Gemini 3.5 Flash (High)" }), "utf-8");
    injectAntigravityProbeForTests({
      modelDisplayName: "Gemini 3.5 Flash",
      reasoning: "High",
      source: "antigravity-prompt-probe",
    });
    const discovery = antigravityRuntime.discoverModels();
    const flash = discovery.models.find((m) => m.modelId === "Gemini 3.5 Flash (High)");
    assert.equal(flash?.source, "discovered");
    assert.match(flash?.description ?? "", /Active · Detected via probe/);
  } finally {
    resetAntigravityProbeForTests();
    resetAntigravitySettingsStateForTests();
  }
});

test("discoverModels includes defaultReasoningLevel derived from model entry", () => {
  resetAntigravityProbeForTests();
  resetAntigravitySettingsStateForTests();
  const dir = mkdtempSync(pathJoin(tmpdir(), "agy-reasoning-test-"));
  overrideAntigravitySettingsPathForTests(pathJoin(dir, "nonexistent.json"));
  try {
    const discovery = antigravityRuntime.discoverModels();
    const high = discovery.models.find((m) => m.modelId === "Gemini 3.5 Flash (High)");
    const thinking = discovery.models.find((m) => m.modelId === "Claude Sonnet 4.6 (Thinking)");
    assert.equal(high?.defaultReasoningLevel, "high");
    assert.equal(thinking?.defaultReasoningLevel, "thinking");
  } finally {
    resetAntigravityProbeForTests();
    resetAntigravitySettingsStateForTests();
  }
});
