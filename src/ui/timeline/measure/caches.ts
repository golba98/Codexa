import * as renderDebug from "../../../core/perf/renderDebug.js";
import type { ActionDisplayDescriptor, TimelineRow } from "./types.js";

const ROW_CONTENT_CACHE_LIMIT = 2500;

export const _rowContentCache = new Map<string, TimelineRow>();

export function rememberRow(cacheKey: string, row: TimelineRow): TimelineRow {
  if (_rowContentCache.has(cacheKey)) {
    _rowContentCache.delete(cacheKey);
  }
  _rowContentCache.set(cacheKey, row);
  if (_rowContentCache.size > ROW_CONTENT_CACHE_LIMIT) {
    const oldestKey = _rowContentCache.keys().next().value;
    if (oldestKey !== undefined) {
      _rowContentCache.delete(oldestKey);
    }
  }
  return row;
}

export const _blankRowCache = new Map<string, TimelineRow>();

// ─── Row cache ────────────────────────────────────────────────────────────────

// Per-entry row cache for completed (non-streaming) timeline entries.
// Key: `${item.key}:${width}:${verboseMode}` — automatically invalidated when
// width or verboseMode changes because those are baked into the key.  Entries
// for completed turns are immutable so cached rows are always valid for the
// same (key, width, verboseMode) triple.
export const _staticRowCache = new Map<string, TimelineRow[]>();

const STREAMING_BLOCK_ROW_CACHE_LIMIT = 200;

export let _streamingBlockRowCache = new Map<string, TimelineRow[]>();

export const _completedActionRowCache = new Map<string, TimelineRow[]>();

export const _completedActionTokenById = new Map<string, string>();

const FROZEN_ROW_GROUP_CACHE_LIMIT = 1200;

const _frozenRowGroupCache = new Map<string, TimelineRow[]>();

export let _wrappedRowCache = new WeakMap<TimelineRow, Map<string, TimelineRow>>();

export const _wrappedBlankRowCache = new Map<string, TimelineRow>();

export const _actionDisplayCache = new Map<string, ActionDisplayDescriptor>();

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function textCacheToken(value: string | null | undefined): string {
  const text = value ?? "";
  return `${text.length}:${hashString(text)}`;
}

export function rowCacheKey(parts: unknown[]): string {
  return JSON.stringify(parts);
}

export function getCachedStreamingBlockRows(
  cacheKey: string,
  build: () => TimelineRow[],
): TimelineRow[] {
  const cached = _streamingBlockRowCache.get(cacheKey);
  if (cached) {
    _streamingBlockRowCache.delete(cacheKey);
    _streamingBlockRowCache.set(cacheKey, cached);
    return cached;
  }

  const rows = build();
  _streamingBlockRowCache.set(cacheKey, rows);
  while (_streamingBlockRowCache.size > STREAMING_BLOCK_ROW_CACHE_LIMIT) {
    const oldestKey = _streamingBlockRowCache.keys().next().value;
    if (oldestKey === undefined) break;
    _streamingBlockRowCache.delete(oldestKey);
  }
  return rows;
}

export function getCachedFrozenRows(cacheKey: string, build: () => TimelineRow[]): TimelineRow[] {
  const cached = _frozenRowGroupCache.get(cacheKey);
  if (cached) {
    _frozenRowGroupCache.delete(cacheKey);
    _frozenRowGroupCache.set(cacheKey, cached);
    return cached;
  }

  const rows = build();
  _frozenRowGroupCache.set(cacheKey, rows);
  while (_frozenRowGroupCache.size > FROZEN_ROW_GROUP_CACHE_LIMIT) {
    const oldestKey = _frozenRowGroupCache.keys().next().value;
    if (oldestKey === undefined) break;
    _frozenRowGroupCache.delete(oldestKey);
  }
  return rows;
}

/**
 * Drop every module-level row cache. Called at the /clear and conversation
 * resume boundaries: the caches are keyed by transcript item keys and would
 * otherwise keep rows for turns that no longer exist for the whole process.
 */
export function resetTimelineMeasureCaches(): void {
  _rowContentCache.clear();
  _staticRowCache.clear();
  _blankRowCache.clear();
  _streamingBlockRowCache.clear();
  _completedActionRowCache.clear();
  _completedActionTokenById.clear();
  _frozenRowGroupCache.clear();
  _wrappedRowCache = new WeakMap<TimelineRow, Map<string, TimelineRow>>();
  _wrappedBlankRowCache.clear();
  _actionDisplayCache.clear();
}

export function __clearTimelineMeasureCachesForTests(): void {
  resetTimelineMeasureCaches();
}

export function __getStreamingBlockRowCacheSizeForTests(): number {
  return _streamingBlockRowCache.size;
}

export function __getStaticRowCacheSizeForTests(): number {
  return _staticRowCache.size;
}

export function getStaticRows(
  cacheKey: string,
  build: () => TimelineRow[],
  details: {
    itemKey: string;
    itemType: string;
    innerWidth: number;
    runPhase?: string;
    opacity?: string;
  },
): TimelineRow[] {
  const cached = _staticRowCache.get(cacheKey);
  const cache = cached ? "hit" : "miss";
  renderDebug.traceEvent("timeline", "rowGeneration", { ...details, cache });
  const { itemKey: _itemKey, innerWidth: _innerWidth, ...eventDetails } = details;
  renderDebug.traceEvent("timeline", cached ? "staticCacheHit" : "staticCacheMiss", {
    cacheKey,
    ...eventDetails,
  });
  if (cached) return cached;
  const rows = build();
  _staticRowCache.set(cacheKey, rows);
  return rows;
}
