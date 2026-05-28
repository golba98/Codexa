import { getTextWidth } from "./textLayout.js";

// ─── Logo constants ───────────────────────────────────────────────────────────
// Each variant is an array of exact terminal rows.
//
// IMPORTANT: Never apply `bold` when rendering these rows. Bold rendering of
// Unicode full-block (█) and box-drawing (╔═╗╝) characters causes per-glyph
// width/stroke differences in most terminal fonts (Ptyxis, GNOME Terminal,
// VS Code), producing visible gaps between characters that should be flush.
// The companion `wrap="truncate"` rule keeps each row on exactly one terminal
// line regardless of the surrounding Ink flex layout.

// Canonical Codexa brand wordmark — the ██ block art is the authoritative logo.
// Always shown on any normal-width terminal (≥ LOGO_LARGE_MIN_COLS cols).
export const CODEXA_WORDMARK = [
  " ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗ █████╗ ",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝██╔══██╗",
  "██║     ██║   ██║██║  ██║█████╗   ╚███╔╝ ███████║",
  "██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗ ██╔══██║",
  "╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗██║  ██║",
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
].join("\n");

/** 6-row ANSI Shadow block-char logo. Requires cols ≥ LOGO_LARGE_MIN_COLS. */
export const LOGO_LARGE: readonly string[] = CODEXA_WORDMARK.split("\n");

/** 4-row pure-ASCII art logo. Requires cols ≥ LOGO_MEDIUM_MIN_COLS. */
export const LOGO_MEDIUM: readonly string[] = [
  "  ____   ___  ____  _____ _  __    _    ",
  " / ___| / _ \\|  _ \\| ____| |/ /   / \\   ",
  "| |    | | | | | | |  _| | ' /   / _ \\  ",
  "|_|     \\___/|_| |_|_____|_|\\_\\ /_/ \\_\\ ",
];

/** 1-row compact logo. Requires cols ≥ LOGO_COMPACT_MIN_COLS. */
export const LOGO_COMPACT: readonly string[] = [
  "✦ CODEXA",
];

// ─── Breakpoints ──────────────────────────────────────────────────────────────

// Aligned with MEDIUM_HEADER_MIN_COLUMNS so any side-by-side-capable terminal
// shows the canonical block wordmark instead of the thin ASCII fallback.
export const LOGO_LARGE_MIN_COLS = 72;
export const LOGO_MEDIUM_MIN_COLS = 72;
export const LOGO_COMPACT_MIN_COLS = 48;

// Minimum terminal rows each variant needs to render without crowding out the
// metadata + composer. A wide-but-short terminal (e.g. VS Code's bottom panel)
// must step DOWN to a smaller logo instead of dropping straight to text-only.
export const LOGO_LARGE_MIN_ROWS = 24;
export const LOGO_MEDIUM_MIN_ROWS = 16;
export const LOGO_COMPACT_MIN_ROWS = 12;

// LOGO_MEDIUM is kept as an exported constant but intentionally omitted from
// LOGO_VARIANTS. At 72+ cols, LOGO_LARGE_MIN_COLS = LOGO_MEDIUM_MIN_COLS = 72,
// so LOGO_LARGE always wins. Below 72 cols the viewport is too narrow for the
// thin ASCII art to add value over the compact single-line fallback.
const LOGO_VARIANTS: readonly { logo: readonly string[]; minCols: number; minRows: number }[] = [
  { logo: LOGO_LARGE, minCols: LOGO_LARGE_MIN_COLS, minRows: LOGO_LARGE_MIN_ROWS },
  { logo: LOGO_COMPACT, minCols: LOGO_COMPACT_MIN_COLS, minRows: LOGO_COMPACT_MIN_ROWS },
];

// ─── Selection ────────────────────────────────────────────────────────────────

/**
 * Returns the best logo variant for the given terminal column count.
 *
 * Env overrides:
 *   CODEXA_NO_ASCII_LOGO=1  → always text-only (empty array)
 *   CODEXA_COMPACT_LOGO=1   → always compact single-line logo
 */
export function selectLogoVariant(cols: number): readonly string[] {
  if (process.env["CODEXA_NO_ASCII_LOGO"] === "1") return [];
  if (process.env["CODEXA_COMPACT_LOGO"] === "1") return LOGO_COMPACT;
  if (cols >= LOGO_LARGE_MIN_COLS) return LOGO_LARGE;
  if (cols >= LOGO_COMPACT_MIN_COLS) return LOGO_COMPACT;
  return [];
}

/**
 * Returns the largest logo variant that fits BOTH the available columns and
 * rows. Unlike {@link selectLogoVariant} (columns-only), this degrades a
 * too-tall logo to a shorter one before falling back to text-only — so a
 * wide-but-short terminal keeps a logo instead of collapsing to a flat line.
 * Returns an empty array only when even the 1-row compact logo cannot fit.
 *
 * Honours the same env overrides as {@link selectLogoVariant}.
 */
export function selectLogoVariantForViewport(cols: number, rows: number): readonly string[] {
  if (process.env["CODEXA_NO_ASCII_LOGO"] === "1") return [];
  if (process.env["CODEXA_COMPACT_LOGO"] === "1") {
    return rows >= LOGO_COMPACT_MIN_ROWS ? LOGO_COMPACT : [];
  }
  if (cols >= LOGO_LARGE_MIN_COLS) return LOGO_LARGE;
  for (const variant of LOGO_VARIANTS) {
    if (cols >= variant.minCols && rows >= variant.minRows) {
      return variant.logo;
    }
  }
  return [];
}

/** Returns the visual column width of the widest row in a logo variant. */
export function getLogoWidth(logo: readonly string[]): number {
  return logo.reduce((max, line) => Math.max(max, getTextWidth(line)), 0);
}
