import assert from "node:assert/strict";
import test from "node:test";
import {
  selectLogoVariant,
  getLogoWidth,
  LOGO_LARGE,
  LOGO_MEDIUM,
  LOGO_COMPACT,
  LOGO_LARGE_MIN_COLS,
  LOGO_MEDIUM_MIN_COLS,
  LOGO_COMPACT_MIN_COLS,
} from "./logoVariants.js";

test("selectLogoVariant returns LOGO_LARGE at the large threshold", () => {
  assert.equal(selectLogoVariant(LOGO_LARGE_MIN_COLS), LOGO_LARGE);
  assert.equal(selectLogoVariant(LOGO_LARGE_MIN_COLS + 80), LOGO_LARGE);
});

test("selectLogoVariant returns LOGO_MEDIUM at the medium threshold", () => {
  assert.equal(selectLogoVariant(LOGO_MEDIUM_MIN_COLS), LOGO_MEDIUM);
});

test("selectLogoVariant returns LOGO_COMPACT at the compact threshold", () => {
  assert.equal(selectLogoVariant(LOGO_COMPACT_MIN_COLS), LOGO_COMPACT);
});

test("selectLogoVariant returns empty array below the compact threshold", () => {
  assert.deepStrictEqual(selectLogoVariant(LOGO_COMPACT_MIN_COLS - 1), []);
  assert.deepStrictEqual(selectLogoVariant(0), []);
});

test("selectLogoVariant returns LOGO_MEDIUM just below the large threshold", () => {
  assert.equal(selectLogoVariant(LOGO_LARGE_MIN_COLS - 1), LOGO_MEDIUM);
});

test("selectLogoVariant returns LOGO_COMPACT just below the medium threshold", () => {
  assert.equal(selectLogoVariant(LOGO_MEDIUM_MIN_COLS - 1), LOGO_COMPACT);
});

test("CODEXA_NO_ASCII_LOGO=1 suppresses all logo art at any width", () => {
  process.env["CODEXA_NO_ASCII_LOGO"] = "1";
  try {
    assert.deepStrictEqual(selectLogoVariant(200), []);
    assert.deepStrictEqual(selectLogoVariant(LOGO_LARGE_MIN_COLS), []);
  } finally {
    delete process.env["CODEXA_NO_ASCII_LOGO"];
  }
});

test("CODEXA_COMPACT_LOGO=1 forces compact logo at any width", () => {
  process.env["CODEXA_COMPACT_LOGO"] = "1";
  try {
    assert.equal(selectLogoVariant(200), LOGO_COMPACT);
    assert.equal(selectLogoVariant(LOGO_LARGE_MIN_COLS), LOGO_COMPACT);
  } finally {
    delete process.env["CODEXA_COMPACT_LOGO"];
  }
});

test("LOGO_LARGE has exactly 6 rows", () => {
  assert.equal(LOGO_LARGE.length, 6);
});

test("LOGO_MEDIUM has exactly 4 rows", () => {
  assert.equal(LOGO_MEDIUM.length, 4);
});

test("LOGO_COMPACT has exactly 1 row", () => {
  assert.equal(LOGO_COMPACT.length, 1);
});

test("getLogoWidth returns 0 for an empty logo", () => {
  assert.equal(getLogoWidth([]), 0);
});

test("getLogoWidth(LOGO_LARGE) is narrower than its minimum column threshold", () => {
  const width = getLogoWidth(LOGO_LARGE);
  assert.ok(
    width < LOGO_LARGE_MIN_COLS,
    `LOGO_LARGE width ${width} must be narrower than LOGO_LARGE_MIN_COLS (${LOGO_LARGE_MIN_COLS})`,
  );
});

test("getLogoWidth(LOGO_MEDIUM) is narrower than its minimum column threshold", () => {
  const width = getLogoWidth(LOGO_MEDIUM);
  assert.ok(
    width < LOGO_MEDIUM_MIN_COLS,
    `LOGO_MEDIUM width ${width} must be narrower than LOGO_MEDIUM_MIN_COLS (${LOGO_MEDIUM_MIN_COLS})`,
  );
});

test("getLogoWidth(LOGO_COMPACT) is narrower than its minimum column threshold", () => {
  const width = getLogoWidth(LOGO_COMPACT);
  assert.ok(
    width < LOGO_COMPACT_MIN_COLS,
    `LOGO_COMPACT width ${width} must be narrower than LOGO_COMPACT_MIN_COLS (${LOGO_COMPACT_MIN_COLS})`,
  );
});

test("no LOGO_LARGE row is empty", () => {
  for (const row of LOGO_LARGE) {
    assert.ok(row.trim().length > 0, `Found empty/whitespace-only row in LOGO_LARGE: "${row}"`);
  }
});

test("no LOGO_MEDIUM row is empty", () => {
  for (const row of LOGO_MEDIUM) {
    assert.ok(row.trim().length > 0, `Found empty/whitespace-only row in LOGO_MEDIUM: "${row}"`);
  }
});
