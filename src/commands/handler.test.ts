import assert from "node:assert/strict";
import test from "node:test";
import type { LayeredConfigResult } from "../config/layeredConfig.js";
import { normalizeRuntimeConfig, resolveRuntimeConfig } from "../config/runtimeConfig.js";
import { normalizeCodexModelListResponses } from "../core/codexModelCapabilities.js";
import { handleCommand, type CommandContext } from "./handler.js";

const baseRuntime = normalizeRuntimeConfig({
  provider: "codex-subprocess",
  model: "gpt-5.4",
  mode: "suggest",
  reasoningLevel: "high",
});

const baseConfig: LayeredConfigResult = {
  runtime: baseRuntime,
  diagnostics: {
    projectRoot: "C:\\Workspace",
    projectTrusted: false,
    selectedProfile: null,
    selectedProfileSource: null,
    cliOverrides: [],
    layers: [
      { label: "Built-in defaults", status: "loaded" as const },
      { label: "User config", status: "missing" as const, path: "C:\\Users\\Test\\.codex\\config.toml" },
    ],
    ignoredEntries: [],
    fieldSources: {
      provider: "Built-in defaults",
      model: "Built-in defaults",
      reasoningLevel: "Built-in defaults",
      mode: "Built-in defaults",
      planMode: "Built-in defaults",
      "policy.approvalPolicy": "Built-in defaults",
      "policy.sandboxMode": "Built-in defaults",
      "policy.networkAccess": "Built-in defaults",
      "policy.writableRoots": "Built-in defaults",
      "policy.serviceTier": "Built-in defaults",
      "policy.personality": "Built-in defaults",
    },
  },
};

const baseContext: CommandContext = {
  config: baseConfig,
  runtime: baseRuntime,
  resolvedRuntime: resolveRuntimeConfig(baseRuntime),
  settings: {
    directoryDisplayMode: "normal",
  },
  workspace: {
    root: "C:\\Workspace",
    summaryMessage: [
      "Active workspace:",
      "  C:\\Workspace",
      "",
      "Launch mode: installed codexa",
    ].join("\n"),
  },
  tokensUsed: 1200,
};

function runCommand(command: string, context: Partial<CommandContext> = {}) {
  return handleCommand(command, {
    ...baseContext,
    ...context,
  });
}

const dynamicCapabilities = normalizeCodexModelListResponses([
  {
    data: [
      {
        id: "dynamic-four",
        model: "dynamic-four",
        displayName: "Dynamic Four",
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Low" },
          { reasoningEffort: "medium", description: "Medium" },
          { reasoningEffort: "high", description: "High" },
          { reasoningEffort: "xhigh", description: "Extra" },
        ],
      },
      {
        id: "dynamic-two",
        model: "dynamic-two",
        displayName: "Dynamic Two",
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "Medium" },
          { reasoningEffort: "high", description: "High" },
        ],
      },
    ],
  },
]);

test("parses /login command", () => {
  const result = runCommand("/login");
  assert.equal(result?.action, "login");
});

test("parses /logout command", () => {
  const result = runCommand("/logout");
  assert.equal(result?.action, "logout");
});

test("parses /auth status as auth_status action", () => {
  const result = runCommand("/auth status");
  assert.equal(result?.action, "auth_status");
});

test("keeps existing /model command behavior", () => {
  const result = runCommand("/model gpt-5.4-mini");
  assert.equal(result?.action, "model");
  assert.equal(result?.value, "gpt-5.4-mini");
});

test("accepts dynamically detected model ids", () => {
  const result = runCommand("/model dynamic-two", {
    modelCapabilities: dynamicCapabilities,
  });

  assert.equal(result?.action, "model");
  assert.equal(result?.value, "dynamic-two");
});

test("resolves canonical and aliased /mode commands", () => {
  const cases = [
    ["/mode suggest", "suggest"],
    ["/mode auto-edit", "auto-edit"],
    ["/mode full-auto", "full-auto"],
    ["/mode default", "full-auto"],
    ["/mode ask", "suggest"],
    ["/mode auto", "auto-edit"],
    ["/mode plan", "suggest"],
  ] as const;

  for (const [command, expectedValue] of cases) {
    const result = runCommand(command);
    assert.equal(result?.action, "mode", command);
    assert.equal(result?.value, expectedValue, command);
  }
});

test("opens the reasoning picker when /reasoning has no argument", () => {
  const result = runCommand("/reasoning");
  assert.equal(result?.action, "open_reasoning_picker");
});

test("accepts explicit reasoning levels", () => {
  const result = runCommand("/reasoning medium");
  assert.equal(result?.action, "reasoning");
  assert.equal(result?.value, "medium");
});

test("accepts extra high reasoning aliases", () => {
  const result = runCommand("/reasoning extra high");
  assert.equal(result?.action, "reasoning");
  assert.equal(result?.value, "xhigh");
});

test("validates reasoning against detected levels for the active model", () => {
  const runtime = normalizeRuntimeConfig({
    model: "dynamic-two",
    reasoningLevel: "medium",
  });

  const accepted = runCommand("/reasoning high", {
    runtime,
    resolvedRuntime: resolveRuntimeConfig(runtime),
    modelCapabilities: dynamicCapabilities,
  });
  assert.equal(accepted?.action, "reasoning");
  assert.equal(accepted?.value, "high");

  const rejected = runCommand("/reasoning xhigh", {
    runtime,
    resolvedRuntime: resolveRuntimeConfig(runtime),
    modelCapabilities: dynamicCapabilities,
  });
  assert.equal(rejected?.action, "unknown");
  assert.match(rejected?.message ?? "", /Valid: medium, high/i);
});

test("shows and toggles plan mode", () => {
  const statusResult = runCommand("/plan");
  assert.equal(statusResult?.action, "plan_mode");
  assert.equal(statusResult?.message, "Plan mode: Disabled.");

  const explicitStatusResult = runCommand("/plan status", {
    runtime: normalizeRuntimeConfig({ planMode: true }),
  });
  assert.equal(explicitStatusResult?.action, "plan_mode");
  assert.equal(explicitStatusResult?.message, "Plan mode: Enabled.");

  const enableResult = runCommand("/plan on");
  assert.equal(enableResult?.action, "plan_mode");
  assert.equal(enableResult?.value, "on");

  const disableResult = runCommand("/plan off");
  assert.equal(disableResult?.action, "plan_mode");
  assert.equal(disableResult?.value, "off");
});

test("rejects invalid /plan usage with a short hint", () => {
  const result = runCommand("/plan maybe");
  assert.equal(result?.action, "unknown");
  assert.equal(result?.message, "Usage: /plan [on|off]");
});

test("opens the settings panel and keeps typed directory compatibility", () => {
  const statusResult = runCommand("/setting");
  assert.equal(statusResult?.action, "open_settings_panel");
  assert.equal(statusResult?.message, undefined);

  const directoryResult = runCommand("/setting directory", {
    settings: {
      directoryDisplayMode: "simple",
    },
  });
  assert.equal(directoryResult?.action, "setting_directory");
  assert.match(directoryResult?.message ?? "", /Simple \(simple\)/i);
  assert.match(directoryResult?.message ?? "", /Allowed values: normal, simple/i);

  const setResult = runCommand("/setting directory simple");
  assert.equal(setResult?.action, "setting_directory");
  assert.equal(setResult?.value, "simple");
});

test("rejects invalid /setting usage with a short hint", () => {
  const invalidValue = runCommand("/setting directory compact");
  assert.equal(invalidValue?.action, "unknown");
  assert.equal(invalidValue?.message, "Usage: /setting directory [normal|simple]");

  const invalidSetting = runCommand("/setting theme");
  assert.equal(invalidSetting?.action, "unknown");
  assert.equal(invalidSetting?.message, "Usage: /setting or /setting directory [normal|simple]");
});

test("shows effective runtime status", () => {
  const result = runCommand("/status");
  assert.equal(result?.action, "status");
  assert.match(result?.message ?? "", /Plan mode: Disabled/i);
  assert.match(result?.message ?? "", /Approval policy: On request/i);
  assert.match(result?.message ?? "", /Sandbox mode: Read only/i);
  assert.match(result?.message ?? "", /Tokens used: ~1,200/i);
});

test("/models reports dynamic runtime capabilities", () => {
  const result = runCommand("/models", {
    modelCapabilities: dynamicCapabilities,
  });

  assert.equal(result?.action, "models");
  assert.match(result?.message ?? "", /Detected from Codex runtime/i);
  assert.match(result?.message ?? "", /dynamic-four.*4 reasoning levels/i);
  assert.match(result?.message ?? "", /dynamic-two.*2 reasoning levels/i);
});

test("shows layered config status", () => {
  const result = runCommand("/config");
  assert.equal(result?.action, "config_status");
  assert.match(result?.message ?? "", /Config status:/i);
  assert.match(result?.message ?? "", /Project trust: Untrusted/i);
});

test("parses config trust commands", () => {
  const statusResult = runCommand("/config trust");
  assert.equal(statusResult?.action, "config_trust_status");
  assert.match(statusResult?.message ?? "", /Status: Untrusted/i);

  const setResult = runCommand("/config trust on");
  assert.equal(setResult?.action, "config_trust_set");
  assert.equal(setResult?.value, "on");
});

test("opens the permissions panel when /permissions has no arguments", () => {
  const result = runCommand("/permissions");
  assert.equal(result?.action, "open_permissions_panel");
});

test("reports configured and effective permissions status", () => {
  const result = runCommand("/permissions status");
  assert.equal(result?.action, "permissions_status");
  assert.match(result?.message ?? "", /Permissions status:/i);
  assert.match(result?.message ?? "", /configured Inherit; effective On request/i);
  assert.match(result?.message ?? "", /Network access: configured Inherit; effective Disabled/i);
});

test("parses runtime approval policy setters and status", () => {
  const setResult = runCommand("/runtime approval-policy never");
  assert.equal(setResult?.action, "runtime_approval_policy");
  assert.equal(setResult?.value, "never");

  const statusResult = runCommand("/runtime approval-policy status");
  assert.equal(statusResult?.action, "runtime_approval_policy");
  assert.match(statusResult?.message ?? "", /configured Inherit; effective On request/i);
});

test("parses runtime sandbox setters and status", () => {
  const setResult = runCommand("/runtime sandbox danger-full-access");
  assert.equal(setResult?.action, "runtime_sandbox_mode");
  assert.equal(setResult?.value, "danger-full-access");

  const statusResult = runCommand("/runtime sandbox status");
  assert.equal(statusResult?.action, "runtime_sandbox_mode");
  assert.match(statusResult?.message ?? "", /configured Inherit; effective Read only/i);
});

test("parses runtime network setters including inherit resets", () => {
  const setResult = runCommand("/runtime network on");
  assert.equal(setResult?.action, "runtime_network_access");
  assert.equal(setResult?.value, "enabled");

  const inheritResult = runCommand("/runtime network inherit");
  assert.equal(inheritResult?.action, "runtime_network_access");
  assert.equal(inheritResult?.value, "inherit");
});

test("parses permissions command setters through the runtime action path", () => {
  const approvalResult = runCommand("/permissions approval-policy never");
  assert.equal(approvalResult?.action, "runtime_approval_policy");
  assert.equal(approvalResult?.value, "never");

  const sandboxResult = runCommand("/permissions sandbox workspace-write");
  assert.equal(sandboxResult?.action, "runtime_sandbox_mode");
  assert.equal(sandboxResult?.value, "workspace-write");

  const networkResult = runCommand("/permissions network on");
  assert.equal(networkResult?.action, "runtime_network_access");
  assert.equal(networkResult?.value, "enabled");

  const rootsResult = runCommand("/permissions writable-roots add .\\tmp");
  assert.equal(rootsResult?.action, "runtime_writable_roots_add");
  assert.equal(rootsResult?.value, ".\\tmp");
});

test("status reports resolved overrides rather than raw inherit values", () => {
  const runtime = normalizeRuntimeConfig({
    mode: "suggest",
    policy: {
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      networkAccess: "enabled",
      writableRoots: ["C:\\Extra\\"],
    },
  });
  const result = runCommand("/status", {
    runtime,
    resolvedRuntime: resolveRuntimeConfig(runtime),
  });

  assert.equal(result?.action, "status");
  assert.match(result?.message ?? "", /Approval policy: Never/i);
  assert.match(result?.message ?? "", /Sandbox mode: Workspace write/i);
  assert.match(result?.message ?? "", /Network access: Enabled/i);
  assert.match(result?.message ?? "", /C:\\Extra/i);
});

test("parses writable root list add remove and clear commands", () => {
  const listResult = runCommand("/runtime writable-roots list");
  assert.equal(listResult?.action, "runtime_writable_roots_list");
  assert.match(listResult?.message ?? "", /none/i);

  const addResult = runCommand("/runtime writable-roots add .\\tmp");
  assert.equal(addResult?.action, "runtime_writable_roots_add");
  assert.equal(addResult?.value, ".\\tmp");

  const removeResult = runCommand("/runtime writable-roots remove .\\tmp");
  assert.equal(removeResult?.action, "runtime_writable_roots_remove");
  assert.equal(removeResult?.value, ".\\tmp");

  const clearResult = runCommand("/runtime writable-roots clear");
  assert.equal(clearResult?.action, "runtime_writable_roots_clear");
});

test("parses runtime service tier and personality setters", () => {
  const tierResult = runCommand("/runtime service-tier fast");
  assert.equal(tierResult?.action, "runtime_service_tier");
  assert.equal(tierResult?.value, "fast");

  const personalityResult = runCommand("/runtime personality pragmatic");
  assert.equal(personalityResult?.action, "runtime_personality");
  assert.equal(personalityResult?.value, "pragmatic");
});

test("documents runtime commands in help", () => {
  const result = runCommand("/help");
  assert.equal(result?.action, "help");
  assert.match(result?.message ?? "", /\/status\s+Show the effective runtime configuration/i);
  assert.match(result?.message ?? "", /\/config\s+Show layered config sources/i);
  assert.match(result?.message ?? "", /\/permissions\s+Open or update permissions and sandbox controls/i);
  assert.match(result?.message ?? "", /\/permissions approval-policy/i);
  assert.match(result?.message ?? "", /\/runtime approval-policy/i);
  assert.match(result?.message ?? "", /\/runtime writable-roots/i);
  assert.match(result?.message ?? "", /\/plan \[on\|off\]\s+Show or toggle session plan mode/i);
  assert.match(result?.message ?? "", /\/setting\s+Open the settings picker/i);
  assert.match(result?.message ?? "", /\/setting directory \[normal\|simple\]/i);
  assert.match(result?.message ?? "", /Current plan mode: Disabled/i);
  assert.match(result?.message ?? "", /Shift\+Tab\s+Toggle plan mode/i);
  assert.match(result?.message ?? "", /Ctrl\+Y\s+Cycle execution mode/i);
});

test("shows the active locked workspace", () => {
  const result = runCommand("/workspace");
  assert.equal(result?.action, "workspace");
  assert.equal(result?.message, baseContext.workspace.summaryMessage);
});

test("parses workspace relaunch commands", () => {
  const result = runCommand("/workspace relaunch C:\\Next Workspace");
  assert.equal(result?.action, "workspace_relaunch");
  assert.equal(result?.value, "C:\\Next Workspace");
});

test("requires a target path for workspace relaunch", () => {
  const result = runCommand("/workspace relaunch");
  assert.equal(result?.action, "unknown");
  assert.match(result?.message ?? "", /Usage: \/workspace relaunch <path>/i);
});

test("parses /theme and /themes commands", () => {
  const themeResult = runCommand("/theme mono");
  assert.equal(themeResult?.action, "theme");
  assert.equal(themeResult?.value, "mono");

  const themesResult = runCommand("/themes");
  assert.equal(themesResult?.action, "open_theme_picker");
});
