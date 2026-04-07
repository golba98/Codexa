/**
 * Responsive layout constants and hook.
 *
 * Three modes based purely on terminal column count:
 *
 *   full    ≥ 110 cols  → full banner, side-by-side header info
 *   compact  60–109     → single-line mini logo, stacked info, condensed composer
 *   micro    < 60       → no logo, one-line header, ultra-compact composer
 */

import { useEffect, useState } from "react";
import { useStdout } from "ink";
import { getDisplayWidth, truncateEnd } from "./displayText.js";

export const BREAKPOINT_FULL    = 110; // ≥ this → full
export const BREAKPOINT_COMPACT =  60; // ≥ this → compact; below → micro
export const MIN_SUPPORTED_COLS = 48;
export const MIN_SUPPORTED_ROWS = 12;
const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 24;

export type LayoutMode = "full" | "compact" | "micro";

export interface Layout {
  cols: number;
  rows: number;
  mode: LayoutMode;
  shellWidth: number;
  shellHeight: number;
  contentWidth: number;
  contentHeight: number;
  tooSmall: boolean;
  epoch: number;
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
  return getDisplayWidth(text);
}

export function clampVisualText(text: string, maxWidth: number): string {
  return truncateEnd(text, maxWidth);
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
    shellWidth: getShellWidth(DEFAULT_COLUMNS),
    shellHeight: getShellHeight(DEFAULT_ROWS),
    contentWidth: getUsableShellWidth(DEFAULT_COLUMNS, 2),
    contentHeight: Math.max(1, getShellHeight(DEFAULT_ROWS) - 2),
    tooSmall: false,
    epoch: 0,
  },
): Layout {
  const nextCols = normalizeDimension(cols, fallback.cols);
  const nextRows = normalizeDimension(rows, fallback.rows);
  const shellWidth = getShellWidth(nextCols);
  const shellHeight = getShellHeight(nextRows);

  return {
    cols: nextCols,
    rows: nextRows,
    mode: computeMode(nextCols),
    shellWidth,
    shellHeight,
    contentWidth: Math.max(1, shellWidth - 2),
    contentHeight: Math.max(1, shellHeight - 2),
    tooSmall: nextCols < MIN_SUPPORTED_COLS || nextRows < MIN_SUPPORTED_ROWS,
    epoch: fallback.epoch ?? 0,
  };
}

function snapshot(stdout: NodeJS.WriteStream, fallback?: Layout): Layout {
  return createLayoutSnapshot(stdout.columns, stdout.rows, fallback);
}

/** React hook — returns live layout that updates on every terminal resize. */
export function useLayout(): Layout {
  const { stdout } = useStdout();
  const [layout, setLayout] = useState<Layout>(() => snapshot(stdout));

  useEffect(() => {
    const onResize = () => {
      setLayout((current) => {
        const nextLayout = snapshot(stdout, current);
        if (
          current.cols === nextLayout.cols &&
          current.rows === nextLayout.rows &&
          current.mode === nextLayout.mode
        ) {
          return current;
        }

        return {
          ...nextLayout,
          epoch: current.epoch + 1,
        };
      });
    };
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);

  return layout;
}
