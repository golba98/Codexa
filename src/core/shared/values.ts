/**
 * Small value helpers shared by every layer. Keep this module free of imports so
 * core, session, headless and UI code can all depend on it.
 */

/** True for a plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Readable message for any thrown value; `fallback` replaces non-Error values. */
export function errorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  return fallback ?? String(error);
}

/** Converts CRLF and lone CR line breaks to LF. */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Formats a duration as `850ms` below one second, otherwise `4.2s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
