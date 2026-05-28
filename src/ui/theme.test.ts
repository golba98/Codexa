import assert from "node:assert/strict";
import test from "node:test";
import { THEMES, Theme } from "./theme.js";

test("all themes expose the same required semantic tokens", () => {
  const requiredTokens: (keyof Theme)[] = [
    "bg",
    "surface",
    "surfaceMuted",
    "border",
    "borderFocused",
    "text",
    "textMuted",
    "textDim",
    "accent",
    "accentMuted",
    "success",
    "warning",
    "error",
    "info",
    "command",
    "prompt",
    "model",
    "provider",
    "context",
    "logoPrimary",
    "logoSecondary",
    "logoShadow",
  ];

  for (const [themeId, themeObj] of Object.entries(THEMES)) {
    for (const token of requiredTokens) {
      assert.ok(
        themeObj[token] !== undefined,
        `Theme "${themeId}" is missing the semantic token "${token}"`
      );
      assert.equal(
        typeof themeObj[token],
        "string",
        `Theme "${themeId}" token "${token}" must be a string`
      );
    }
  }
});
