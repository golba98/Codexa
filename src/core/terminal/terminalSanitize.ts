// ─── terminalSanitize ─────────────────────────────────────────────────────────
// Strips unsafe ANSI/control sequences from subprocess and user input.
//
// Two levels of sanitization are provided:
//
//  1. sanitizeTerminalOutput / sanitizeTerminalLines / sanitizeTerminalInput
//     — Full strip: removes ALL escape sequences (OSC, CSI, DCS, etc.) plus
//       non-printable control bytes.  Used for arbitrary subprocess output,
//       user-typed text, and assistant deltas where we cannot trust the source.
//
//  2. sanitizeDiffOutput
//     — Safe-passthrough mode for diff content that has already been classified
//       as a code/diff segment by the markdown parser.  Strips dangerous
//       sequences (cursor movement, screen clear, bracketed-paste toggle, OSC
//       hyperlinks, etc.) but INTENTIONALLY preserves SGR colour-only sequences
//       (e.g. \x1b[32m … \x1b[0m) so that raw diff colour codes from tools like
//       `git diff --color=always` survive into the Ink layer.
//       NOTE: The recommended rendering path still uses React/Ink theme-based
//       colouring (no raw ANSI needed), so this helper is available for future
//       use but diff colour is primarily applied via getDiffTone() tones.

export interface SanitizeTerminalOptions {
  preserveTabs?: boolean;
  tabSize?: number;
}

const DEFAULT_TAB_SIZE = 2;

// ── Dangerous sequence patterns (always stripped) ─────────────────────────────
// OSC: Operating System Command — can set window titles, hyperlinks, etc.
const OSC_SEQUENCE = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g;
// DCS/PM/APC: Device Control String and friends — rare but risky
const DCS_PM_APC_SEQUENCE = /\u001B[PX^_][\s\S]*?\u001B\\/g;
// CSI: Control Sequence Introducer — covers cursor movement, erase, colour, etc.
const CSI_SEQUENCE = /\u001B\[[0-?]*[ -/]*[@-~]/g;
// ESC + single intermediate — Fe sequences (e.g. ESC M = reverse index)
const ESC_INTERMEDIATE_SEQUENCE = /\u001B[@-Z\\-_]/g;
// C1 control codes (0x80–0x9F) — can masquerade as CSI openers on some terminals
const SINGLE_C1_SEQUENCE = /[\u0080-\u009F]/g;
// Remaining non-printable bytes after the above passes
const DISALLOWED_CONTROL_BYTES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// ── SGR-only colour-safe allowlist (used by sanitizeDiffOutput) ───────────────
// Matches ONLY SGR (Select Graphic Rendition) sequences — the subset of CSI
// that carries colour/style information and has no side-effects on terminal
// state (no cursor movement, no erase, no mode changes).
// Pattern: ESC [ <params> m  where <params> is digits/semicolons only.
// We keep these sequences when the caller asserts the content is safe diff output.
const SGR_COLOUR_SEQUENCE = /\u001B\[[\d;]*m/g;

function normalizeTabs(text: string, preserveTabs: boolean, tabSize: number): string {
  if (preserveTabs) return text;
  return text.replace(/\t/g, " ".repeat(Math.max(1, tabSize)));
}

/** Strip all terminal escape sequences. */
function stripTerminalSequences(raw: string): string {
  return raw
    .replace(OSC_SEQUENCE, "")
    .replace(DCS_PM_APC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(ESC_INTERMEDIATE_SEQUENCE, "")
    .replace(SINGLE_C1_SEQUENCE, "");
}

/**
 * Strip only the dangerous subset of terminal sequences, preserving SGR colour codes.
 * Used for content we know is diff output and want to pass colour through.
 * NOTE: Only call this on content that has already been classified as a safe diff
 * segment — never on arbitrary subprocess or user input.
 */
function stripDangerousSequencesPreserveSGR(raw: string): string {
  return raw
    .replace(OSC_SEQUENCE, "")          // OSC: hyperlinks, titles — always strip
    .replace(DCS_PM_APC_SEQUENCE, "")  // DCS/PM/APC — always strip
    // Strip CSI sequences that are NOT pure SGR colour codes.
    // First mark safe SGR sequences with a placeholder, strip all CSI,
    // then restore the safe ones.
    .replace(SGR_COLOUR_SEQUENCE, (match) => `\u0000SGR:${match}\u0000`)  // protect SGR
    .replace(CSI_SEQUENCE, "")                                              // strip dangerous CSI
    .replace(/\u0000SGR:(\u001B\[[\d;]*m)\u0000/g, "$1")                 // restore SGR
    .replace(ESC_INTERMEDIATE_SEQUENCE, "")
    .replace(SINGLE_C1_SEQUENCE, "");
}

function stripUnsafeControls(text: string): string {
  return text.replace(DISALLOWED_CONTROL_BYTES, "");
}

// ── Public API ────────────────────────────────────────────────────────────────

export function sanitizeTerminalOutput(raw: string, options: SanitizeTerminalOptions = {}): string {
  if (!raw) return "";
  const preserveTabs = options.preserveTabs ?? false;
  const tabSize = options.tabSize ?? DEFAULT_TAB_SIZE;

  const withoutSequences = stripTerminalSequences(raw);
  const normalizedBreaks = withoutSequences
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const withoutUnsafeControls = stripUnsafeControls(normalizedBreaks);
  return normalizeTabs(withoutUnsafeControls, preserveTabs, tabSize);
}

export function sanitizeTerminalInput(raw: string): string {
  return sanitizeTerminalOutput(raw, { preserveTabs: false, tabSize: DEFAULT_TAB_SIZE });
}

export function sanitizeTerminalLines(lines: string[]): string[] {
  return lines
    .map((line) => sanitizeTerminalOutput(line))
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

/**
 * Sanitize diff output while preserving SGR colour escape sequences.
 *
 * This is intentionally less aggressive than sanitizeTerminalOutput so that
 * diffs piped through `git diff --color=always` or similar tools retain their
 * ANSI colour information.  Only safe SGR (colour/style) codes are preserved;
 * all cursor-movement, erase, and other side-effecting sequences are stripped.
 *
 * Width measurement of the resulting text must account for the invisible ANSI
 * bytes — use stripAnsiForMeasurement() on the string before measuring.
 *
 * Safety: Never call this on arbitrary subprocess or user input.  Only use it
 * after the markdown parser has classified a segment as a code/diff block.
 */
export function sanitizeDiffOutput(raw: string): string {
  if (!raw) return "";
  const withSafrSgr = stripDangerousSequencesPreserveSGR(raw);
  const normalizedBreaks = withSafrSgr
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return stripUnsafeControls(normalizedBreaks);
}

/**
 * Strip ALL ANSI sequences from a string purely for width measurement purposes.
 * Use this when you need the visual width of a string that may contain SGR codes.
 */
export function stripAnsiForMeasurement(text: string): string {
  return text
    .replace(SGR_COLOUR_SEQUENCE, "")
    .replace(DISALLOWED_CONTROL_BYTES, "");
}
