import { getTextWidth, splitTextAtColumn } from "../../../core/shared/text.js";
import {
  _blankRowCache,
  _rowContentCache,
  _wrappedBlankRowCache,
  _wrappedRowCache,
  rememberRow,
} from "./caches.js";
import type {
  BuiltTimelineItem,
  StyledToken,
  TimelineRow,
  TimelineRowFrame,
  TimelineRowSpan,
  TimelineSnapshot,
  TimelineTone,
} from "./types.js";

// Logo rows for the intro item — selected dynamically from logoVariants.ts so
// the dead-code intro path stays consistent with the live TopHeader rendering.

// Matches sentence-ending punctuation followed (optionally after whitespace) by
// a capital letter starting a new word. Requires [A-Z] to be followed by [a-z]
// OR to be a standalone "I" (I'm / I've / I ) so abbreviations like U.S.A.
// and Python class names like foo.BarClass are left alone — the lookahead
// fails when the capital is followed by another uppercase or punctuation.
const SENTENCE_WALL_SPLIT_RE = /([.!?])\s*(?=(?:I(?:['\u2019]|\s)|[A-Z][a-z]))/g;

export function splitSentenceWall(text: string): string {
  if (!text) return text;
  // Preserve code fences: only transform outside ``` regions.
  const parts = text.split("```");
  return parts
    .map((part, index) => (index % 2 === 0 ? part.replace(SENTENCE_WALL_SPLIT_RE, "$1\n\n") : part))
    .join("```");
}

// ─── Span & row primitives ────────────────────────────────────────────────────

export function createSpan(
  text: string,
  tone?: TimelineTone,
  options: Pick<TimelineRowSpan, "bold" | "backgroundTone"> = {},
): TimelineRowSpan {
  return {
    text,
    tone,
    bold: options.bold,
    backgroundTone: options.backgroundTone,
  };
}

function spansEqual(left: TimelineRowSpan | undefined, right: TimelineRowSpan): boolean {
  return (
    left?.tone === right.tone &&
    left?.bold === right.bold &&
    left?.backgroundTone === right.backgroundTone
  );
}

export function appendSpan(target: TimelineRowSpan[], span: TimelineRowSpan) {
  if (!span.text) return;
  const previous = target[target.length - 1];
  if (previous && spansEqual(previous, span)) {
    previous.text += span.text;
    return;
  }
  target.push({ ...span });
}

function cloneSpan(span: TimelineRowSpan, text = span.text): TimelineRowSpan {
  return {
    text,
    tone: span.tone,
    bold: span.bold,
    backgroundTone: span.backgroundTone,
  };
}

export function getSpansWidth(spans: TimelineRowSpan[]): number {
  return spans.reduce((width, span) => width + getTextWidth(span.text), 0);
}

export function padSpansToWidth(spans: TimelineRowSpan[], width: number): TimelineRowSpan[] {
  const safeWidth = Math.max(0, width);
  const next = spans.map((span) => ({ ...span }));
  const currentWidth = getSpansWidth(next);
  if (currentWidth < safeWidth) {
    appendSpan(next, createSpan(" ".repeat(safeWidth - currentWidth)));
  }
  return next;
}

/**
 * Truncates a span list to at most `width` display columns, cutting the
 * overflowing span on a grapheme/display-width boundary. Used as a safety net so
 * a too-wide content row can never push a card border past its declared width.
 */
function clampSpansToWidth(spans: TimelineRowSpan[], width: number): TimelineRowSpan[] {
  const safeWidth = Math.max(0, width);
  const result: TimelineRowSpan[] = [];
  let used = 0;
  for (const span of spans) {
    if (used >= safeWidth) break;
    const spanWidth = getTextWidth(span.text);
    if (used + spanWidth <= safeWidth) {
      result.push({ ...span });
      used += spanWidth;
      continue;
    }
    const fitted = splitTextAtColumn(span.text, safeWidth - used).before;
    if (fitted) {
      result.push(cloneSpan(span, fitted));
    }
    break;
  }
  return result;
}

/** Clamp a row to `width` then pad it back out so it occupies exactly `width`. */
export function fitSpansToWidth(spans: TimelineRowSpan[], width: number): TimelineRowSpan[] {
  return padSpansToWidth(clampSpansToWidth(spans, width), width);
}

function spanCacheToken(span: TimelineRowSpan): string {
  return [span.text, span.tone ?? "", span.backgroundTone ?? "", span.bold ? "1" : "0"].join(
    "\u001f",
  );
}

export function createRow(
  key: string,
  spans: TimelineRowSpan[],
  width: number,
  frame?: TimelineRowFrame,
): TimelineRow {
  const paddedSpans = padSpansToWidth(spans, width);
  const frameToken = frame ? `${frame.id}\u001f${frame.role}` : "";
  const cacheKey = `${key}:${width}:${frameToken}:${paddedSpans.map(spanCacheToken).join("\u001e")}`;
  const cached = _rowContentCache.get(cacheKey);
  if (cached) {
    _rowContentCache.delete(cacheKey);
    _rowContentCache.set(cacheKey, cached);
    return cached;
  }

  return rememberRow(
    cacheKey,
    frame ? { key, spans: paddedSpans, frame } : { key, spans: paddedSpans },
  );
}

export function createBlankRow(key: string, width: number): TimelineRow {
  const cacheKey = `${key}:${width}`;
  let row = _blankRowCache.get(cacheKey);
  if (!row) {
    row = createRow(key, [createSpan(" ".repeat(Math.max(0, width)))], width);
    _blankRowCache.set(cacheKey, row);
  }
  return row;
}

function flattenSpansToTokens(spans: TimelineRowSpan[]): StyledToken[] {
  const tokens: StyledToken[] = [];
  for (const span of spans) {
    const parts = span.text.split(/([ \t\n]+)/);
    for (const part of parts) {
      if (part === "") continue;
      const isNewline = part === "\n" || (part.includes("\n") && /^[\s]+$/.test(part));
      const isWhitespace = /^[ \t\n]+$/.test(part);
      tokens.push({
        text: part,
        isWhitespace,
        isNewline,
        tone: span.tone,
        bold: span.bold,
        backgroundTone: span.backgroundTone,
      });
    }
  }
  return tokens;
}

export function wrapStyledSpans(spans: TimelineRowSpan[], width: number): TimelineRowSpan[][] {
  const safeWidth = Math.max(1, width);
  const rows: TimelineRowSpan[][] = [];
  let currentRow: TimelineRowSpan[] = [];
  let currentWidth = 0;

  const pushRow = () => {
    rows.push(currentRow.length > 0 ? currentRow : [createSpan("")]);
    currentRow = [];
    currentWidth = 0;
  };

  const spanFor = (token: StyledToken, text: string): TimelineRowSpan => ({
    text,
    ...(token.tone !== undefined ? { tone: token.tone } : {}),
    ...(token.bold ? { bold: token.bold } : {}),
    ...(token.backgroundTone !== undefined ? { backgroundTone: token.backgroundTone } : {}),
  });

  for (const token of flattenSpansToTokens(spans)) {
    if (token.isNewline) {
      pushRow();
      continue;
    }

    const tokenWidth = getTextWidth(token.text);

    if (token.isWhitespace) {
      if (currentWidth === 0) continue; // skip leading whitespace on a new row
      if (currentWidth + tokenWidth > safeWidth) {
        pushRow();
        continue; // drop whitespace that pushes us over the edge
      }
      appendSpan(currentRow, spanFor(token, token.text));
      currentWidth += tokenWidth;
      continue;
    }

    // Word token
    if (currentWidth + tokenWidth > safeWidth && currentWidth > 0) {
      pushRow();
    }

    // Overlong token: character-split across as many rows as needed
    if (tokenWidth > safeWidth) {
      let remaining = token.text;
      let remainingWidth = tokenWidth;
      while (remainingWidth > safeWidth - currentWidth) {
        const available = safeWidth - currentWidth;
        const split = splitTextAtColumn(remaining, available);
        if (split.before) {
          appendSpan(currentRow, spanFor(token, split.before));
        }
        pushRow();
        remaining = split.current + split.after;
        remainingWidth = getTextWidth(remaining);
      }
      if (remaining) {
        appendSpan(currentRow, spanFor(token, remaining));
        currentWidth += getTextWidth(remaining);
      }
      continue;
    }

    appendSpan(currentRow, spanFor(token, token.text));
    currentWidth += tokenWidth;
  }

  if (currentRow.length === 0 && rows.length === 0) {
    rows.push([createSpan("")]);
  } else if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

export function buildPrefixedContentRows(
  keyPrefix: string,
  marker: TimelineRowSpan[],
  continuationMarker: TimelineRowSpan[],
  content: TimelineRowSpan[],
  width: number,
): TimelineRow[] {
  const markerWidth = Math.max(0, getSpansWidth(marker));
  const bodyWidth = Math.max(1, width - markerWidth);
  const wrappedRows = wrapStyledSpans(content, bodyWidth);

  return wrappedRows.map((row, index) =>
    createRow(
      `${keyPrefix}-${index}`,
      [...(index === 0 ? marker : continuationMarker), ...padSpansToWidth(row, bodyWidth)],
      width,
    ),
  );
}

// ─── Border & card builders ───────────────────────────────────────────────────

export function buildIndentedRows(
  keyPrefix: string,
  rows: TimelineRowSpan[][],
  width: number,
  indent: number,
): TimelineRow[] {
  const safeIndent = Math.max(0, indent);
  const contentWidth = Math.max(1, width - safeIndent);
  return rows.map((row, index) =>
    createRow(
      `${keyPrefix}-${index}`,
      [createSpan(" ".repeat(safeIndent)), ...padSpansToWidth(row, contentWidth)],
      width,
    ),
  );
}

export function __wrapStyledSpansForTests(
  spans: TimelineRowSpan[],
  width: number,
): TimelineRowSpan[][] {
  return wrapStyledSpans(spans, width);
}

export function wrapRows(
  rows: TimelineRow[],
  totalWidth: number,
  padded: boolean,
  keyPrefix: string,
  includeMargin: boolean,
): TimelineRow[] {
  const leftPad = padded ? 1 : 0;
  const innerWidth = Math.max(1, totalWidth - leftPad * 2);
  const prefixedRows = rows.map((row) => {
    const cacheKey = `${keyPrefix}:${row.key}:${totalWidth}:${innerWidth}:${leftPad}`;
    let rowCache = _wrappedRowCache.get(row);
    if (!rowCache) {
      rowCache = new Map<string, TimelineRow>();
      _wrappedRowCache.set(row, rowCache);
    }

    const cached = rowCache.get(cacheKey);
    if (cached) return cached;

    const wrapped = createRow(
      `${keyPrefix}-wrapped-${row.key}`,
      [
        ...(leftPad > 0 ? [createSpan(" ".repeat(leftPad))] : []),
        ...padSpansToWidth(row.spans, innerWidth),
        ...(leftPad > 0 ? [createSpan(" ".repeat(leftPad))] : []),
      ],
      totalWidth,
      // Frame metadata must survive wrapping: the live-row window reads it to
      // avoid slicing a card open.
      row.frame,
    );
    rowCache.set(cacheKey, wrapped);
    return wrapped;
  });

  if (includeMargin) {
    const marginKey = `${keyPrefix}:${totalWidth}:margin`;
    let margin = _wrappedBlankRowCache.get(marginKey);
    if (!margin) {
      margin = createBlankRow(`${keyPrefix}-margin`, totalWidth);
      _wrappedBlankRowCache.set(marginKey, margin);
    }
    prefixedRows.push(margin);
  }
  return prefixedRows;
}

export function wrapItemRows(
  rows: TimelineRow[],
  totalWidth: number,
  padded: boolean,
  keyPrefix: string,
): TimelineRow[] {
  return wrapRows(rows, totalWidth, padded, keyPrefix, true);
}

export function rowsToSnapshot(items: BuiltTimelineItem[]): TimelineSnapshot {
  const rows = items.flatMap((item) => item.rows);
  return {
    items,
    rows,
    totalRows: rows.length,
    itemCount: items.length,
  };
}
