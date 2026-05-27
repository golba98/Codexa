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

/** 6-row ANSI Shadow block-char logo. Requires cols ≥ LOGO_LARGE_MIN_COLS. */
export const LOGO_LARGE: readonly string[] = [
  " ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗ █████╗ ",
  "██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝██╔══██╗",
  "██║     ██║   ██║██║  ██║█████╗   ╚███╔╝ ███████║",
  "██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗ ██╔══██║",
  "╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗██║  ██║",
  " ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
];

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

export const LOGO_LARGE_MIN_COLS = 100;
export const LOGO_MEDIUM_MIN_COLS = 72;
export const LOGO_COMPACT_MIN_COLS = 48;

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
  if (cols >= LOGO_MEDIUM_MIN_COLS) return LOGO_MEDIUM;
  if (cols >= LOGO_COMPACT_MIN_COLS) return LOGO_COMPACT;
  return [];
}

/** Returns the visual column width of the widest row in a logo variant. */
export function getLogoWidth(logo: readonly string[]): number {
  return logo.reduce((max, line) => Math.max(max, getTextWidth(line)), 0);
}
