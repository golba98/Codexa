import assert from "node:assert/strict";
import test from "node:test";
import { handleCommand } from "./handler.js";

const baseArgs = {
  currentBackend: "codex-subprocess",
  currentModel: "gpt-5.4",
  currentMode: "suggest",
  currentAuthPreference: "chatgpt-login-goal",
  currentReasoningLevel: "high",
  currentTheme: "purple",
  currentRuntimePolicy: {
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
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
} as const;

function runCommand(command: string) {
  return handleCommand(
    command,
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.currentRuntimePolicy,
    baseArgs.workspace,
  );
}

test("parses /login command", () => {
  const result = runCommand("/login");
  assert(result);
  assert.equal(result?.action, "login");
});

test("parses /logout command", () => {
  const result = runCommand("/logout");
  assert(result);
  assert.equal(result?.action, "logout");
});

test("parses /auth status as auth_status action", () => {
  const result = runCommand("/auth status");
  assert(result);
  assert.equal(result?.action, "auth_status");
});

test("keeps existing /model command behavior", () => {
  const result = runCommand("/model gpt-5.4-mini");
  assert(result);
  assert.equal(result?.action, "model");
  assert.equal(result?.value, "gpt-5.4-mini");
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
    assert(result, command);
    assert.equal(result?.action, "mode", command);
    assert.equal(result?.value, expectedValue, command);
  }
});

test("opens the reasoning picker when /reasoning has no argument", () => {
  const result = runCommand("/reasoning");
  assert(result);
  assert.equal(result?.action, "open_reasoning_picker");
});

test("accepts explicit reasoning levels", () => {
  const result = runCommand("/reasoning medium");
  assert(result);
  assert.equal(result?.action, "reasoning");
  assert.equal(result?.value, "medium");
});

test("accepts extra high reasoning aliases", () => {
  const result = runCommand("/reasoning extra high");
  assert(result);
  assert.equal(result?.action, "reasoning");
  assert.equal(result?.value, "xhigh");
});

test("opens the permissions picker when /permissions has no argument", () => {
  const result = runCommand("/permissions");
  assert(result);
  assert.equal(result?.action, "open_permissions_picker");
});

test("reports current permissions status", () => {
  const result = runCommand("/permissions status");
  assert(result);
  assert.equal(result?.action, "permissions_status");
  assert.match(result?.message ?? "", /On request approval/i);
  assert.match(result?.message ?? "", /Workspace write sandbox/i);
});

test("parses explicit approval policy changes", () => {
  const result = runCommand("/permissions approval never");
  assert(result);
  assert.equal(result?.action, "permissions_approval");
  assert.equal(result?.value, "never");
});

test("parses explicit sandbox changes", () => {
  const result = runCommand("/permissions sandbox danger-full-access");
  assert(result);
  assert.equal(result?.action, "permissions_sandbox");
  assert.equal(result?.value, "danger-full-access");
});

test("documents permissions controls in help", () => {
  const result = runCommand("/help");
  assert(result);
  assert.equal(result?.action, "help");
  assert.match(result?.message ?? "", /suggest, auto-edit, full-auto/i);
  assert.match(result?.message ?? "", /aliases: default, ask, add, auto, plan/i);
  assert.match(result?.message ?? "", /\/permissions\s+Open permissions picker/i);
  assert.match(result?.message ?? "", /\/permissions status/i);
  assert.match(result?.message ?? "", /Current permissions: On request approval/i);
  assert.match(result?.message ?? "", /\/workspace\s+Show the locked workspace/i);
  assert.match(result?.message ?? "", /\/workspace relaunch <path>/i);
  assert.match(result?.message ?? "", /npm link/i);
  assert.match(result?.message ?? "", /Ctrl\+Y\s+Cycle execution mode/i);
});

test("shows the active locked workspace", () => {
  const result = runCommand("/workspace");
  assert(result);
  assert.equal(result?.action, "workspace");
  assert.equal(result?.message, baseArgs.workspace.summaryMessage);
});

test("parses workspace relaunch commands", () => {
  const result = runCommand("/workspace relaunch C:\\Next Workspace");
  assert(result);
  assert.equal(result?.action, "workspace_relaunch");
  assert.equal(result?.value, "C:\\Next Workspace");
});

test("parses workspace relaunch with relative target", () => {
  const result = runCommand("/workspace relaunch .");
  assert(result);
  assert.equal(result?.action, "workspace_relaunch");
  assert.equal(result?.value, ".");
});

test("requires a target path for workspace relaunch", () => {
  const result = runCommand("/workspace relaunch");
  assert(result);
  assert.equal(result?.action, "unknown");
  assert.match(result?.message ?? "", /Usage: \/workspace relaunch <path>/i);
});

test("parses /theme command", () => {
  const result = runCommand("/theme mono");
  assert(result);
  assert.equal(result?.action, "theme");
  assert.equal(result?.value, "mono");
});

test("parses /themes command to open picker", () => {
  const result = runCommand("/themes");
  assert(result);
  assert.equal(result?.action, "open_theme_picker");
});
