import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function collectTsFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...collectTsFiles(full));
    } else if (full.endsWith(".ts")) {
      result.push(full);
    }
  }
  return result;
}

const SRC_ROOT = join(import.meta.dirname, "../../..");

// Guard against personal user-specific paths appearing in source.
// Patterns are split across array entries to prevent THIS file from matching itself.
const BANNED_FRAGMENTS: Array<[string, string]> = [
  ["C", ":\\\\Users\\\\jorda"],
  ["C", ":/Users/jorda"],
];

test("no source files contain personal hardcoded user paths", { timeout: 30_000 }, () => {
  const patterns = BANNED_FRAGMENTS.map(([a, b]) => new RegExp(a + b));
  const files = collectTsFiles(SRC_ROOT);
  const violations: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        violations.push(`${file}: matches ${pattern}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Personal hardcoded user paths found in source:\n${violations.join("\n")}`,
  );
});
