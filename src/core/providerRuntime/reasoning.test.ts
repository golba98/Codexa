import assert from "node:assert/strict";
import test from "node:test";
import { getClaudeCodeEffortLevels } from "./reasoning.js";

test("getClaudeCodeEffortLevels preserves unknown CLI effort ids", () => {
  assert.deepEqual(getClaudeCodeEffortLevels(["low", "ultra"]), [
    { id: "low", label: "Low", description: "Claude Code low effort." },
    { id: "ultra", label: "Ultra", description: null },
  ]);
});
