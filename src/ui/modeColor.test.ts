import assert from "node:assert/strict";
import test from "node:test";
import { getModeColor } from "./modeColor.js";
import { theme } from "./theme.js";

test("maps suggest mode to green", () => {
  assert.equal(getModeColor("suggest", theme), theme.SUCCESS);
});

test("maps auto-edit mode to yellow", () => {
  assert.equal(getModeColor("auto-edit", theme), theme.WARNING);
});

test("maps full-auto mode to red", () => {
  assert.equal(getModeColor("full-auto", theme), theme.ERROR);
});
