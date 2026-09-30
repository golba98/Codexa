import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { normalizeWorkspaceRoot } from "../workspace/workspaceRoot.js";
import type { ExternalSessionOptions } from "./types.js";

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function resolveHome(options: ExternalSessionOptions = {}): string {
  return options.home ?? options.env?.["HOME"] ?? homedir();
}

export function envValue(options: ExternalSessionOptions, key: string): string | undefined {
  const value = (options.env ?? process.env)[key]?.trim();
  return value || undefined;
}

export function sameFolder(left: string, right: string): boolean {
  return normalizeWorkspaceRoot(left) === normalizeWorkspaceRoot(right);
}

/** Single-line title in the same shape Ubume uses for its own conversations. */
export function titleFromText(text: string, max = 72): string {
  const title = text.replace(/\s+/g, " ").trim();
  return title.length > max ? `${title.slice(0, max - 3).trimEnd()}...` : title;
}

export function clampText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[… ${text.length - max} more characters]` : text;
}

const textDecoder = new TextDecoder("utf-8");

async function readRange(path: string, start: number, length: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return textDecoder.decode(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** Complete JSON lines from the first `bytes` of a file. */
export async function readHeadJsonLines(path: string, size: number, bytes: number): Promise<JsonRecord[]> {
  const text = await readRange(path, 0, Math.min(size, bytes));
  return parseJsonLines(text, { dropLast: size > bytes });
}

/** Complete JSON lines from the last `bytes` of a file. */
export async function readTailJsonLines(path: string, size: number, bytes: number): Promise<JsonRecord[]> {
  const start = Math.max(0, size - bytes);
  const text = await readRange(path, start, size - start);
  return parseJsonLines(text, { dropFirst: start > 0 });
}

export function parseJsonLines(text: string, options: { dropFirst?: boolean; dropLast?: boolean } = {}): JsonRecord[] {
  const lines = text.split("\n");
  if (options.dropFirst) lines.shift();
  if (options.dropLast) lines.pop();
  const records: JsonRecord[] = [];
  for (const line of lines) {
    const record = parseJsonLine(line);
    if (record) records.push(record);
  }
  return records;
}

function parseJsonLine(line: string): JsonRecord | null {
  if (!line.trim()) return null;
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** Streams a JSONL file without loading it whole; malformed lines are skipped. */
export async function forEachJsonLine(path: string, visit: (record: JsonRecord) => void): Promise<void> {
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    const record = parseJsonLine(line);
    if (record) visit(record);
  }
}

/** Maps with bounded parallelism so scanning hundreds of session files keeps file handles low. */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
