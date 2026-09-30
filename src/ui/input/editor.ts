import { getTextWidth } from "../render/textLayout.js";
import { locateCursor, wrapInputRows, normalizeCursorOffset } from "./inputBuffer.js";
import { findPastedContentSpan } from "./pastedContent.js";

export interface Draft { value: string; cursor: number }
export function atomicOffset(value: string, offset: number, direction: number): number {
  const span = findPastedContentSpan(value, offset);
  return span && offset > span.start && offset < span.end ? direction < 0 ? span.start : span.end : normalizeCursorOffset(value, offset);
}
export function lineBoundary(value: string, cursor: number, end: boolean): number {
  if (!end) return cursor === 0 ? 0 : value.lastIndexOf("\n", cursor - 1) + 1;
  const next = value.indexOf("\n", cursor);
  return next < 0 ? value.length : next;
}
export function wordBoundary(value: string, cursor: number, direction: number, whitespace = false): number {
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
export function verticalCursor(value: string, cursor: number, width: number, direction: number, desiredColumn?: number): { cursor: number; column: number; boundary: boolean } {
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
    if (!typing || now - this.lastEdit > 600 || before.value !== this.lastValue || this.entries.length === 0) {
      this.entries.push({ ...before });
      if (this.entries.length > 100) this.entries.shift();
    }
    this.lastEdit = typing ? now : 0;
    this.lastValue = after.value;
  }
  undo(): Draft | undefined { this.lastEdit = 0; this.lastValue = ""; return this.entries.pop(); }
}
export function searchHistory(history: readonly string[], query: string, offset = 0): string | undefined {
  return history.filter((item) => item.toLowerCase().includes(query.toLowerCase()))[offset];
}
