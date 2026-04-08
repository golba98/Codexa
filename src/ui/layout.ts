/**
 * Responsive layout constants and hook.
 *
 * Three modes based purely on terminal column count:
 *
 *   full    ≥ 110 cols  → full banner, side-by-side header info
 *   compact  60–109     → single-line mini logo, stacked info, condensed composer
 *   micro    < 60       → no logo, one-line header, ultra-compact composer
 */

import { useEffect, useRef, useState } from "react";
import { useStdout } from "ink";
import stringWidth from "string-width";

export const BREAKPOINT_FULL    = 110; // ≥ this → full
export const BREAKPOINT_COMPACT =  60; // ≥ this → compact; below → micro
export const MIN_VIEWPORT_COLS = 20;
export const MIN_VIEWPORT_ROWS = 10;
export const RESTORE_SETTLE_MS = 100;
const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 24;

export type LayoutMode = "full" | "compact" | "micro";

export interface Layout {
  cols: number;
  rows: number;
  mode: LayoutMode;
}

export interface TerminalViewport extends Layout {
  rawCols?: number;
  rawRows?: number;
  unstable: boolean;
  layoutEpoch: number;
}

function isValidDimension(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function normalizeDimension(value: number | undefined, fallback: number): number {
  if (!isValidDimension(value)) {
    return fallback;
  }

  return Math.floor(value);
}

export function isRenderableViewport(cols: number | undefined, rows: number | undefined): boolean {
  return isValidDimension(cols)
    && isValidDimension(rows)
    && Math.floor(cols) >= MIN_VIEWPORT_COLS
    && Math.floor(rows) >= MIN_VIEWPORT_ROWS;
}

/**
 * Leave a 1-column gutter so box-drawing borders never land exactly on the
 * terminal edge, which can trigger a horizontal scrollbar in some Windows hosts.
 */
export function getShellWidth(cols: number | undefined): number {
  return Math.max(20, (cols ?? 120) - 1);
}

export function getUsableShellWidth(cols: number | undefined, reservedColumns = 0): number {
  return Math.max(1, getShellWidth(cols) - reservedColumns);
}

/**
 * Leave a 1-row gutter so renders do not land exactly on the terminal bottom
 * edge, which can trigger viewport scroll drift in some hosts.
 */
export function getShellHeight(rows: number | undefined): number {
  return Math.max(10, (rows ?? DEFAULT_ROWS) - 1);
}

export function getVisualWidth(text: string): number {
  return stringWidth(text);
}

export function clampVisualText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (getVisualWidth(text) <= maxWidth) return text;

  const ellipsis = maxWidth > 1 ? "…" : "";
  const suffixWidth = getVisualWidth(ellipsis);
  let output = "";

  for (const char of Array.from(text)) {
    if (getVisualWidth(output + char) + suffixWidth > maxWidth) {
      break;
    }
    output += char;
  }

  return output + ellipsis;
}

function computeMode(cols: number): LayoutMode {
  if (cols >= BREAKPOINT_FULL)    return "full";
  if (cols >= BREAKPOINT_COMPACT) return "compact";
  return "micro";
}

export function createLayoutSnapshot(
  cols: number | undefined,
  rows: number | undefined,
  fallback: Layout = {
    cols: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    mode: computeMode(DEFAULT_COLUMNS),
  },
): Layout {
  const nextCols = normalizeDimension(cols, fallback.cols);
  const nextRows = normalizeDimension(rows, fallback.rows);

  return {
    cols: nextCols,
    rows: nextRows,
    mode: computeMode(nextCols),
  };
}

function snapshot(stdout: NodeJS.WriteStream, fallback?: Layout): Layout {
  return createLayoutSnapshot(stdout.columns, stdout.rows, fallback);
}

export function createTerminalViewport(
  cols: number | undefined,
  rows: number | undefined,
  fallback?: TerminalViewport,
): TerminalViewport {
  const fallbackLayout = fallback
    ? { cols: fallback.cols, rows: fallback.rows, mode: fallback.mode }
    : undefined;
  const unstable = !isRenderableViewport(cols, rows);
  const stableLayout = unstable && fallbackLayout
    ? fallbackLayout
    : createLayoutSnapshot(cols, rows, fallbackLayout);

  return {
    ...stableLayout,
    rawCols: cols,
    rawRows: rows,
    unstable,
    layoutEpoch: fallback?.layoutEpoch ?? 0,
  };
}

export function advanceTerminalViewport(
  current: TerminalViewport,
  cols: number | undefined,
  rows: number | undefined,
): TerminalViewport {
  const next = createTerminalViewport(cols, rows, current);
  if (!next.unstable && current.unstable) {
    return {
      ...next,
      layoutEpoch: current.layoutEpoch + 1,
    };
  }

  return {
    ...next,
    layoutEpoch: current.layoutEpoch,
  };
}

/** React hook — returns live layout that ignores transient invalid restore sizes. */
export function useTerminalViewport(): TerminalViewport {
  const { stdout } = useStdout();
  const [viewport, setViewport] = useState<TerminalViewport>(() => createTerminalViewport(stdout.columns, stdout.rows));
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const commit = () => {
      setViewport((current) => {
        const nextViewport = advanceTerminalViewport(current, stdout.columns, stdout.rows);
        if (
          current.cols === nextViewport.cols &&
          current.rows === nextViewport.rows &&
          current.mode === nextViewport.mode &&
          current.unstable === nextViewport.unstable &&
          current.layoutEpoch === nextViewport.layoutEpoch &&
          current.rawCols === nextViewport.rawCols &&
          current.rawRows === nextViewport.rawRows
        ) {
          return current;
        }

        return nextViewport;
      });
    };

    const onResize = () => {
      commit();
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        commit();
      }, RESTORE_SETTLE_MS);
    };

    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
      }
    };
  }, [stdout]);

  return viewport;
}
