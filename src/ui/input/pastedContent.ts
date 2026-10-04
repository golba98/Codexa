import type { ProviderImageAttachment } from "../../core/providerRuntime/types.js";

const LARGE_PASTE_THRESHOLD = 1_000;

const PASTED_CONTENT_PATTERN =
  /\[Pasted Content ([\d,]+) chars\](?:\u2063[\uFE00-\uFE09]+\u2063)?/g;
export const IMAGE_ATTACHMENT_PATTERN = /\[Image: ([^\]\n]+)\](?:\u2063[\uFE00-\uFE09]+\u2063)?/g;
const ATOMIC_CONTENT_PATTERN =
  /(?:\[Pasted Content [\d,]+ chars\]|\[(?:Image|File): [^\]\n]+\])(?:\u2063[\uFE00-\uFE09]+\u2063)?/g;

let nextPasteId = Date.now() * 1000;

function countCharacters(value: string): number {
  return Array.from(value).length;
}

export function createPastedContentLabel(value: string): string {
  return `[Pasted Content ${countCharacters(value).toLocaleString("en-US")} chars]`;
}

function encodeInvisibleId(value: number): string {
  return String(value)
    .split("")
    .map((digit) => String.fromCharCode(0xfe00 + Number(digit)))
    .join("");
}

export function createAtomicContentToken(label: string): string {
  const id = encodeInvisibleId(nextPasteId++);
  return `${label}\u2063${id}\u2063`;
}

export function createPastedContentToken(value: string): string {
  return createAtomicContentToken(createPastedContentLabel(value));
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
  ATOMIC_CONTENT_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(ATOMIC_CONTENT_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (cursor >= start && cursor <= end) return { start, end };
  }
  return null;
}

export function moveAcrossPastedContent(
  value: string,
  cursor: number,
  direction: "left" | "right",
): number | null {
  const span = findPastedContentSpan(value, cursor);
  if (!span) return null;
  if (direction === "left" && cursor > span.start) return span.start;
  if (direction === "right" && cursor < span.end) return span.end;
  return null;
}

export function deleteAdjacentPastedContent(
  value: string,
  cursor: number,
  direction: "backward" | "forward",
) {
  ATOMIC_CONTENT_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(ATOMIC_CONTENT_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const adjacent = direction === "backward" ? cursor === end : cursor === start;
    if (adjacent || (cursor > start && cursor < end)) {
      return { value: value.slice(0, start) + value.slice(end), cursorOffset: start };
    }
  }
  return null;
}

/** Validate chips before expansion, so literal chip-like text inside files is safe. */
export function assertAttachedContent(
  value: string,
  pastes: PastedContentRegistry,
  images: ReadonlyMap<string, unknown>,
  files: ReadonlyMap<string, unknown>,
): void {
  const counts = new Map<string, number>();
  for (const match of value.matchAll(new RegExp(ATOMIC_CONTENT_PATTERN.source, "g"))) {
    const token = match[0];
    if (token.startsWith("[Image:")) {
      if (!images.has(token))
        throw new Error("An image attachment is unresolved. Reattach it before sending.");
    } else if (token.startsWith("[File:")) {
      if (!files.has(token))
        throw new Error("A file attachment is unresolved. Reattach it before sending.");
    } else {
      const count = counts.get(token) ?? 0;
      if (pastes.get(token)?.[count] === undefined)
        throw new Error("Pasted content is unresolved. Paste it again before sending.");
      counts.set(token, count + 1);
    }
  }
}

export type ImageAttachmentRegistry = Map<string, ProviderImageAttachment>;

export function createImageAttachmentToken(attachment: ProviderImageAttachment): string {
  return createAtomicContentToken(`[Image: ${attachment.name}]`);
}

export function selectImageAttachments(
  value: string,
  registry: ImageAttachmentRegistry,
): ProviderImageAttachment[] {
  IMAGE_ATTACHMENT_PATTERN.lastIndex = 0;
  const attachments: ProviderImageAttachment[] = [];
  for (const match of value.matchAll(IMAGE_ATTACHMENT_PATTERN)) {
    const attachment = registry.get(match[0]);
    if (attachment) attachments.push(attachment);
  }
  return attachments;
}
