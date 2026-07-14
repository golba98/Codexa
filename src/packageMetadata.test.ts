import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
};

test("published package binary remains codexa only", () => {
  assert.deepEqual(packageJson.bin, { codexa: "bin/codexa.js" });
  assert.equal(Object.hasOwn(packageJson.bin ?? {}, "codexa-dev"), false);
});

test("local dev scripts install and run codexa-dev separately", () => {
  assert.equal(packageJson.scripts?.["install:dev-bin"], "node scripts/install-local-dev-bin.mjs");
  assert.equal(packageJson.scripts?.["dev:run"], "node scripts/run-local-dev.mjs");
});
