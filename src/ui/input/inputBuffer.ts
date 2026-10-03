import type { WrappedTextRow } from "../../core/shared/text.js";
import {
  getTextUnits,
  getTextWidth,
  normalizeLineBreaks,
  wrapTextRows,
} from "../../core/shared/text.js";
import { sanitizeTerminalInput } from "../../core/terminal/terminalSanitize.js";
import { findPastedContentSpan } from "./pastedContent.js";

type WrappedInputRow = WrappedTextRow;

interface InputViewport {
  rows: WrappedInputRow[];
  visibleRows: WrappedInputRow[];
  cursorRow: number;
  cursorColumn: number;
  scrollRow: number;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

const LEAKED_SGR_MOUSE_PATTERN = /(?:\x1b)?\[<\d+;\d+;\d+[Mm]/g;

export function normalizeInputText(text: string): string {
  if (!text) return "";
  // Strip out leaked SGR mouse coordinates that might have been emitted by
  // the terminal without their ESC prefix (swallowed by readline).
  const withoutMouse = text.replace(LEAKED_SGR_MOUSE_PATTERN, "");
  return normalizeLineBreaks(sanitizeTerminalInput(withoutMouse));
}

export function stripMouseEscapes(input: string): string {
  return input.replace(LEAKED_SGR_MOUSE_PATTERN, "");
}

export function normalizeCursorOffset(text: string, cursorOffset: number): number {
  const safeCursor = Math.max(0, Math.min(cursorOffset, text.length));

  if (
    safeCursor > 0 &&
    safeCursor < text.length &&
    isHighSurrogate(text.charCodeAt(safeCursor - 1)) &&
    isLowSurrogate(text.charCodeAt(safeCursor))
  ) {
    return safeCursor - 1;
  }

  return safeCursor;
}

// ─── Cursor movement ─────────────────────────────────────────────────────────

export function moveCursorLeft(text: string, cursorOffset: number): number {
  const safeCursor = normalizeCursorOffset(text, cursorOffset);
  if (safeCursor <= 0) return 0;

  let nextCursor = safeCursor - 1;
  if (
    nextCursor > 0 &&
    isLowSurrogate(text.charCodeAt(nextCursor)) &&
    isHighSurrogate(text.charCodeAt(nextCursor - 1))
  ) {
    nextCursor -= 1;
  }

  return nextCursor;
}

export function moveCursorRight(text: string, cursorOffset: number): number {
  const safeCursor = normalizeCursorOffset(text, cursorOffset);
  if (safeCursor >= text.length) return text.length;

  if (
    isHighSurrogate(text.charCodeAt(safeCursor)) &&
    safeCursor + 1 < text.length &&
    isLowSurrogate(text.charCodeAt(safeCursor + 1))
  ) {
    return safeCursor + 2;
  }

  return safeCursor + 1;
}

// ─── Text mutations ───────────────────────────────────────────────────────────

export function insertInputText(params: { value: string; cursorOffset: number; text: string }): {
  value: string;
  cursorOffset: number;
} {
  const value = normalizeInputText(params.value);
  const safeCursor = normalizeCursorOffset(value, params.cursorOffset);
  const insertedText = normalizeInputText(params.text);
  return {
    value: value.slice(0, safeCursor) + insertedText + value.slice(safeCursor),
    cursorOffset: safeCursor + insertedText.length,
  };
}

export function deleteInputBackward(params: { value: string; cursorOffset: number }): {
  value: string;
  cursorOffset: number;
} {
  const value = normalizeInputText(params.value);
  const safeCursor = normalizeCursorOffset(value, params.cursorOffset);

  if (safeCursor <= 0) {
    return { value, cursorOffset: 0 };
  }

  const previousCursor = moveCursorLeft(value, safeCursor);
  return {
    value: value.slice(0, previousCursor) + value.slice(safeCursor),
    cursorOffset: previousCursor,
  };
}

export function deleteInputForward(params: { value: string; cursorOffset: number }): {
  value: string;
  cursorOffset: number;
} {
  const value = normalizeInputText(params.value);
  const safeCursor = normalizeCursorOffset(value, params.cursorOffset);

  if (safeCursor >= value.length) {
    return { value, cursorOffset: safeCursor };
  }

  const nextCursor = moveCursorRight(value, safeCursor);
  return {
    value: value.slice(0, safeCursor) + value.slice(nextCursor),
    cursorOffset: safeCursor,
  };
}

// ─── Viewport ────────────────────────────────────────────────────────────────

export function wrapInputRows(text: string, width: number): WrappedInputRow[] {
  return wrapTextRows(normalizeInputText(text), width);
}

export function locateCursor(rows: WrappedInputRow[], cursorOffset: number) {
  const safeCursor = Math.max(0, cursorOffset);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (safeCursor <= row.end) {
      const relative = Math.max(0, Math.min(safeCursor, row.end) - row.start);
      return {
        row: index,
        column: getTextWidth(row.text.slice(0, relative)),
      };
    }
  }

  const lastRow = rows[rows.length - 1]!;
  return {
    row: rows.length - 1,
    column: getTextWidth(lastRow.text),
  };
}

export function clampScrollToCursor(
  scrollRow: number,
  cursorRow: number,
  visibleRowCount: number,
  totalRowCount = cursorRow + 1,
): number {
  const safeVisibleRows = Math.max(1, visibleRowCount);
  const maxScroll = Math.max(0, totalRowCount - safeVisibleRows);
  let nextScrollRow = Math.max(0, Math.min(scrollRow, maxScroll));

  if (cursorRow < nextScrollRow) {
    nextScrollRow = cursorRow;
  }

  if (cursorRow >= nextScrollRow + safeVisibleRows) {
    nextScrollRow = cursorRow - safeVisibleRows + 1;
  }

  return Math.max(0, Math.min(nextScrollRow, maxScroll));
}

export function createInputViewport(params: {
  text: string;
  cursorOffset: number;
  width: number;
  maxVisibleRows: number;
  scrollRow?: number;
}): InputViewport {
  const rows = wrapInputRows(params.text, params.width);
  const cursor = locateCursor(rows, params.cursorOffset);
  const nextScrollRow = clampScrollToCursor(
    params.scrollRow ?? 0,
    cursor.row,
    params.maxVisibleRows,
    rows.length,
  );

  return {
    rows,
    visibleRows: rows.slice(nextScrollRow, nextScrollRow + Math.max(1, params.maxVisibleRows)),
    cursorRow: cursor.row,
    cursorColumn: cursor.column,
    scrollRow: nextScrollRow,
  };
}

// These values describe the actual bordered row and are shared with its JSX.
export const COMPOSER_ROW_CHROME = {
  borderLeft: 1,
  borderRight: 1,
  paddingLeft: 1,
  paddingRight: 1,
  prompt: "❯ ",
} as const;

export function getComposerRowLayout(totalWidth: number) {
  const chrome = COMPOSER_ROW_CHROME;
  const bodyWidth = Math.max(
    0,
    totalWidth - chrome.borderLeft - chrome.borderRight - chrome.paddingLeft - chrome.paddingRight,
  );
  const promptWidth = getTextWidth(chrome.prompt);
  return { bodyWidth, promptWidth, editorWidth: Math.max(0, bodyWidth - promptWidth) };
}

/** Bound a wrapped row, including its highlighted character or trailing cursor. */
export function createInputRowWindow(text: string, width: number, cursorColumn?: number) {
  const safeWidth = Math.max(0, width);
  if (safeWidth === 0) return { before: "", current: "", after: "", cursorColumn: 0 };
  // Ink advances at least one cell per emitted grapheme, even for invisible
  // token IDs. Keep zero-cell units in the buffer, but never send them to Ink.
  const units = getTextUnits(text).filter((unit) => unit.width > 0);
  let column = 0;
  let cursorIndex = units.length;
  const columns = units.map((unit, index) => {
    const start = column;
    if (
      cursorColumn !== undefined &&
      cursorIndex === units.length &&
      unit.width > 0 &&
      start + unit.width > cursorColumn
    )
      cursorIndex = index;
    column += unit.width;
    return start;
  });
  const hasCursor = cursorColumn !== undefined;
  const cursorStart = columns[cursorIndex] ?? column;
  const current = hasCursor ? (units[cursorIndex]?.text ?? " ") : "";
  const cursorWidth = getTextWidth(current);
  // A wide glyph cannot fit in a one-cell viewport: show a cursor cell instead.
  if (cursorWidth > safeWidth) return { before: "", current: " ", after: "", cursorColumn: 0 };
  let startIndex = 0;
  if (hasCursor) {
    const minimumStart = Math.max(0, cursorStart + cursorWidth - safeWidth);
    while (startIndex < cursorIndex && (columns[startIndex] ?? column) < minimumStart) startIndex++;
  }
  let used = 0;
  let before = "";
  let after = "";
  for (let index = startIndex; index < units.length; index++) {
    const unit = units[index]!;
    if (used + unit.width > safeWidth) break;
    if (!hasCursor || index < cursorIndex) before += unit.text;
    else if (index > cursorIndex) after += unit.text;
    used += unit.width;
  }
  return { before, current, after, cursorColumn: getTextWidth(before) };
}

interface Draft {
  value: string;
  cursor: number;
}
function atomicOffset(value: string, offset: number, direction: number): number {
  const span = findPastedContentSpan(value, offset);
  return span && offset > span.start && offset < span.end
    ? direction < 0
      ? span.start
      : span.end
    : normalizeCursorOffset(value, offset);
}
export function lineBoundary(value: string, cursor: number, end: boolean): number {
  if (!end) return cursor === 0 ? 0 : value.lastIndexOf("\n", cursor - 1) + 1;
  const next = value.indexOf("\n", cursor);
  return next < 0 ? value.length : next;
}
export function wordBoundary(
  value: string,
  cursor: number,
  direction: number,
  whitespace = false,
): number {
  const word = whitespace ? /\S/u : /[\p{L}\p{N}]/u;
  const characters = Array.from(value);
  const positions = [0];
  for (const char of characters) positions.push(positions.at(-1)! + char.length);
  let index = positions.findIndex((position) => position >= cursor);
  if (index < 0) index = characters.length;
  if (direction < 0) {
    while (index > 0 && !word.test(characters[index - 1]!)) index--;
    while (index > 0 && word.test(characters[index - 1]!)) index--;
  } else {
    while (index < characters.length && !word.test(characters[index]!)) index++;
    while (index < characters.length && word.test(characters[index]!)) index++;
  }
  const offset = positions[index]!;
  return atomicOffset(value, offset, direction);
}
export function verticalCursor(
  value: string,
  cursor: number,
  width: number,
  direction: number,
  desiredColumn?: number,
): { cursor: number; column: number; boundary: boolean } {
  const rows = wrapInputRows(value, width);
  const position = locateCursor(rows, cursor);
  const column = desiredColumn ?? position.column;
  const row = rows[position.row + direction];
  if (!row) return { cursor, column, boundary: true };
  let offset = row.start;
  for (const char of row.text) {
    if (getTextWidth(value.slice(row.start, offset) + char) > column) break;
    offset += char.length;
  }
  return { cursor: atomicOffset(value, offset, direction), column, boundary: false };
}
export class InputUndo {
  private entries: Draft[] = [];
  private lastEdit = 0;
  private lastValue = "";
  record(before: Draft, after: Draft, now = Date.now()): void {
    if (before.value === after.value) return;
    const typing = after.value.length === before.value.length + 1;
    if (
      !typing ||
      now - this.lastEdit > 600 ||
      before.value !== this.lastValue ||
      this.entries.length === 0
    ) {
      this.entries.push({ ...before });
      if (this.entries.length > 100) this.entries.shift();
    }
    this.lastEdit = typing ? now : 0;
    this.lastValue = after.value;
  }
  undo(): Draft | undefined {
    this.lastEdit = 0;
    this.lastValue = "";
    return this.entries.pop();
  }
}
export function searchHistory(
  history: readonly string[],
  query: string,
  offset = 0,
): string | undefined {
  return history.filter((item) => item.toLowerCase().includes(query.toLowerCase()))[offset];
}
