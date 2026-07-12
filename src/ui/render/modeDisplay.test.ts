import assert from "node:assert/strict";
import test from "node:test";
import { getModeDisplaySpec } from "./modeDisplay.js";
import { THEMES, DARK_THEME as theme } from "../theme.js";

test("maps internal modes to Codex-aligned display labels", () => {
  assert.equal(getModeDisplaySpec("suggest", theme).label, "Read-only");
  assert.equal(getModeDisplaySpec("auto-edit", theme).label, "Auto");
  assert.equal(getModeDisplaySpec("full-auto", theme).label, "Full Access");
});

test("uses distinct ring glyphs and theme tokens for each mode", () => {
  const readOnly = getModeDisplaySpec("suggest", theme);
  const auto = getModeDisplaySpec("auto-edit", theme);
  const fullAccess = getModeDisplaySpec("full-auto", theme);

  assert.equal(readOnly.ringGlyph, "○");
  assert.equal(readOnly.ringColor, theme.success);
  assert.equal(readOnly.ringFill, theme.surfaceMuted);

  assert.equal(auto.ringGlyph, "◎");
  assert.equal(auto.ringColor, theme.borderFocused);
  assert.equal(auto.ringFill, theme.surfaceMuted);

  assert.equal(fullAccess.ringGlyph, "◉");
  assert.equal(fullAccess.ringColor, theme.warning);
  assert.equal(fullAccess.ringFill, theme.border);
});

test("keeps the mode ring meaningful across every built-in theme", () => {
  for (const [themeName, activeTheme] of Object.entries(THEMES)) {
    const specs = [
      getModeDisplaySpec("suggest", activeTheme),
      getModeDisplaySpec("auto-edit", activeTheme),
      getModeDisplaySpec("full-auto", activeTheme),
    ];

    assert.equal(new Set(specs.map((spec) => spec.ringGlyph)).size, 3, themeName);
    assert.equal(new Set(specs.map((spec) => spec.ringColor)).size, 3, themeName);
    assert.ok(specs.every((spec) => spec.ringFill.length > 0), themeName);
  }
});
