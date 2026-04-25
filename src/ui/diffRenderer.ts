import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";

export type DiffRenderLineType = "file" | "hunk" | "add" | "remove" | "context" | "meta";

export interface DiffRenderLine {
  type: DiffRenderLineType;
  text: string;
}

export interface DiffRenderOptions {
  force?: boolean;
}

const DIFF_GIT_HEADER_PATTERN = /^diff --git\s+/;
const HUNK_HEADER_PATTERN = /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s*@@/;
const INDEX_HEADER_PATTERN = /^index\s+\S+\.\.\S+/;
const OLD_FILE_HEADER_PATTERN = /^---\s+\S+/;
const NEW_FILE_HEADER_PATTERN = /^\+\+\+\s+\S+/;
const ADD_LINE_PATTERN = /^\+(?!\+\+)/;
const REMOVE_LINE_PATTERN = /^-(?!--)/;

function normalizeDiffText(text: string): string {
  return sanitizeTerminalOutput(text, { preserveTabs: false, tabSize: 2 })
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function getDiffLines(text: string): string[] {
  return normalizeDiffText(text)
    .split("\n")
    .map((line) => line.trimEnd());
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]?.trim() === "") start += 1;
  while (end > start && lines[end - 1]?.trim() === "") end -= 1;

  return lines.slice(start, end);
}

function hasPairedFileHeaders(lines: readonly string[]): boolean {
  return lines.some((line) => OLD_FILE_HEADER_PATTERN.test(line))
    && lines.some((line) => NEW_FILE_HEADER_PATTERN.test(line));
}

function hasStrongDiffSignal(lines: readonly string[]): boolean {
  return lines.some((line) =>
    DIFF_GIT_HEADER_PATTERN.test(line)
    || HUNK_HEADER_PATTERN.test(line)
    || INDEX_HEADER_PATTERN.test(line)
  ) || hasPairedFileHeaders(lines);
}

function hasRealChangeLine(lines: readonly string[]): boolean {
  return lines.some((line) => ADD_LINE_PATTERN.test(line) || REMOVE_LINE_PATTERN.test(line));
}

function shouldRenderUnifiedDiff(lines: readonly string[], options: DiffRenderOptions = {}): boolean {
  if (lines.length < 2) return false;
  if (options.force) {
    return hasStrongDiffSignal(lines) || hasRealChangeLine(lines);
  }
  return hasStrongDiffSignal(lines) && hasRealChangeLine(lines);
}

export function classifyDiffLine(line: string): DiffRenderLineType {
  if (DIFF_GIT_HEADER_PATTERN.test(line) || OLD_FILE_HEADER_PATTERN.test(line) || NEW_FILE_HEADER_PATTERN.test(line)) {
    return "file";
  }

  if (HUNK_HEADER_PATTERN.test(line) || line.startsWith("@@")) {
    return "hunk";
  }

  if (ADD_LINE_PATTERN.test(line)) {
    return "add";
  }

  if (REMOVE_LINE_PATTERN.test(line)) {
    return "remove";
  }

  if (INDEX_HEADER_PATTERN.test(line) || line.startsWith("\\ No newline")) {
    return "meta";
  }

  return "context";
}

export function isUnifiedDiff(text: string, options: DiffRenderOptions = {}): boolean {
  return shouldRenderUnifiedDiff(trimBlankEdges(getDiffLines(text)), options);
}

export function renderUnifiedDiff(text: string, options: DiffRenderOptions = {}): DiffRenderLine[] {
  const lines = trimBlankEdges(getDiffLines(text));
  if (lines.length === 0) {
    return [];
  }

  if (!shouldRenderUnifiedDiff(lines, options)) {
    return [];
  }

  return lines.map((line) => ({
    type: classifyDiffLine(line),
    text: line,
  }));
}

export function maybeRenderDiff(text: string, options: DiffRenderOptions = {}): DiffRenderLine[] | null {
  const rendered = renderUnifiedDiff(text, options);
  return rendered.length > 0 ? rendered : null;
}
