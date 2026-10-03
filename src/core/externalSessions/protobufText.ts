/**
 * Schemaless protobuf text extraction. Antigravity stores conversation steps as
 * protobuf blobs without a published schema, so the transcript viewer walks the
 * wire format and keeps every length-delimited field that reads as text.
 */

const decoder = new TextDecoder("utf-8", { fatal: true });

interface Cursor {
  offset: number;
}

function readVarint(bytes: Uint8Array, cursor: Cursor): number | null {
  let result = 0;
  let multiplier = 1;
  for (let index = 0; index < 10; index += 1) {
    if (cursor.offset >= bytes.length) return null;
    const byte = bytes[cursor.offset++]!;
    result += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return result;
    multiplier *= 128;
  }
  return null;
}

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return null;
  }
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if ((code < 0x20 && char !== "\n" && char !== "\r" && char !== "\t") || code === 0x7f)
      return null;
  }
  return text;
}

/** Parses one message; returns null when the bytes are not a well-formed message. */
function walkMessage(
  bytes: Uint8Array,
  depth: number,
  maxDepth: number,
  output: string[],
): boolean {
  const cursor: Cursor = { offset: 0 };
  while (cursor.offset < bytes.length) {
    const tag = readVarint(bytes, cursor);
    if (tag === null || tag >>> 3 === 0) return false;
    const wireType = tag & 7;
    if (wireType === 0) {
      if (readVarint(bytes, cursor) === null) return false;
    } else if (wireType === 1) {
      cursor.offset += 8;
    } else if (wireType === 5) {
      cursor.offset += 4;
    } else if (wireType === 2) {
      const length = readVarint(bytes, cursor);
      if (length === null || cursor.offset + length > bytes.length) return false;
      const payload = bytes.subarray(cursor.offset, cursor.offset + length);
      cursor.offset += length;
      const text = decodeText(payload);
      if (text !== null) {
        output.push(text);
      } else if (depth < maxDepth) {
        const nested: string[] = [];
        if (walkMessage(payload, depth + 1, maxDepth, nested)) output.push(...nested);
      }
    } else {
      return false;
    }
    if (cursor.offset > bytes.length) return false;
  }
  return true;
}

/** Text fields of a protobuf message in wire order. Never throws; malformed tails are dropped. */
export function extractProtobufStrings(bytes: Uint8Array, maxDepth = 6): string[] {
  const output: string[] = [];
  walkMessage(bytes, 0, maxDepth, output);
  return output;
}
