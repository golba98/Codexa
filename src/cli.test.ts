import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("headless cli entrypoint does not import interactive UI modules", () => {
  const source = readFileSync(fileURLToPath(new URL("./cli.ts", import.meta.url)), "utf8");

  assert.doesNotMatch(source, /from\s+["']\.\/index(?:\.js)?["']/);
  assert.doesNotMatch(source, /from\s+["']\.\/app(?:\.js)?["']/);
  assert.doesNotMatch(source, /from\s+["']ink["']/);
  assert.doesNotMatch(source, /from\s+["']react["']/);
});
