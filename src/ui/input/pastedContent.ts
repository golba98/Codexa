export const LARGE_PASTE_THRESHOLD = 1_000;

export const PASTED_CONTENT_PATTERN = /\[Pasted Content ([\d,]+) chars\](?:\u2063[\uFE00-\uFE09]+\u2063)?/g;

let nextPasteId = 1;

export function countCharacters(value: string): number {
  return Array.from(value).length;
}

export function createPastedContentLabel(value: string): string {
  return `[Pasted Content ${countCharacters(value).toLocaleString("en-US")} chars]`;
}

function encodeInvisibleId(value: number): string {
  return String(value).split("").map((digit) => String.fromCharCode(0xFE00 + Number(digit))).join("");
}

export function createPastedContentToken(value: string): string {
  const label = createPastedContentLabel(value);
  const id = encodeInvisibleId(nextPasteId++);
  return `${label}\u2063${id}\u2063`;
}

export function isLargePaste(value: string): boolean {
  return countCharacters(value) >= LARGE_PASTE_THRESHOLD;
}

export type PastedContentRegistry = Map<string, string[]>;

export function expandPastedContent(value: string, registry: PastedContentRegistry): string {
  const offsets = new Map<string, number>();
  return value.replace(PASTED_CONTENT_PATTERN, (label) => {
    const values = registry.get(label);
    const offset = offsets.get(label) ?? 0;
    offsets.set(label, offset + 1);
    return values?.[offset] ?? label;
  });
}

export function findPastedContentSpan(value: string, cursor: number) {
  PASTED_CONTENT_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(PASTED_CONTENT_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (cursor >= start && cursor <= end) return { start, end };
  }
  return null;
}

export function moveAcrossPastedContent(value: string, cursor: number, direction: "left" | "right"): number | null {
  const span = findPastedContentSpan(value, cursor);
  if (!span) return null;
  if (direction === "left" && cursor > span.start) return span.start;
  if (direction === "right" && cursor < span.end) return span.end;
  return null;
}

export function deleteAdjacentPastedContent(value: string, cursor: number, direction: "backward" | "forward") {
  PASTED_CONTENT_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(PASTED_CONTENT_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const adjacent = direction === "backward" ? cursor === end : cursor === start;
    if (adjacent || (cursor > start && cursor < end)) {
      return { value: value.slice(0, start) + value.slice(end), cursorOffset: start };
    }
  }
  return null;
}
