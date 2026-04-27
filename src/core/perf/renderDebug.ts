import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { useRef } from "react";

type DebugEnv = Record<string, string | undefined>;

let configured = false;
let enabled = false;
let logPath = join(homedir(), ".codexa-render-debug.jsonl");
let sessionId = `${Date.now()}-${process.pid}`;
const counters = new Map<string, number>();

function configureFromEnv(env: DebugEnv = process.env): void {
  enabled = env["CODEXA_RENDER_DEBUG"] === "1";
  logPath = env["CODEXA_RENDER_DEBUG_FILE"]?.trim() || join(homedir(), ".codexa-render-debug.jsonl");
  sessionId = `${Date.now()}-${process.pid}`;
  configured = true;
}

export function configureRenderDebug(env: DebugEnv = process.env): void {
  configureFromEnv(env);
  counters.clear();
  if (enabled) {
    writeRecord("session", { event: "start" });
  }
}

export function isRenderDebugEnabled(): boolean {
  if (!configured) {
    configureFromEnv();
  }
  return enabled;
}

export function getRenderDebugLogPath(): string {
  if (!configured) {
    configureFromEnv();
  }
  return logPath;
}

function nextCounter(name: string, by = 1): number {
  const next = (counters.get(name) ?? 0) + by;
  counters.set(name, next);
  return next;
}

function sanitizeValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (typeof value === "object") {
    const record: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      record[key] = sanitizeValue(nested);
    }
    return record;
  }
  return String(value);
}

function writeRecord(kind: string, fields: Record<string, unknown>): void {
  if (!isRenderDebugEnabled()) return;
  try {
    appendFileSync(
      logPath,
      JSON.stringify({
        ts: Date.now(),
        pid: process.pid,
        sessionId,
        kind,
        ...(sanitizeValue(fields) as Record<string, unknown>),
      }) + "\n",
      "utf8",
    );
  } catch {
    // Debug logging must never disturb the TUI.
  }
}

function diffKeys(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
): string {
  if (!previous) return "mount";
  const changed: string[] = [];
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (!Object.is(previous[key], next[key])) {
      changed.push(key);
    }
  }
  return changed.length > 0 ? changed.join(",") : "parent";
}

function summarizeWatchedValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return { type: "array", length: value.length };
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const reactType = record["type"];
    if ("$$typeof" in record) {
      return {
        type: "reactElement",
        name: typeof reactType === "string"
          ? reactType
          : typeof reactType === "function"
            ? reactType.name
            : "unknown",
      };
    }
    if (typeof record["kind"] === "string") {
      return { type: "object", kind: record["kind"] };
    }
    if (typeof record["key"] === "string") {
      return { type: "object", key: record["key"] };
    }
    return { type: "object", keys: Object.keys(record).slice(0, 8) };
  }
  return String(value);
}

function summarizeWatched(watched: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(watched)) {
    summary[key] = summarizeWatchedValue(value);
  }
  return summary;
}

export function traceRender(
  component: string,
  reason = "unknown",
  fields: Record<string, unknown> = {},
): void {
  if (!isRenderDebugEnabled()) return;
  const count = nextCounter(`render.${component}`);
  writeRecord("render", { component, count, reason, ...fields });
}

export function useRenderDebug(
  component: string,
  watched: Record<string, unknown> = {},
): void {
  const renderCount = useRef(0);
  const previous = useRef<Record<string, unknown> | null>(null);
  renderCount.current += 1;
  const reason = diffKeys(previous.current, watched);
  if (isRenderDebugEnabled()) {
    writeRecord("render", {
      component,
      count: renderCount.current,
      reason,
      watched: summarizeWatched(watched),
    });
  }
  previous.current = watched;
}

export function traceEvent(
  channel: string,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (!isRenderDebugEnabled()) return;
  const count = nextCounter(`${channel}.${event}`);
  writeRecord(channel, { event, count, ...fields });
}

export function traceSchedulerFlush(fields: Record<string, unknown>): void {
  traceEvent("scheduler", "flush", fields);
}

export function traceStatusTick(fields: Record<string, unknown>): void {
  traceEvent("status", "tick", fields);
}

export function traceTimelineUpdate(fields: Record<string, unknown>): void {
  traceEvent("timeline", "update", fields);
}

export function traceTerminalWrite(
  stream: "stdout" | "stderr",
  source: string,
  chunk: unknown,
): void {
  if (!isRenderDebugEnabled()) return;
  const text = typeof chunk === "string"
    ? chunk
    : chunk instanceof Uint8Array
      ? Buffer.from(chunk).toString("utf8")
      : String(chunk ?? "");
  writeRecord(stream, {
    event: "directWrite",
    count: nextCounter(`${stream}.directWrite`),
    source,
    bytes: Buffer.byteLength(text),
    containsViewportClear: text.includes("\x1b[2J"),
    containsScrollbackClear: text.includes("\x1b[3J"),
    containsAlternateScreen: text.includes("\x1b[?1049h"),
    containsTitleSequence: text.includes("\x1b]0;") || text.includes("\x1b]2;"),
  });
}

export function traceTerminalClear(source: string, fields: Record<string, unknown> = {}): void {
  traceEvent("terminal", "clearScreen", { source, ...fields });
}
