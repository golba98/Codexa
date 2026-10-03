import { isNoiseLine } from "../../core/providers/codexTranscript.js";
import { normalizeLineBreaks } from "../../core/shared/text.js";
import { sanitizeTerminalOutput } from "../../core/terminal/terminalSanitize.js";

/**
 * Sanitize: Strip ANSI escape sequences and non-printable control characters.
 * Removes known UI chrome bleed (e.g. box drawing characters) before rendering.
 *
 * Note on diff colours: Diff colouring in this app is applied at the React/Ink
 * rendering layer via getDiffTone() tones, NOT via raw ANSI escape sequences.
 * This means sanitizeTerminalOutput() can safely strip all raw ANSI here —
 * the correct theme colours are re-applied by buildCodePanelRows/buildMarkdownRows
 * in timelineMeasure.ts. There is no need to preserve SGR codes at this stage.
 */
export function sanitizeOutput(raw: string): string {
  if (!raw) return "";
  const clean = sanitizeTerminalOutput(raw, { preserveTabs: false, tabSize: 2 });
  return clean;
}

/**
 * Normalize: Normalizes text formatting for the box wrappers.
 * Replaces CRLF with LF and collapses excessive blank lines to prevent
 * vertical stretching and layout popping.
 */
export function normalizeOutput(clean: string): string {
  let normalized = normalizeLineBreaks(clean);
  // Collapse excessive vertical whitespace (4+ newlines into 3)
  normalized = normalized.replace(/\n{4,}/g, "\n\n\n");

  // Remove lines that are purely known noise prefixes
  const lines = normalized.split("\n");
  const filteredLines = lines.filter((line) => !isNoiseLine(line));

  return filteredLines.join("\n");
}
