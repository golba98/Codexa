import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DIRECTORY_DISPLAY_MODE,
  DEFAULT_MODE,
  formatDirectoryDisplayModeLabel,
  formatModeLabel,
  formatWorkspaceDisplayPath,
  getNextMode,
  normalizeReasoningForModel,
} from "./settings.js";

test("keeps supported reasoning levels for gpt-5.4-mini", () => {
  assert.equal(normalizeReasoningForModel("gpt-5.4-mini", "high"), "high");
});

test("keeps reasoning unchanged for non-mini models", () => {
  assert.equal(normalizeReasoningForModel("gpt-5.4", "low"), "low");
});


test("formats codex-style mode labels", () => {
  assert.equal(formatModeLabel("suggest"), "SUGGEST");
  assert.equal(formatModeLabel("auto-edit"), "AUTO-EDIT");
  assert.equal(formatModeLabel("full-auto"), "FULL AUTO");
});

test("cycles modes in the same order as Ctrl+Y", () => {
  assert.equal(getNextMode("suggest"), "auto-edit");
  assert.equal(getNextMode("auto-edit"), "full-auto");
  assert.equal(getNextMode("full-auto"), "suggest");
});

test("defaults to full-auto mode", () => {
  assert.equal(DEFAULT_MODE, "full-auto");
});

test("defaults directory display mode to normal", () => {
  assert.equal(DEFAULT_DIRECTORY_DISPLAY_MODE, "normal");
  assert.equal(formatDirectoryDisplayModeLabel("normal"), "Normal");
  assert.equal(formatDirectoryDisplayModeLabel("simple"), "Simple");
});

test("formats workspace display paths without changing root semantics", () => {
  assert.equal(
    formatWorkspaceDisplayPath("C:\\Development\\1-JavaScript\\13-Custom CLI", "normal"),
    "C:\\Development\\1-JavaScript\\13-Custom CLI",
  );
  assert.equal(
    formatWorkspaceDisplayPath("C:\\Development\\1-JavaScript\\13-Custom CLI", "simple"),
    "13-Custom CLI",
  );
  assert.equal(formatWorkspaceDisplayPath("C:\\", "simple"), "C:\\");
  assert.equal(formatWorkspaceDisplayPath("C:\\Workspace\\", "simple"), "Workspace");
});
