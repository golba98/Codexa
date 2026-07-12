import test from "node:test";
import assert from "node:assert/strict";
import { wrapCommandText, wrapPlainText, getTextWidth } from "./textLayout.js";

test("wrapCommandText breaks on spaces and indents continuation lines", () => {
  const result = wrapCommandText("if (Get-Command rg) { rg --files } else { Get-ChildItem -Recurse -File }", 40);
  assert.equal(result.length, 2);
  assert.equal(result[0].trimEnd(), "if (Get-Command rg) { rg --files } else");
  assert.equal(result[1].trimEnd(), "  { Get-ChildItem -Recurse -File }");
});

test("wrapCommandText handles extremely long unbroken tokens by breaking them", () => {
  const result = wrapCommandText("A_Very_Long_Token_Without_Spaces_That_Exceeds_Max_Width", 20);
  assert.equal(result.length, 3);
  assert.equal(result[0], "A_Very_Long_Token_Wi");
  assert.equal(result[1], "  thout_Spaces_That_");
  assert.equal(result[2], "  Exceeds_Max_Width");
});

test("wrapPlainText default firstLineWidth equals maxWidth (existing callers unchanged)", () => {
  const text = "alpha beta gamma delta epsilon zeta";
  assert.deepEqual(wrapPlainText(text, 16), wrapPlainText(text, 16, 16));
  for (const row of wrapPlainText(text, 16)) {
    assert.ok(getTextWidth(row) <= 16, `row "${row}" should fit maxWidth`);
  }
});

test("wrapPlainText honors a narrower firstLineWidth on the first row only", () => {
  const text = "alpha beta gamma delta epsilon zeta eta";
  const rows = wrapPlainText(text, 20, 10);
  assert.ok(rows.length >= 2, "should wrap onto multiple rows");
  assert.ok(getTextWidth(rows[0]) <= 10, `first row "${rows[0]}" must fit firstLineWidth (10)`);
  for (const row of rows.slice(1)) {
    assert.ok(getTextWidth(row) <= 20, `continuation row "${row}" must fit maxWidth (20)`);
  }
  // No content is lost — char-level wrapping moves every unit into some row.
  assert.equal(rows.join(""), text);
});
