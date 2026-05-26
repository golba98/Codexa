import test from "node:test";
import assert from "node:assert/strict";
import { wrapCommandText } from "./textLayout.js";

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
