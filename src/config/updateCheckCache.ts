import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export interface UpdateCheckCache {
  lastChecked: number;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
}

const CACHE_FILE = join(homedir(), ".codexa-update-check.json");

export function loadUpdateCheckCache(): UpdateCheckCache | null {
  try {
    const text = readFileSync(CACHE_FILE, "utf-8");
    const data = JSON.parse(text) as Record<string, unknown>;
    if (typeof data.lastChecked !== "number") return null;
    if (typeof data.currentVersion !== "string") return null;
    return {
      lastChecked: data.lastChecked,
      currentVersion: data.currentVersion,
      latestVersion: typeof data.latestVersion === "string" ? data.latestVersion : null,
      updateAvailable: data.updateAvailable === true,
    };
  } catch {
    return null;
  }
}

export function saveUpdateCheckCache(cache: UpdateCheckCache): void {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf-8");
    renameSync(tmp, CACHE_FILE);
  } catch {
    // Best-effort — never crash on cache write failure.
  }
}

function stripV(v: string): string {
  return v.startsWith("v") ? v.slice(1) : v;
}

/**
 * Returns true only when the cache is still usable:
 * - `runningVersion` matches the version the cache was written for (version-mismatch = stale)
 * - The cache was written within `intervalHours`
 */
export function isCacheValid(
  cache: UpdateCheckCache,
  intervalHours: number,
  runningVersion?: string,
): boolean {
  if (runningVersion !== undefined) {
    if (stripV(cache.currentVersion) !== stripV(runningVersion)) {
      return false;
    }
  }
  const maxAgeMs = intervalHours * 60 * 60 * 1000;
  return Date.now() - cache.lastChecked < maxAgeMs;
}
