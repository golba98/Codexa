import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function collectTsFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

const SRC_ROOT = join(import.meta.dirname, "../..");

// Guard against personal user-specific paths appearing in source.
// Patterns are split across array entries to prevent THIS file from matching itself.
const BANNED_PATTERNS: RegExp[] = [new RegExp(["C:", "[/\\\\]+Users[/\\\\]+jorda"].join(""), "i")];

test("no source files contain personal hardcoded user paths", { timeout: 30_000 }, () => {
  const files = collectTsFiles(SRC_ROOT);
  const violations: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    for (const pattern of BANNED_PATTERNS) {
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

test("hardcoded path pattern detects Windows and Unix personal paths", () => {
  const name = ["jor", "da"].join("");
  for (const pattern of BANNED_PATTERNS) {
    assert.ok(pattern.test(`C:/Users/${name}/file.txt`));
    assert.ok(pattern.test(`C:\\Users\\${name}\\file.txt`));
    assert.ok(pattern.test(`const p = "C:\\\\Users\\\\${name}\\\\file.txt";`));
    assert.ok(!pattern.test("C:/Users/Example/file.txt"));
    assert.ok(!pattern.test("C:\\Users\\Example\\file.txt"));
  }
});

test("source scan stays within src and includes TSX components", () => {
  assert.equal(SRC_ROOT, join(import.meta.dirname, "..", ".."));
  const files = collectTsFiles(SRC_ROOT);
  assert.ok(files.includes(join(SRC_ROOT, "index.tsx")));
  assert.ok(files.includes(join(SRC_ROOT, "core", "executables", "pathSanityScan.test.ts")));
  assert.ok(files.every((file) => !file.includes("node_modules")));
});

test("source scan skips symlinks, including broken links and directory cycles", () => {
  const root = mkdtempSync(join(tmpdir(), "ubume-source-scan-"));
  try {
    writeFileSync(join(root, "component.tsx"), "export default null;\n");
    writeFileSync(join(root, "helper.ts"), "export {};\n");
    writeFileSync(join(root, "ignored.js"), "export {};\n");
    symlinkSync(join(root, "missing.ts"), join(root, "broken.ts"));
    symlinkSync(root, join(root, "cycle"), "dir");
    assert.deepEqual(collectTsFiles(root).sort(), [
      join(root, "component.tsx"),
      join(root, "helper.ts"),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
