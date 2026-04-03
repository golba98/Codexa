import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelThemeSelection,
  commitThemeSelection,
  getDisplayedThemeName,
  previewThemeSelection,
  shouldBumpComposerInstance,
  type ThemeSelectionState,
} from "./themeFlow.js";

function createThemeState(overrides: Partial<ThemeSelectionState> = {}): ThemeSelectionState {
  return {
    committedTheme: "purple",
    previewTheme: null,
    ...overrides,
  };
}

test("uses the preview theme for rendering without mutating the committed theme", () => {
  const state = createThemeState();
  const previewed = previewThemeSelection(state, "mono");

  assert.equal(state.committedTheme, "purple");
  assert.equal(previewed.committedTheme, "purple");
  assert.equal(previewed.previewTheme, "mono");
  assert.equal(getDisplayedThemeName(previewed), "mono");
});

test("commits a selected theme and clears the preview", () => {
  const state = createThemeState({ previewTheme: "mono" });
  const committed = commitThemeSelection(state, "dark");

  assert.equal(committed.committedTheme, "dark");
  assert.equal(committed.previewTheme, null);
  assert.equal(getDisplayedThemeName(committed), "dark");
});

test("canceling the picker restores the committed theme", () => {
  const state = createThemeState({ previewTheme: "mono" });
  const canceled = cancelThemeSelection(state);

  assert.equal(canceled.committedTheme, "purple");
  assert.equal(canceled.previewTheme, null);
  assert.equal(getDisplayedThemeName(canceled), "purple");
});

test("bumps the composer instance when returning to the main screen", () => {
  assert.equal(shouldBumpComposerInstance("theme-picker", "main"), true);
  assert.equal(shouldBumpComposerInstance("model-picker", "main"), true);
  assert.equal(shouldBumpComposerInstance("main", "main"), false);
  assert.equal(shouldBumpComposerInstance("main", "theme-picker"), false);
});
