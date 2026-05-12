import assert from "node:assert/strict";
import test from "node:test";
import {
  getCommandSuggestionState,
  getComposerPersona,
  getVisibleComposerStatusLine,
  measureBottomComposerRows,
} from "./BottomComposer.js";
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

  assert.equal(rows, 6);
});

test("uses the run footer row budget in cramped busy viewports", () => {
  const rows = measureBottomComposerRows({
    layout: createLayoutSnapshot(80, 24),
    uiState: { kind: "THINKING", turnId: 1 },
    value: "",
    cursor: 0,
  });

  assert.equal(rows, 4);
});

test("does not render an exact slash command draft as a suggestion row", () => {
  const exact = getCommandSuggestionState({
    value: "/clear",
    allowCommands: true,
    inputLocked: false,
  });

  assert.equal(exact.showSuggestions, true);
  assert.equal(exact.reserveSuggestionRow, true);
  assert.deepEqual(exact.suggestions.map((suggestion) => suggestion.cmd), []);
});

test("keeps partial slash command suggestions visible", () => {
  const partial = getCommandSuggestionState({
    value: "/clea",
    allowCommands: true,
    inputLocked: false,
  });

  assert.equal(partial.showSuggestions, true);
  assert.equal(partial.reserveSuggestionRow, true);
  assert.deepEqual(partial.suggestions.map((suggestion) => suggestion.cmd), ["/clear"]);
});

test("keeps exact and partial slash command row budgets stable", () => {
  const layout = createLayoutSnapshot(100, 30);
  const base = {
    layout,
    uiState: { kind: "IDLE" } as const,
    value: "",
    cursor: 0,
  };

  const partialRows = measureBottomComposerRows({
    ...base,
    value: "/clea",
    cursor: "/clea".length,
  });
  const exactRows = measureBottomComposerRows({
    ...base,
    value: "/clear",
    cursor: "/clear".length,
  });

  assert.equal(exactRows, partialRows);
});

test("suppresses completed response status while a slash command draft is active", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "ANSWER_VISIBLE", turnId: 1 },
      value: "/clear",
      allowCommands: true,
    }),
    "",
  );

  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "ANSWER_VISIBLE", turnId: 1 },
      value: "next prompt",
      allowCommands: true,
    }),
    "✧ Codexa response complete",
  );
});
