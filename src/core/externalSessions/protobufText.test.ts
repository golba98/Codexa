import assert from "node:assert/strict";
import test from "node:test";
import { extractProtobufStrings } from "./protobufText.js";

function varint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0x7f) { bytes.push((remaining & 0x7f) | 0x80); remaining >>>= 7; }
  bytes.push(remaining);
  return bytes;
}
function field(fieldNumber: number, payload: Uint8Array | number[] | string): number[] {
  const bytes = typeof payload === "string" ? [...new TextEncoder().encode(payload)] : [...payload];
  return [...varint((fieldNumber << 3) | 2), ...varint(bytes.length), ...bytes];
}
function varintField(fieldNumber: number, value: number): number[] {
  return [...varint(fieldNumber << 3), ...varint(value)];
}

test("extractProtobufStrings returns text fields in order, including nested messages", () => {
  const nested = field(3, [...field(1, "inner reply"), ...varintField(2, 300)]);
  const message = new Uint8Array([...varintField(1, 7), ...field(2, "What model are you?"), ...nested, ...field(4, "tail")]);
  assert.deepEqual(extractProtobufStrings(message), ["What model are you?", "inner reply", "tail"]);
});

test("extractProtobufStrings skips fixed-width fields and binary payloads", () => {
  const fixed64 = [(5 << 3) | 1, 1, 2, 3, 4, 5, 6, 7, 8];
  const fixed32 = [(6 << 3) | 5, 1, 2, 3, 4];
  const binary = field(7, [0xff, 0xfe, 0x00, 0x01]);
  const message = new Uint8Array([...fixed64, ...fixed32, ...binary, ...field(8, "kept")]);
  assert.deepEqual(extractProtobufStrings(message), ["kept"]);
});

test("extractProtobufStrings keeps multi-line markdown and unicode text", () => {
  const text = "I'm running on **GPT**.\n\n- item ✓\n\tindented";
  assert.deepEqual(extractProtobufStrings(new Uint8Array(field(1, text))), [text]);
});

test("extractProtobufStrings never throws on malformed input and keeps what it decoded", () => {
  const truncated = new Uint8Array([...field(1, "complete"), ...varint((2 << 3) | 2), 50, 65, 66]);
  assert.deepEqual(extractProtobufStrings(truncated), ["complete"]);
  assert.deepEqual(extractProtobufStrings(new Uint8Array([0xff, 0xff, 0xff])), []);
  assert.deepEqual(extractProtobufStrings(new Uint8Array([])), []);
});

test("extractProtobufStrings stops descending past the depth limit", () => {
  let payload: number[] = field(1, "deep");
  for (let depth = 0; depth < 10; depth += 1) payload = field(1, payload);
  assert.deepEqual(extractProtobufStrings(new Uint8Array(payload), 3), []);
  assert.deepEqual(extractProtobufStrings(new Uint8Array(payload), 12), ["deep"]);
});
