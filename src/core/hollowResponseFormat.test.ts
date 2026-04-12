import assert from "node:assert/strict";
import test from "node:test";
import { formatHollowResponse } from "./hollowResponseFormat.js";
import type { HollowResponseResult } from "./codexPrompt.js";

function makeResult(kind: HollowResponseResult["kind"], reason = ""): HollowResponseResult {
  return { isHollow: true, kind, reason };
}

test("greeting produces exactly 2 lines", () => {
  const out = formatHollowResponse(makeResult("greeting"));
  const lines = out.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /generic greeting/);
  assert.match(lines[1]!, /Retry/);
});

test("filler produces exactly 2 lines", () => {
  const out = formatHollowResponse(makeResult("filler"));
  const lines = out.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /acknowledged without acting/);
});

test("clarification produces exactly 2 lines", () => {
  const out = formatHollowResponse(makeResult("clarification"));
  const lines = out.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /clarification/);
  assert.match(lines[1]!, /suggest mode/);
});

test("short-no-action produces exactly 2 lines", () => {
  const out = formatHollowResponse(makeResult("short-no-action"));
  const lines = out.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /too brief/);
});

test("no emoji or warning symbols in any output", () => {
  for (const kind of ["greeting", "filler", "clarification", "short-no-action"] as const) {
    const out = formatHollowResponse(makeResult(kind));
    assert.doesNotMatch(out, /⚠/);
    assert.doesNotMatch(out, /---/);
  }
});

test("verbose=false omits raw response", () => {
  const out = formatHollowResponse(makeResult("greeting"), "Hello.");
  assert.doesNotMatch(out, /Hello\./);
});

test("verbose=true appends raw response", () => {
  const out = formatHollowResponse(makeResult("greeting"), "Hello.", true);
  assert.match(out, /Backend response: Hello\./);
  const lines = out.split("\n");
  assert.equal(lines.length, 4); // 2 message lines + blank + backend response
});
