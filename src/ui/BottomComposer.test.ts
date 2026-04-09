import assert from "node:assert/strict";
import test from "node:test";
import { getComposerPersona, measureBottomComposerRows } from "./BottomComposer.js";
import { createLayoutSnapshot } from "./layout.js";

test("maps the idle state to the idle composer persona", () => {
  assert.equal(getComposerPersona({ kind: "IDLE" }), "idle");
});

test("maps busy, answer, and error states to the right personas", () => {
  assert.equal(getComposerPersona({ kind: "THINKING", turnId: 1 }), "busy");
  assert.equal(getComposerPersona({ kind: "RESPONDING", turnId: 1 }), "busy");
  assert.equal(getComposerPersona({ kind: "SHELL_RUNNING", shellId: 7 }), "busy");
  assert.equal(getComposerPersona({ kind: "AWAITING_USER_ACTION", turnId: 2, question: "Need Redis?" }), "answer");
  assert.equal(getComposerPersona({ kind: "ERROR", turnId: 3, message: "Boom" }), "error");
});

test("measures the standard composer rows from the rendered prompt state", () => {
  const rows = measureBottomComposerRows({
    layout: createLayoutSnapshot(100, 30),
    uiState: { kind: "IDLE" },
    mode: "auto-edit",
    model: "gpt-5.4",
    reasoningLevel: "medium",
    tokensUsed: 1200,
    value: "",
    cursor: 0,
  });

  assert.equal(rows, 5);
});

test("uses the run footer row budget in cramped busy viewports", () => {
  const rows = measureBottomComposerRows({
    layout: createLayoutSnapshot(80, 24),
    uiState: { kind: "THINKING", turnId: 1 },
    value: "",
    cursor: 0,
  });

  assert.equal(rows, 3);
});
