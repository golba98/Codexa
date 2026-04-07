import stringWidth from "string-width";
import {
  getDisplayWidth,
  stripAnsi,
  truncateEnd,
  truncateMiddle,
  truncatePath as truncatePathDisplay,
} from "./displayText.js";

interface WindowSlice {
  text: string;
  cursorColumn: number;
}

export interface TextUnit {
  text: string;
  start: number;
  end: number;
  width: number;
}

export interface WrappedTextRow {
  text: string;
  start: number;
  end: number;
  breakType: "soft" | "hard" | "end";
}

export function getCharWidth(char: string): number {
  return Math.max(1, stringWidth(stripAnsi(char)));
}

export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function getTextUnits(text: string): TextUnit[] {
  const units: TextUnit[] = [];
  let offset = 0;

  for (const char of text) {
    const length = char.length;
    units.push({
      text: char,
      start: offset,
      end: offset + length,
      width: getCharWidth(char),
    });
    offset += length;
  }

  return units;
}

export function getTextWidth(text: string): number {
  return getDisplayWidth(text);
}

export { stripAnsi, truncateEnd, truncateMiddle };
export const truncatePath = truncatePathDisplay;

function trimToWidthFromEnd(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  let width = 0;
  const kept: TextUnit[] = [];
  const units = getTextUnits(text);

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]!;
    if (width + unit.width > maxWidth) break;
    kept.unshift(unit);
    width += unit.width;
  }

  return kept.map((unit) => unit.text).join("");
}

function trimToWidthFromStart(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  let width = 0;
  let output = "";

  for (const unit of getTextUnits(text)) {
    if (width + unit.width > maxWidth) break;
    output += unit.text;
    width += unit.width;
  }

  return output;
}

export function flattenInputForDisplay(text: string, cursor: number): { text: string; cursor: number } {
  const normalized = normalizeLineBreaks(text);
  const units = getTextUnits(normalized);
  let output = "";
  let mappedCursor = 0;

  for (const unit of units) {
    if (unit.start === cursor) {
      mappedCursor = output.length;
    }

    if (unit.text === "\n") {
      output += " ↩ ";
      continue;
    }
    if (unit.text === "\t") {
      output += "  ";
      continue;
    }
    output += unit.text;
  }

  if (cursor >= normalized.length) {
    mappedCursor = output.length;
  }

  return { text: output, cursor: mappedCursor };
}

export function createInlineInputWindow(text: string, cursor: number, maxWidth: number): WindowSlice {
  const safeWidth = Math.max(1, maxWidth);
  const flattened = flattenInputForDisplay(text, cursor);
  const units = getTextUnits(flattened.text);
  const charStartWidths: number[] = [];
  let totalWidth = 0;

  for (const unit of units) {
    charStartWidths.push(totalWidth);
    totalWidth += unit.width;
  }

  const cursorWidth = getTextWidth(flattened.text.slice(0, flattened.cursor));
  if (totalWidth <= safeWidth) {
    return { text: flattened.text, cursorColumn: cursorWidth };
  }

  const preferredStart = Math.max(0, cursorWidth - Math.floor(safeWidth * 0.65));
  let windowStart = preferredStart;
  if (windowStart + safeWidth > totalWidth) {
    windowStart = Math.max(0, totalWidth - safeWidth);
  }
  const windowEnd = windowStart + safeWidth;

  let startIndex = 0;
  while (startIndex < units.length && charStartWidths[startIndex]! + units[startIndex]!.width <= windowStart) {
    startIndex += 1;
  }

  let endIndex = startIndex;
  while (endIndex < units.length && charStartWidths[endIndex]! < windowEnd) {
    endIndex += 1;
  }

  let visibleText = units.slice(startIndex, endIndex).map((unit) => unit.text).join("");
  let cursorColumn = Math.max(0, cursorWidth - (charStartWidths[startIndex] ?? 0));
  const truncatedLeft = startIndex > 0;
  const truncatedRight = endIndex < units.length;

  if (truncatedLeft) {
    const ellipsis = "…";
    const available = Math.max(1, safeWidth - getCharWidth(ellipsis) - (truncatedRight ? getCharWidth(ellipsis) : 0));
    visibleText = ellipsis + trimToWidthFromEnd(visibleText, available);
    cursorColumn = Math.min(getTextWidth(visibleText), Math.max(getCharWidth(ellipsis), cursorColumn + getCharWidth(ellipsis)));
  }

  if (truncatedRight) {
    const ellipsis = "…";
    const available = Math.max(1, safeWidth - (truncatedLeft ? getCharWidth(ellipsis) : 0) - getCharWidth(ellipsis));
    const baseText = truncatedLeft ? visibleText.slice(1) : visibleText;
    visibleText = `${truncatedLeft ? "…" : ""}${trimToWidthFromStart(baseText, available)}${ellipsis}`;
  }

  return {
    text: visibleText,
    cursorColumn: Math.max(0, Math.min(getTextWidth(visibleText), cursorColumn)),
  };
}

export function splitTextAtColumn(text: string, column: number): { before: string; current: string; after: string } {
  const safeColumn = Math.max(0, column);
  let width = 0;
  const units = getTextUnits(text);

  for (const unit of units) {
    if (width + unit.width > safeColumn) {
      return {
        before: text.slice(0, unit.start),
        current: unit.text,
        after: text.slice(unit.end),
      };
    }

    width += unit.width;
    if (width > safeColumn) break;
  }

  return {
    before: text,
    current: "",
    after: "",
  };
}

export function wrapTextRows(text: string, maxWidth: number): WrappedTextRow[] {
  const normalized = normalizeLineBreaks(text);
  const safeWidth = Math.max(1, maxWidth);
  const rows: WrappedTextRow[] = [];
  let rowStart = 0;
  let rowText = "";
  let rowWidth = 0;

  for (const unit of getTextUnits(normalized)) {
    if (unit.text === "\n") {
      rows.push({
        text: rowText,
        start: rowStart,
        end: unit.start,
        breakType: "hard",
      });
      rowStart = unit.end;
      rowText = "";
      rowWidth = 0;
      continue;
    }

    if (rowText.length > 0 && rowWidth + unit.width > safeWidth) {
      rows.push({
        text: rowText,
        start: rowStart,
        end: unit.start,
        breakType: "soft",
      });
      rowStart = unit.start;
      rowText = unit.text;
      rowWidth = unit.width;
      continue;
    }

    rowText += unit.text;
    rowWidth += unit.width;
  }

  rows.push({
    text: rowText,
    start: rowStart,
    end: normalized.length,
    breakType: "end",
  });

  return rows.length > 0 ? rows : [{
    text: "",
    start: 0,
    end: 0,
    breakType: "end",
  }];
}

export function wrapPlainText(text: string, maxWidth: number): string[] {
  return wrapTextRows(text, maxWidth).map((row) => row.text);
}
