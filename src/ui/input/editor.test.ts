/// <reference path="../../../node_modules/bun-types/test.d.ts" />
import { expect, test } from "bun:test";
import { InputUndo, lineBoundary, searchHistory, verticalCursor, wordBoundary } from "./editor.js";
import { createAtomicContentToken } from "./pastedContent.js";

test("line boundaries include empty first and final lines", () => {
  expect(lineBoundary("\ntext\n", 0, false)).toBe(0);
  expect(lineBoundary("first\nsecond", 8, false)).toBe(6);
  expect(lineBoundary("first\nsecond", 8, true)).toBe(12);
});
test("visual row movement preserves desired column through short and Unicode rows", () => {
  const text = "abcdef\n字\nabcdef";
  const down = verticalCursor(text, 5, 20, 1);
  expect(down.cursor).toBe(8);
  expect(down.column).toBe(5);
  expect(verticalCursor(text, down.cursor, 20, 1, down.column).cursor).toBe(14);
  expect(verticalCursor(text, 0, 20, -1).boundary).toBe(true);
});
test("wrapped prompts navigate rows before entering history", () => {
  const down = verticalCursor("abcdefgh", 1, 4, 1);
  expect(down.cursor).toBe(5);
  expect(down.boundary).toBe(false);
  expect(verticalCursor("abcdefgh", 5, 4, 1).boundary).toBe(true);
});
test("word movement and deletion preserve attachment boundaries", () => {
  expect(wordBoundary("src/utils.ts --flag=x", 12, -1, true)).toBe(0);
  const token = createAtomicContentToken("[File: src/utils.ts]");
  expect(wordBoundary(token, 0, 1)).toBe(token.length);
});
test("undo groups typing and treats paste as one operation", () => {
  const undo = new InputUndo();
  undo.record({ value: "", cursor: 0 }, { value: "a", cursor: 1 }, 1000);
  undo.record({ value: "a", cursor: 1 }, { value: "ab", cursor: 2 }, 1100);
  undo.record({ value: "ab", cursor: 2 }, { value: "ab pasted", cursor: 9 }, 1200);
  expect(undo.undo()).toEqual({ value: "ab", cursor: 2 });
  expect(undo.undo()).toEqual({ value: "", cursor: 0 });
  expect(searchHistory(["Hello", "world", "hello again"], "HELLO", 1)).toBe("hello again");
});
