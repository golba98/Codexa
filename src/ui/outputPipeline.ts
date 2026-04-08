import { isNoiseLine } from "../core/providers/codexTranscript.js";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { parseMarkdown, type Segment } from "./Markdown.js";

/**
 * 1. Sanitize: Strip ANSI escape sequences and non-printable control characters.
 * Removes known UI chrome bleed (e.g. box drawing characters) before rendering.
 */
export function sanitizeOutput(raw: string): string {
  if (!raw) return "";
  const clean = sanitizeTerminalOutput(raw, { preserveTabs: false, tabSize: 2 });
  return clean;
}

/**
 * 1b. Sanitize streamed chunks directly.
 */
export function sanitizeStreamChunk(chunk: string): string {
  return sanitizeOutput(chunk);
}

/**
 * 2. Normalize: Normalizes text formatting for the box wrappers.
 * Replaces CRLF with LF and collapses excessive blank lines to prevent
 * vertical stretching and layout popping.
 */
export function normalizeOutput(clean: string): string {
  let normalized = clean.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Collapse excessive vertical whitespace (4+ newlines into 3)
  normalized = normalized.replace(/\n{4,}/g, "\n\n\n");

  // Remove lines that are purely known noise prefixes
  const lines = normalized.split("\n");
  const filteredLines = lines.filter((line) => !isNoiseLine(line));

  return filteredLines.join("\n");
}

/**
 * 3. Classify: Segments the normalized string into typed semantic blocks
 * such as prose, code blocks, diffs, lists, and headers.
 */
export function classifyOutput(normalized: string): Segment[] {
  return parseMarkdown(normalized);
}

/**
 * 4. Format For Box: Fits the classified segments to the actual box width safely.
 * We rely on the layout engine and wrapper to visually confine this later,
 * but this formalizes the wrapping boundaries at the data layer.
 */
export function formatForBox(classified: Segment[], boxWidth: number): Segment[] {
  return classified;
}
