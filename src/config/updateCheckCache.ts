import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export interface UpdateCheckCache {
  lastChecked: number;
  localCommit: string | null;
  remoteCommit: string | null;
  updateAvailable: boolean;
}

const CACHE_FILE = join(homedir(), ".codexa-update-check.json");

export function loadUpdateCheckCache(): UpdateCheckCache | null {
  try {
    const text = readFileSync(CACHE_FILE, "utf-8");
    const data = JSON.parse(text) as Record<string, unknown>;
    if (typeof data.lastChecked !== "number") return null;
    return {
      lastChecked: data.lastChecked,
      localCommit: typeof data.localCommit === "string" ? data.localCommit : null,
      remoteCommit: typeof data.remoteCommit === "string" ? data.remoteCommit : null,
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

export function isCacheValid(cache: UpdateCheckCache, intervalHours: number): boolean {
  const maxAgeMs = intervalHours * 60 * 60 * 1000;
  return Date.now() - cache.lastChecked < maxAgeMs;
}
