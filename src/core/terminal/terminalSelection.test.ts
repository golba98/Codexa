import assert from "node:assert/strict";
import test from "node:test";
import { getTerminalSelectionProfile } from "./terminalSelection.js";

test("detects Windows Terminal selection override", () => {
  const profile = getTerminalSelectionProfile({ WT_SESSION: "abc", TERM_PROGRAM: "vscode" }, "win32");

  assert.equal(profile.id, "windows-terminal");
  assert.equal(profile.shortHint, "Shift+drag selects");
  assert.match(profile.selectionHint, /Shift\+drag to select instantly/i);
});

test("detects VS Code selection override on Windows and Linux", () => {
  const windows = getTerminalSelectionProfile({ TERM_PROGRAM: "vscode" }, "win32");
  const linux = getTerminalSelectionProfile({ TERM_PROGRAM: "vscode" }, "linux");

  assert.equal(windows.id, "vscode");
  assert.equal(windows.shortHint, "Alt+drag selects");
  assert.equal(linux.shortHint, "Alt+drag selects");
});

test("detects VS Code macOS option-drag wording", () => {
  const profile = getTerminalSelectionProfile({ TERM_PROGRAM: "vscode" }, "darwin");

  assert.equal(profile.id, "vscode");
  assert.equal(profile.shortHint, "Option+drag selects");
});

test("falls back to xterm-compatible Shift selection", () => {
  const profile = getTerminalSelectionProfile({ TERM: "xterm-256color" }, "linux");

  assert.equal(profile.id, "xterm-like");
  assert.equal(profile.shortHint, "Shift+drag selects");
});

test("unknown VT terminals get a practical default hint", () => {
  const profile = getTerminalSelectionProfile({}, "linux");

  assert.equal(profile.id, "unknown-vt");
  assert.equal(profile.shortHint, "Shift+drag selects");
  assert.match(profile.selectionHint, /terminal mouse-selection override/i);
});
