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

export function clampIndex(index: number, count: number): number {
  return count <= 0 ? 0 : Math.max(0, Math.min(count - 1, index));
}
