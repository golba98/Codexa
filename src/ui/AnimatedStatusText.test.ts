import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

test("busy status text is pure and has no local animation timer", () => {
  const source = readFileSync(join(here, "AnimatedStatusText.tsx"), "utf8");

  assert.doesNotMatch(source, /setInterval|setTimeout|useEffect|useState/);
  assert.doesNotMatch(source, /useAnimatedDots|useThrottledValue/);
});
