import assert from "node:assert/strict";
import test from "node:test";
import { createMouseInputFilter } from "./terminalMouse.js";

test("drops complete SGR click packets", () => {
  const filter = createMouseInputFilter();

  const press = filter.filterChunk("\u001b[<0;35;26M");
  const release = filter.filterChunk("\u001b[<0;35;26m");

  assert.equal(press.output, "");
  assert.equal(release.output, "");
  assert.deepEqual(press.events, []);
  assert.deepEqual(release.events, []);
});

test("drops split SGR click packets across chunks", () => {
  const filter = createMouseInputFilter();

  const first = filter.filterChunk("\u001b");
  const second = filter.filterChunk("[<0;35;26M");

  assert.equal(first.output, "");
  assert.equal(second.output, "");
  assert.deepEqual(first.events, []);
  assert.deepEqual(second.events, []);
});

test("preserves non-mouse CSI sequences that arrive split across chunks", () => {
  const filter = createMouseInputFilter();

  const first = filter.filterChunk("\u001b");
  const second = filter.filterChunk("[D");

  assert.equal(first.output, "");
  assert.equal(second.output, "\u001b[D");
  assert.deepEqual(second.events, []);
});

test("emits scroll events for wheel packets without leaking text", () => {
  const filter = createMouseInputFilter();

  const up = filter.filterChunk("\u001b[<64;35;26M");
  const down = filter.filterChunk("\u001b[<65;35;26M");

  assert.equal(up.output, "");
  assert.equal(down.output, "");
  assert.deepEqual(up.events, ["scroll-up"]);
  assert.deepEqual(down.events, ["scroll-down"]);
});

test("passes through bracketed paste and plain text", () => {
  const filter = createMouseInputFilter();
  const result = filter.filterChunk("\u001b[200~alpha\nbeta\u001b[201~");

  assert.equal(result.output, "\u001b[200~alpha\nbeta\u001b[201~");
  assert.deepEqual(result.events, []);
});
