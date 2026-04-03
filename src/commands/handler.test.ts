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

test("parses /login command", () => {
  const result = handleCommand(
    "/login",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "login");
});

test("parses /logout command", () => {
  const result = handleCommand(
    "/logout",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "logout");
});

test("parses /auth status as auth_status action", () => {
  const result = handleCommand(
    "/auth status",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "auth_status");
});

test("keeps existing /model command behavior", () => {
  const result = handleCommand(
    "/model gpt-5.4-mini",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

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
    const result = handleCommand(
      command,
      baseArgs.currentBackend,
      baseArgs.currentModel,
      baseArgs.currentMode,
      baseArgs.currentAuthPreference,
      baseArgs.currentReasoningLevel,
      baseArgs.currentTheme,
      baseArgs.workspace,
    );

    assert(result, command);
    assert.equal(result?.action, "mode", command);
    assert.equal(result?.value, expectedValue, command);
  }
});

test("opens the reasoning picker when /reasoning has no argument", () => {
  const result = handleCommand(
    "/reasoning",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "open_reasoning_picker");
});

test("accepts explicit reasoning levels", () => {
  const result = handleCommand(
    "/reasoning medium",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "reasoning");
  assert.equal(result?.value, "medium");
});

test("accepts extra high reasoning aliases", () => {
  const result = handleCommand(
    "/reasoning extra high",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "reasoning");
  assert.equal(result?.value, "xhigh");
});

test("documents mode aliases in help", () => {
  const result = handleCommand(
    "/help",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "help");
  assert.match(result?.message ?? "", /suggest, auto-edit, full-auto/i);
  assert.match(result?.message ?? "", /aliases: default, ask, add, auto, plan/i);
  assert.match(result?.message ?? "", /auto-edit = writes files/i);
  assert.match(result?.message ?? "", /\/workspace\s+Show the locked workspace/i);
  assert.match(result?.message ?? "", /\/workspace relaunch <path>/i);
  assert.match(result?.message ?? "", /npm link/i);
  assert.match(result?.message ?? "", /Ctrl\+Y\s+Cycle execution mode/i);
});

test("shows the active locked workspace", () => {
  const result = handleCommand(
    "/workspace",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "workspace");
  assert.equal(result?.message, baseArgs.workspace.summaryMessage);
});

test("parses workspace relaunch commands", () => {
  const result = handleCommand(
    "/workspace relaunch C:\\Next Workspace",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "workspace_relaunch");
  assert.equal(result?.value, "C:\\Next Workspace");
});

test("parses workspace relaunch with relative target", () => {
  const result = handleCommand(
    "/workspace relaunch .",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "workspace_relaunch");
  assert.equal(result?.value, ".");
});

test("requires a target path for workspace relaunch", () => {
  const result = handleCommand(
    "/workspace relaunch",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "unknown");
  assert.match(result?.message ?? "", /Usage: \/workspace relaunch <path>/i);
});

test("parses /theme command", () => {
  const result = handleCommand(
    "/theme mono",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "theme");
  assert.equal(result?.value, "mono");
});

test("parses /themes command to open picker", () => {
  const result = handleCommand(
    "/themes",
    baseArgs.currentBackend,
    baseArgs.currentModel,
    baseArgs.currentMode,
    baseArgs.currentAuthPreference,
    baseArgs.currentReasoningLevel,
    baseArgs.currentTheme,
    baseArgs.workspace,
  );

  assert(result);
  assert.equal(result?.action, "open_theme_picker");
});
