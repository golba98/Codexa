import assert from "node:assert/strict";
import test from "node:test";
import { buildStreamingPreviewRows } from "./AgentBlock.js";

test("caps streamed rows to the configured preview tail", () => {
  const rows = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
  const preview = buildStreamingPreviewRows(rows, 5);

  assert.equal(preview.rows.length, 5);
  assert.equal(preview.rows[0], "line 8");
  assert.equal(preview.rows.at(-1), "line 12");
  assert.equal(preview.hiddenRows, 7);
});

test("keeps all rows when stream output is within bounds", () => {
  const rows = ["a", "b", "c"];
  const preview = buildStreamingPreviewRows(rows, 5);

  assert.deepEqual(preview.rows, rows);
  assert.equal(preview.hiddenRows, 0);
});
