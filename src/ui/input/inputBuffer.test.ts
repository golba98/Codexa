import assert from "node:assert/strict";
import test from "node:test";
import { getTextWidth, splitTextAtColumn } from "../../core/shared/text.js";
import {
  COMPOSER_ROW_CHROME,
  clampScrollToCursor,
  createInputRowWindow,
  createInputViewport,
  deleteInputBackward,
  deleteInputForward,
  getComposerRowLayout,
  insertInputText,
  locateCursor,
  moveCursorLeft,
  moveCursorRight,
  normalizeInputText,
  stripMouseEscapes,
  wrapInputRows,
} from "./inputBuffer.js";
import {
  createAtomicContentToken,
  createImageAttachmentToken,
  deleteAdjacentPastedContent,
  moveAcrossPastedContent,
} from "./pastedContent.js";

test("normalizes windows line endings for the composer buffer", () => {
  assert.equal(normalizeInputText("a\r\nb\rc"), "a\nb\nc");
});

test("wraps multiline input into stable viewport rows", () => {
  const rows = wrapInputRows("alpha\nbeta gamma", 5);
  assert.deepEqual(
    rows.map((row) => row.text),
    ["alpha", "beta", "gamma"],
  );
  assert.deepEqual(
    rows.map((row) => row.breakType),
    ["hard", "soft", "end"],
  );
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
  assert.deepEqual(locateCursor(wrappedRows, 6), { row: 1, column: 0 });
});

test("keeps words intact and maps skipped wrap whitespace to the continuation row", () => {
  const rows = wrapInputRows("say was", 6);
  assert.deepEqual(
    rows.map((row) => row.text),
    ["say", "was"],
  );
  assert.deepEqual(locateCursor(rows, 4), { row: 1, column: 0 });
  assert.deepEqual(locateCursor(rows, 7), { row: 1, column: 3 });
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
    cursorOffset:
      "line-1\nline-2\nline-3\nline-4\nline-5\nline-6\nline-7\nline-8\nline-9\nline-10\nline-11\nline-12"
        .length,
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
  assert.deepEqual(
    wideViewport.visibleRows.map((row) => row.text),
    ["alpha beta gamma delta epsilon"],
  );
});

test("strips leaked SGR mouse escape sequence fragments from input", () => {
  const leaked = "[<0;26;24M[<0;26;24m";
  assert.equal(normalizeInputText(leaked), "");

  const partial = "text[<0;26;24Mmore";
  assert.equal(normalizeInputText(partial), "textmore");
});

test("stripMouseEscapes: removes complete SGR sequences (ESC-prefixed)", () => {
  assert.equal(stripMouseEscapes("\x1b[<0;83;19M"), "");
  assert.equal(stripMouseEscapes("\x1b[<64;83;19M"), "");
  assert.equal(stripMouseEscapes("\x1b[<64;83;19m"), ""); // lowercase m
});

test("stripMouseEscapes: removes leaked SGR fragments (ESC already stripped by readline)", () => {
  assert.equal(stripMouseEscapes("[<0;83;19M"), "");
});

test("stripMouseEscapes: strips mouse sequences embedded in surrounding text", () => {
  assert.equal(stripMouseEscapes("hello\x1b[<0;83;19M"), "hello");
  assert.equal(stripMouseEscapes("\x1b[<0;83;19Mhello"), "hello");
  assert.equal(stripMouseEscapes("hello[<64;83;19Mworld"), "helloworld");
});

test("stripMouseEscapes: preserves normal text and returns it unchanged", () => {
  assert.equal(stripMouseEscapes("hello world"), "hello world");
  assert.equal(stripMouseEscapes("git status"), "git status");
  assert.equal(stripMouseEscapes(""), "");
  assert.equal(stripMouseEscapes("I"), "I");
  assert.equal(stripMouseEscapes("yes"), "yes");
});

// NOTE: Partial chunk splitting (e.g. "\x1b[<0;" then "83;19M" as two separate writes)
// is not filterable at the string level — each chunk alone does not match the pattern.
// Robust partial-chunk handling requires stateful stdin buffering (not implemented here
// or in BottomComposer). In practice, terminals send mouse sequences as atomic stdin
// writes so this case does not arise in normal usage.

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

test("cursor highlight tracks the real character when moving right past an image token", () => {
  const token = createImageAttachmentToken({
    path: "/tmp/a.png",
    name: "clipboard-image.png",
    mediaType: "image/png",
    bytes: 1,
  });
  const value = `look at ${token} please`;
  let cursor = "look at ".length;
  const highlighted: string[] = [];

  while (cursor < value.length) {
    cursor = moveAcrossPastedContent(value, cursor, "right") ?? moveCursorRight(value, cursor);
    const viewport = createInputViewport({
      text: value,
      cursorOffset: cursor,
      width: 80,
      maxVisibleRows: 5,
    });
    const row = viewport.visibleRows[viewport.cursorRow - viewport.scrollRow]!;
    const { current } = splitTextAtColumn(row.text, viewport.cursorColumn);
    assert.equal(current, value[cursor] ?? "", `cursor ${cursor}`);
    highlighted.push(current);
  }

  assert.deepEqual(highlighted, [" ", "p", "l", "e", "a", "s", "e", ""]);
});

test("composer geometry accounts for the border, padding and measured prompt", () => {
  for (const width of [20, 80, 115, 120, 240]) {
    const row = getComposerRowLayout(width);
    const chrome = COMPOSER_ROW_CHROME;
    assert.equal(
      row.editorWidth +
        row.promptWidth +
        chrome.paddingLeft +
        chrome.paddingRight +
        chrome.borderLeft +
        chrome.borderRight,
      width,
    );
    assert.equal(row.promptWidth, getTextWidth(chrome.prompt));
  }
  assert.equal(getComposerRowLayout(115).editorWidth, 109);
  assert.equal(getComposerRowLayout(5).editorWidth, 0);
});

test("row windows reserve the cursor at full-width boundaries without losing its character", () => {
  assert.deepEqual(createInputRowWindow("", 4, 0), {
    before: "",
    current: " ",
    after: "",
    cursorColumn: 0,
  });
  assert.deepEqual(createInputRowWindow("abcd", 4, 4), {
    before: "bcd",
    current: " ",
    after: "",
    cursorColumn: 3,
  });
  assert.deepEqual(createInputRowWindow("abcdefgh", 4, 0), {
    before: "",
    current: "a",
    after: "bcd",
    cursorColumn: 0,
  });
  assert.deepEqual(createInputRowWindow("abcdefgh", 4, 4), {
    before: "bcd",
    current: "e",
    after: "",
    cursorColumn: 3,
  });
  assert.deepEqual(createInputRowWindow("abcdefgh", 4, 8), {
    before: "fgh",
    current: " ",
    after: "",
    cursorColumn: 3,
  });
  assert.equal(createInputRowWindow("abcdefgh", 4).before, "abcd");
});

test("pasted content and following input share the bounded viewport at every cursor position", () => {
  const token = createAtomicContentToken("[Pasted Content 22,703 chars]");
  for (const width of [20, 40, 80, 115, 120]) {
    const { editorWidth } = getComposerRowLayout(width);
    for (const value of ["", "hello", `${token} short`, `${token} ${"abcdefghij".repeat(20)}`]) {
      for (const cursor of [0, token.length, Math.floor(value.length / 2), value.length]) {
        const viewport = createInputViewport({
          text: value,
          cursorOffset: Math.min(cursor, value.length),
          width: editorWidth,
          maxVisibleRows: 5,
        });
        viewport.visibleRows.forEach((row, index) => {
          const active = index === viewport.cursorRow - viewport.scrollRow;
          const window = createInputRowWindow(
            row.text,
            editorWidth,
            active ? viewport.cursorColumn : undefined,
          );
          assert.ok(getTextWidth(window.before + window.current + window.after) <= editorWidth);
          if (active) {
            assert.ok(getTextWidth(window.current) > 0);
            assert.ok(window.cursorColumn + getTextWidth(window.current) <= editorWidth);
            const expected = splitTextAtColumn(row.text, viewport.cursorColumn).current || " ";
            assert.equal(window.current, expected);
          }
        });
      }
    }
  }
});

test("deleting a pasted token immediately restores room for editable text", () => {
  const token = createAtomicContentToken("[Pasted Content 22,703 chars]");
  const value = `${token} hello`;
  const width = getComposerRowLayout(40).editorWidth;
  const initial = createInputViewport({
    text: value,
    cursorOffset: value.length,
    width,
    maxVisibleRows: 5,
  });
  const deleted = deleteAdjacentPastedContent(value, token.length, "backward")!;
  const next = createInputViewport({
    text: deleted.value,
    cursorOffset: deleted.value.length,
    width,
    maxVisibleRows: 5,
  });
  assert.ok(initial.rows.length > next.rows.length);
  assert.equal(next.rows[0]?.text, " hello");
  assert.equal(createInputRowWindow(next.rows[0]!.text, width, next.cursorColumn).before, " hello");
});

test("row windows handle display cells and indivisible graphemes", () => {
  for (const text of [
    "字字字",
    "e\u0301e\u0301e\u0301",
    "👩‍💻👩‍💻👩‍💻",
    "😀abc",
    "\u2063\uFE01\u2063abc",
  ]) {
    for (const width of [1, 2, 3, 4, 8]) {
      for (const cursor of [0, getTextWidth(text) / 2, getTextWidth(text)]) {
        const window = createInputRowWindow(text, width, cursor);
        assert.ok(getTextWidth(window.before + window.current + window.after) <= width);
        assert.ok(window.cursorColumn + getTextWidth(window.current) <= width);
        assert.ok(getTextWidth(window.current) > 0);
      }
    }
  }
  assert.deepEqual(createInputRowWindow("字", 1, 0), {
    before: "",
    current: " ",
    after: "",
    cursorColumn: 0,
  });
  assert.equal(createInputRowWindow("e\u0301x", 2, 0).current, "e\u0301");
  assert.equal(createInputRowWindow("👩‍💻x", 3, 0).current, "👩‍💻");
});

test("resize reclamps rendered cursor windows and vertical scrolling together", () => {
  const value =
    createAtomicContentToken("[Pasted Content 22,703 chars]") + " " + "abcdefghij".repeat(20);
  let scrollRow = 0;
  for (const width of [120, 20, 80, 40, 240]) {
    const { editorWidth } = getComposerRowLayout(width);
    const viewport = createInputViewport({
      text: value,
      cursorOffset: value.length,
      width: editorWidth,
      maxVisibleRows: 5,
      scrollRow,
    });
    scrollRow = viewport.scrollRow;
    const row = viewport.visibleRows[viewport.cursorRow - scrollRow]!;
    const window = createInputRowWindow(row.text, editorWidth, viewport.cursorColumn);
    assert.equal(window.current, " ");
    assert.ok(window.cursorColumn < editorWidth);
    assert.ok(getTextWidth(window.before + window.current + window.after) <= editorWidth);
  }
  assert.equal(scrollRow, 0);
});
