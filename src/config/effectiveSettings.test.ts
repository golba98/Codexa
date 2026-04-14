import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import test from "node:test";
import { saveSettings, type AppSettings } from "./persistence.js";
import {
  formatEffectiveSettingsDebugNotice,
  parseLaunchArgsEnv,
  parseLaunchOverrides,
  resolveEffectiveSettings,
} from "./effectiveSettings.js";

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "codexa-effective-settings-"));
}

function createSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    backend: "codex-subprocess",
    model: "gpt-5.4",
    mode: "full-auto",
    reasoningLevel: "high",
    layoutStyle: "gemini-shell",
    theme: "mono",
    authPreference: "chatgpt-login-goal",
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
    ...overrides,
  };
}

function writeToml(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

test("falls back to persisted settings when no config layers are present", () => {
  const root = createTempRoot();
  try {
    const settingsFile = join(root, ".codexa-settings.json");
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot);
    saveSettings(createSettings({
      model: "gpt-5.2",
      reasoningLevel: "medium",
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
    }), settingsFile);

    const resolved = resolveEffectiveSettings({
      workspaceRoot,
      settingsFile,
      globalConfigPath: join(root, "global.toml"),
      projectConfigPath: join(root, "project.toml"),
      launchArgs: [],
    });

    assert.equal(resolved.effectiveSettings.model, "gpt-5.2");
    assert.equal(resolved.effectiveSettings.reasoningLevel, "medium");
    assert.equal(resolved.effectiveSettings.approvalPolicy, "never");
    assert.equal(resolved.effectiveSettings.sandboxMode, "danger-full-access");
    assert.deepEqual(resolved.debug.loadedLayers, []);
    assert.deepEqual(resolved.debug.warnings, []);
    assert.equal(resolved.debug.fieldSources.model, "persisted");
    assert.equal(resolved.debug.fieldSources.reasoningLevel, "persisted");
    assert.equal(resolved.debug.fieldSources.approvalPolicy, "persisted");
    assert.equal(resolved.debug.fieldSources.sandboxMode, "persisted");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("global config overrides persisted shared execution settings", () => {
  const root = createTempRoot();
  try {
    const settingsFile = join(root, ".codexa-settings.json");
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot);
    saveSettings(createSettings({
      model: "gpt-5.2",
      reasoningLevel: "low",
      approvalPolicy: "untrusted",
      sandboxMode: "read-only",
    }), settingsFile);
    const globalConfigPath = join(root, ".codex", "config.toml");
    writeToml(globalConfigPath, [
      'model = "gpt-5.4-mini"',
      'model_reasoning_effort = "medium"',
      'approval_policy = "on-request"',
      'sandbox_mode = "workspace-write"',
    ].join("\n"));

    const resolved = resolveEffectiveSettings({
      workspaceRoot,
      settingsFile,
      globalConfigPath,
      projectConfigPath: join(root, "project.toml"),
      launchArgs: [],
    });

    assert.equal(resolved.effectiveSettings.model, "gpt-5.4-mini");
    assert.equal(resolved.effectiveSettings.reasoningLevel, "medium");
    assert.equal(resolved.effectiveSettings.approvalPolicy, "on-request");
    assert.equal(resolved.effectiveSettings.sandboxMode, "workspace-write");
    assert.equal(resolved.debug.fieldSources.model, "global-config");
    assert.equal(resolved.debug.fieldSources.reasoningLevel, "global-config");
    assert.equal(resolved.debug.fieldSources.approvalPolicy, "global-config");
    assert.equal(resolved.debug.fieldSources.sandboxMode, "global-config");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project config overrides global config", () => {
  const root = createTempRoot();
  try {
    const settingsFile = join(root, ".codexa-settings.json");
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot);
    saveSettings(createSettings(), settingsFile);
    const globalConfigPath = join(root, ".codex", "config.toml");
    const projectConfigPath = join(workspaceRoot, ".codex", "config.toml");

    writeToml(globalConfigPath, [
      'model = "gpt-5.2"',
      'approval_policy = "untrusted"',
    ].join("\n"));
    writeToml(projectConfigPath, [
      'model = "gpt-5.4-mini"',
      'approval_policy = "never"',
    ].join("\n"));

    const resolved = resolveEffectiveSettings({
      workspaceRoot,
      settingsFile,
      globalConfigPath,
      projectConfigPath,
      launchArgs: [],
    });

    assert.equal(resolved.effectiveSettings.model, "gpt-5.4-mini");
    assert.equal(resolved.effectiveSettings.approvalPolicy, "never");
    assert.equal(resolved.debug.fieldSources.model, "project-config");
    assert.equal(resolved.debug.fieldSources.approvalPolicy, "project-config");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("launch overrides take precedence over config layers", () => {
  const root = createTempRoot();
  try {
    const settingsFile = join(root, ".codexa-settings.json");
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot);
    saveSettings(createSettings(), settingsFile);
    const globalConfigPath = join(root, ".codex", "config.toml");
    const projectConfigPath = join(workspaceRoot, ".codex", "config.toml");

    writeToml(globalConfigPath, [
      'model = "gpt-5.2"',
      'approval_policy = "untrusted"',
    ].join("\n"));
    writeToml(projectConfigPath, [
      'model = "gpt-5.4-mini"',
      'sandbox_mode = "read-only"',
    ].join("\n"));

    const resolved = resolveEffectiveSettings({
      workspaceRoot,
      settingsFile,
      globalConfigPath,
      projectConfigPath,
      launchArgs: ["--model", "gpt-5.4", "--ask-for-approval", "never", "--sandbox", "danger-full-access"],
    });

    assert.equal(resolved.effectiveSettings.model, "gpt-5.4");
    assert.equal(resolved.effectiveSettings.approvalPolicy, "never");
    assert.equal(resolved.effectiveSettings.sandboxMode, "danger-full-access");
    assert.equal(resolved.debug.fieldSources.model, "launch-override");
    assert.equal(resolved.debug.fieldSources.approvalPolicy, "launch-override");
    assert.equal(resolved.debug.fieldSources.sandboxMode, "launch-override");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("merges layered config fields independently", () => {
  const root = createTempRoot();
  try {
    const settingsFile = join(root, ".codexa-settings.json");
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot);
    saveSettings(createSettings(), settingsFile);
    const globalConfigPath = join(root, ".codex", "config.toml");
    const projectConfigPath = join(workspaceRoot, ".codex", "config.toml");

    writeToml(globalConfigPath, [
      'approval_policy = "never"',
      'model_reasoning_effort = "medium"',
    ].join("\n"));
    writeToml(projectConfigPath, 'sandbox_mode = "danger-full-access"');

    const resolved = resolveEffectiveSettings({
      workspaceRoot,
      settingsFile,
      globalConfigPath,
      projectConfigPath,
      launchArgs: [],
    });

    assert.equal(resolved.effectiveSettings.approvalPolicy, "never");
    assert.equal(resolved.effectiveSettings.sandboxMode, "danger-full-access");
    assert.equal(resolved.effectiveSettings.reasoningLevel, "medium");
    assert.equal(resolved.debug.fieldSources.approvalPolicy, "global-config");
    assert.equal(resolved.debug.fieldSources.reasoningLevel, "global-config");
    assert.equal(resolved.debug.fieldSources.sandboxMode, "project-config");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid TOML values fall back and emit warnings", () => {
  const root = createTempRoot();
  try {
    const settingsFile = join(root, ".codexa-settings.json");
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot);
    saveSettings(createSettings(), settingsFile);
    const globalConfigPath = join(root, ".codex", "config.toml");
    writeToml(globalConfigPath, [
      'model = "not-a-model"',
      'approval_policy = "maybe"',
      'sandbox_mode = "wide-open"',
    ].join("\n"));

    const resolved = resolveEffectiveSettings({
      workspaceRoot,
      settingsFile,
      globalConfigPath,
      projectConfigPath: join(root, "project.toml"),
      launchArgs: [],
    });

    assert.equal(resolved.effectiveSettings.model, "gpt-5.4");
    assert.equal(resolved.effectiveSettings.approvalPolicy, "on-request");
    assert.equal(resolved.effectiveSettings.sandboxMode, "workspace-write");
    assert.match(resolved.debug.warnings.join("\n"), /Ignored invalid global-config model "not-a-model"/);
    assert.match(resolved.debug.warnings.join("\n"), /Ignored invalid global-config approval_policy "maybe"/);
    assert.match(resolved.debug.warnings.join("\n"), /Ignored invalid global-config sandbox_mode "wide-open"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parseLaunchOverrides supports flag forms and last value wins", () => {
  const parsed = parseLaunchOverrides([
    "--model", "gpt-5.2",
    "-m", "gpt-5.4-mini",
    "--sandbox=read-only",
    "--sandbox", "danger-full-access",
    "-a", "untrusted",
    "--ask-for-approval=never",
  ]);

  assert.deepEqual(parsed.overrides, {
    model: "gpt-5.4-mini",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
  });
  assert.deepEqual(parsed.warnings, []);
});

test("parseLaunchOverrides supports config keys and warns on unsupported ones", () => {
  const parsed = parseLaunchOverrides([
    "-c", "model=gpt-5.2",
    "--config", "model_reasoning_effort=medium",
    "--config", "approval_policy=never",
    "--config=sandbox_mode=read-only",
    "--config", "service_tier=priority",
  ]);

  assert.deepEqual(parsed.overrides, {
    model: "gpt-5.2",
    reasoningLevel: "medium",
    approvalPolicy: "never",
    sandboxMode: "read-only",
  });
  assert.match(parsed.warnings.join("\n"), /Ignored unsupported launch override key "service_tier"/);
});

test("parseLaunchArgsEnv decodes serialized argv arrays", () => {
  assert.deepEqual(parseLaunchArgsEnv(JSON.stringify(["--model", "gpt-5.4"])), ["--model", "gpt-5.4"]);
  assert.deepEqual(parseLaunchArgsEnv("not-json"), []);
});

test("formats a startup debug notice when config layers are active", () => {
  const notice = formatEffectiveSettingsDebugNotice(
    createSettings({
      model: "gpt-5.4-mini",
      reasoningLevel: "medium",
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
    }),
    {
      loadedLayers: ["global config: C:/Users/test/.codex/config.toml", "launch overrides: --model gpt-5.4-mini"],
      warnings: ["Ignored unsupported launch override key \"service_tier\"."],
      fieldSources: {
        model: "launch-override",
        reasoningLevel: "global-config",
        approvalPolicy: "persisted",
        sandboxMode: "persisted",
      },
    },
  );

  assert.ok(notice);
  assert.match(notice ?? "", /Resolved startup settings:/);
  assert.match(notice ?? "", /launch overrides: --model gpt-5.4-mini/);
  assert.match(notice ?? "", /Ignored unsupported launch override key "service_tier"/);
});
