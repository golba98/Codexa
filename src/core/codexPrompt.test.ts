import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexPrompt, promptHasWriteIntent, resolveExecutionMode } from "./codexPrompt.js";

test("detects write intent for build requests", () => {
  assert.equal(promptHasWriteIntent("Create a weather app script with tests"), true);
});

test("does not force write mode for general questions", () => {
  assert.equal(promptHasWriteIntent("Explain how array sorting works"), false);
});

test("auto-upgrades suggest mode for editing prompts", () => {
  assert.deepEqual(resolveExecutionMode("suggest", "Create a new CLI script and tests"), {
    mode: "auto-edit",
    autoUpgraded: true,
  });
});

test("keeps explicit full-auto mode unchanged", () => {
  assert.deepEqual(resolveExecutionMode("full-auto", "Create a new CLI script and tests"), {
    mode: "full-auto",
    autoUpgraded: false,
  });
});

test("builds a write-enabled codex prompt for auto-edit", () => {
  const prompt = buildCodexPrompt("Create a weather app script with tests", "auto-edit");
  assert.match(prompt, /write access/i);
  assert.match(prompt, /create or update files directly/i);
  assert.match(prompt, /best-effort continuation/i);
  assert.match(prompt, /make the most reasonable assumption/i);
  assert.match(prompt, /\[QUESTION\]:/i);
  assert.match(prompt, /do not reply with generic readiness/i);
  assert.match(prompt, /Task:/i);
});

test("builds a suggest-mode prompt that avoids generic readiness replies", () => {
  const prompt = buildCodexPrompt("Explain this code", "suggest");
  assert.match(prompt, /read-only mode/i);
  assert.match(prompt, /best-effort continuation/i);
  assert.match(prompt, /choose one sensible path and continue/i);
  assert.match(prompt, /\[QUESTION\]:/i);
  assert.match(prompt, /do not reply with generic readiness/i);
  assert.match(prompt, /Task:/i);
});
