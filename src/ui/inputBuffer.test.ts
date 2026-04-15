import assert from "node:assert/strict";
import test from "node:test";
import {
  clampScrollToCursor,
  createInputViewport,
  deleteInputBackward,
  deleteInputForward,
  insertInputText,
  locateCursor,
  moveCursorLeft,
  moveCursorRight,
  normalizeInputText,
  wrapInputRows,
} from "./inputBuffer.js";

test("normalizes windows line endings for the composer buffer", () => {
  assert.equal(normalizeInputText("a\r\nb\rc"), "a\nb\nc");
});

test("wraps multiline input into stable viewport rows", () => {
  const rows = wrapInputRows("alpha\nbeta gamma", 5);
  assert.deepEqual(rows.map((row) => row.text), ["alpha", "beta ", "gamma"]);
  assert.deepEqual(rows.map((row) => row.breakType), ["hard", "soft", "end"]);
});

test("keeps the cursor visible by scrolling the composer viewport", () => {
  assert.equal(clampScrollToCursor(0, 7, 4), 4);
});

test("keeps cursor mapping stable at hard newlines and soft wrap boundaries", () => {
  const multilineRows = wrapInputRows("alpha\nbeta", 20);
  assert.deepEqual(locateCursor(multilineRows, 5), { row: 0, column: 5 });
  assert.deepEqual(locateCursor(multilineRows, 6), { row: 1, column: 0 });

  const wrappedRows = wrapInputRows("alpha beta", 5);
  assert.deepEqual(locateCursor(wrappedRows, 5), { row: 0, column: 5 });
  assert.deepEqual(locateCursor(wrappedRows, 6), { row: 1, column: 1 });
});

test("uses code-point-safe cursor movement and deletion", () => {
  const text = "A😀B";
  assert.equal(moveCursorRight(text, 0), 1);
  assert.equal(moveCursorRight(text, 1), 3);
  assert.equal(moveCursorLeft(text, 3), 1);

  const inserted = insertInputText({ value: "A", cursorOffset: 1, text: "\nB" });
  assert.deepEqual(inserted, { value: "A\nB", cursorOffset: 3 });

  const deleted = deleteInputBackward({ value: text, cursorOffset: 3 });
  assert.deepEqual(deleted, { value: "AB", cursorOffset: 1 });

  const forwardDeleted = deleteInputForward({ value: text, cursorOffset: 1 });
  assert.deepEqual(forwardDeleted, { value: "AB", cursorOffset: 1 });
});

test("creates a bounded input viewport for large pasted content", () => {
  const viewport = createInputViewport({
    text: Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join("\n"),
    cursorOffset: "line-1\nline-2\nline-3\nline-4\nline-5\nline-6\nline-7\nline-8\nline-9\nline-10\nline-11\nline-12".length,
    width: 20,
    maxVisibleRows: 4,
  });

  assert.equal(viewport.visibleRows.length, 4);
  assert.equal(viewport.visibleRows[0]?.text, "line-9");
  assert.equal(viewport.visibleRows[3]?.text, "line-12");
});

test("reclamps scroll state when resize reduces the wrapped row count", () => {
  const narrowViewport = createInputViewport({
    text: "alpha beta gamma delta epsilon",
    cursorOffset: "alpha beta gamma delta epsilon".length,
    width: 5,
    maxVisibleRows: 2,
  });

  const wideViewport = createInputViewport({
    text: "alpha beta gamma delta epsilon",
    cursorOffset: "alpha beta gamma delta epsilon".length,
    width: 40,
    maxVisibleRows: 2,
    scrollRow: narrowViewport.scrollRow,
  });

  assert.equal(narrowViewport.scrollRow > 0, true);
  assert.equal(wideViewport.scrollRow, 0);
  assert.deepEqual(wideViewport.visibleRows.map((row) => row.text), ["alpha beta gamma delta epsilon"]);
});

test("strips leaked SGR mouse escape sequence fragments from input", () => {
  const leaked = "[<0;26;24M[<0;26;24m";
  assert.equal(normalizeInputText(leaked), "");

  const partial = "text[<0;26;24Mmore";
  assert.equal(normalizeInputText(partial), "textmore");
});

test("strips leaked bracketed-paste and modified-key fragments from input", () => {
  const leaked = "alpha[200~beta[201~gamma[65;2udelta[109;5uepsilon";
  assert.equal(normalizeInputText(leaked), "alphabetagammadeltaepsilon");
});

test("keeps cursor and wrapping stable when protocol junk is present in the buffer", () => {
  const viewport = createInputViewport({
    text: "alpha[<0;26;24Mbeta[200~gamma[201~delta",
    cursorOffset: "alpha[<0;26;24Mbeta[200~gamma[201~delta".length,
    width: 5,
    maxVisibleRows: 3,
  });

  assert.deepEqual(viewport.rows.map((row) => row.text), ["alpha", "betag", "ammad", "elta"]);
  assert.equal(viewport.cursorRow, 3);
  assert.equal(viewport.cursorColumn, 4);
});

test("robustness: rapid sequential typing and deletion", () => {
  let state = { value: "", cursorOffset: 0 };
  
  // Simulate typing "hello"
  for (const char of "hello") {
    state = insertInputText({ ...state, text: char });
  }
  assert.deepEqual(state, { value: "hello", cursorOffset: 5 });

  // Simulate backspacing "o" and "l"
  state = deleteInputBackward(state);
  state = deleteInputBackward(state);
  assert.deepEqual(state, { value: "hel", cursorOffset: 3 });

  // Simulate inserting "p" in the middle
  state.cursorOffset = 2; // after "e"
  state = insertInputText({ ...state, text: "p" });
  assert.deepEqual(state, { value: "hepl", cursorOffset: 3 });

  // Simulate forward delete of "l"
  state = deleteInputForward(state);
  assert.deepEqual(state, { value: "hep", cursorOffset: 3 });
});
