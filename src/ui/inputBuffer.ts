import type { WrappedTextRow } from "./textLayout.js";
import { getTextWidth, normalizeLineBreaks, wrapTextRows } from "./textLayout.js";
import { sanitizeTerminalInput } from "../core/terminalSanitize.js";

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

export function normalizeInputText(text: string): string {
  return normalizeLineBreaks(sanitizeTerminalInput(text));
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

export function getComposerBodyWidth(totalWidth: number): number {
  return Math.max(4, totalWidth - 4);
}
