import type { WrappedTextRow } from "../render/textLayout.js";
import { getTextUnits, getTextWidth, normalizeLineBreaks, wrapTextRows } from "../render/textLayout.js";
import { sanitizeTerminalInput } from "../../core/terminal/terminalSanitize.js";

export type WrappedInputRow = WrappedTextRow;

export interface InputViewport {
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
    safeCursor > 0
    && safeCursor < text.length
    && isHighSurrogate(text.charCodeAt(safeCursor - 1))
    && isLowSurrogate(text.charCodeAt(safeCursor))
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
  if (nextCursor > 0 && isLowSurrogate(text.charCodeAt(nextCursor)) && isHighSurrogate(text.charCodeAt(nextCursor - 1))) {
    nextCursor -= 1;
  }

  return nextCursor;
}

export function moveCursorRight(text: string, cursorOffset: number): number {
  const safeCursor = normalizeCursorOffset(text, cursorOffset);
  if (safeCursor >= text.length) return text.length;

  if (
    isHighSurrogate(text.charCodeAt(safeCursor))
    && safeCursor + 1 < text.length
    && isLowSurrogate(text.charCodeAt(safeCursor + 1))
  ) {
    return safeCursor + 2;
  }

  return safeCursor + 1;
}

// ─── Text mutations ───────────────────────────────────────────────────────────

export function insertInputText(params: {
  value: string;
  cursorOffset: number;
  text: string;
}): { value: string; cursorOffset: number } {
  const value = normalizeInputText(params.value);
  const safeCursor = normalizeCursorOffset(value, params.cursorOffset);
  const insertedText = normalizeInputText(params.text);
  return {
    value: value.slice(0, safeCursor) + insertedText + value.slice(safeCursor),
    cursorOffset: safeCursor + insertedText.length,
  };
}

export function deleteInputBackward(params: {
  value: string;
  cursorOffset: number;
}): { value: string; cursorOffset: number } {
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

export function deleteInputForward(params: {
  value: string;
  cursorOffset: number;
}): { value: string; cursorOffset: number } {
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
  const nextScrollRow = clampScrollToCursor(params.scrollRow ?? 0, cursor.row, params.maxVisibleRows, rows.length);

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
  const bodyWidth = Math.max(0, totalWidth - chrome.borderLeft - chrome.borderRight
    - chrome.paddingLeft - chrome.paddingRight);
  const promptWidth = getTextWidth(chrome.prompt);
  return { bodyWidth, promptWidth, editorWidth: Math.max(0, bodyWidth - promptWidth) };
}

export function getComposerBodyWidth(totalWidth: number): number {
  return getComposerRowLayout(totalWidth).bodyWidth;
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
    if (cursorColumn !== undefined && cursorIndex === units.length
      && unit.width > 0 && start + unit.width > cursorColumn) cursorIndex = index;
    column += unit.width;
    return start;
  });
  const hasCursor = cursorColumn !== undefined;
  const cursorStart = columns[cursorIndex] ?? column;
  const current = hasCursor ? units[cursorIndex]?.text ?? " " : "";
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
