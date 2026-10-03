import { sanitizeTerminalOutput } from "../../core/terminal/terminalSanitize.js";
import { wrapPlainText } from "../render/textLayout.js";

// ─── Types ───────────────────────────────────────────────────────────────────

// ─── Block selection ─────────────────────────────────────────────────────────

export function formatProgressBlockBodyLines(text: string, width: number): string[] {
  const contentWidth = Math.max(1, width);
  const normalized = sanitizeTerminalOutput(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n");

  if (!normalized.trim()) {
    return [" "];
  }

  const rows: string[] = [];
  for (const rawLine of normalized.split("\n")) {
    if (!rawLine.trim()) {
      rows.push("");
      continue;
    }

    const wrapped = wrapPlainText(rawLine, contentWidth);
    rows.push(...(wrapped.length > 0 ? wrapped : [" "]));
  }

  return rows.length > 0 ? rows : [" "];
}
