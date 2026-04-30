import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { getUsableShellWidth } from "./layout.js";
import { parseMarkdown } from "./Markdown.js";
import { normalizeOutput } from "./outputPipeline.js";
import { getTextWidth } from "./textLayout.js";
import { useTheme } from "./theme.js";

type InlinePart =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string };

type PlanReviewRow =
  | { type: "blank" }
  | { type: "header"; text: string }
  | { type: "bullet"; marker: string; text: string }
  | { type: "text"; text: string };

type PlanReviewDisplayRow = {
  text: string;
  tone: "text" | "muted";
  bold?: boolean;
};

const SECTION_LINE_RE = /^\s*(?:#{1,3}\s+)?(?:\*\*)?([A-Za-z][A-Za-z0-9 /&-]{0,48})(?:\*\*)?:?\s*$/;
const ABSOLUTE_WINDOWS_PATH_RE = /[A-Za-z]:[\\/][^\s`),;\]]+/g;

function inlinePartsToText(parts: InlinePart[]): string {
  return parts.map((part) => part.text).join("");
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function replaceAllLiteral(value: string, search: string, replacement: string): string {
  if (!search) return value;
  return value.split(search).join(replacement);
}

export function hidePlanReviewFilesystemDetails(planText: string, workspaceRoot?: string | null): string {
  let output = planText;
  const normalizedRoot = workspaceRoot?.trim() ? normalizePathSeparators(workspaceRoot.trim()).replace(/\/+$/, "") : "";

  if (normalizedRoot) {
    output = replaceAllLiteral(output, workspaceRoot!.replace(/\\+$/, ""), "");
    output = replaceAllLiteral(normalizePathSeparators(output), normalizedRoot, "");
    output = output.replace(/(^|[\s(`])\/+([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/g, "$1$2");
  }

  return output.replace(ABSOLUTE_WINDOWS_PATH_RE, (match) => {
    const normalized = normalizePathSeparators(match);
    const srcIndex = normalized.search(/(?:^|\/)(src|test|tests|docs|scripts|bin)\//);
    if (srcIndex >= 0) {
      return normalized.slice(normalized[srcIndex] === "/" ? srcIndex + 1 : srcIndex);
    }
    const parts = normalized.split("/").filter(Boolean);
    return parts.slice(-2).join("/") || match;
  });
}

export function normalizePlanReviewMarkdown(planText: string, workspaceRoot?: string | null): string {
  const sanitized = sanitizeTerminalOutput(hidePlanReviewFilesystemDetails(planText, workspaceRoot), {
    preserveTabs: false,
    tabSize: 2,
  });
  const normalized = normalizeOutput(sanitized);

  return normalized
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const sectionMatch = SECTION_LINE_RE.exec(trimmed);
      if (sectionMatch && !/^[-*]\s+/.test(trimmed) && !/^\d+\.\s+/.test(trimmed)) {
        return `## ${sectionMatch[1]!.trim()}`;
      }
      return line;
    })
    .join("\n");
}

export function buildPlanReviewRows(planText: string, workspaceRoot?: string | null): PlanReviewRow[] {
  const normalized = normalizePlanReviewMarkdown(planText, workspaceRoot);
  const segments = parseMarkdown(normalized);
  const rows: PlanReviewRow[] = [];

  for (const segment of segments) {
    if (rows.length > 0) rows.push({ type: "blank" });

    if (segment.type === "header") {
      rows.push({ type: "header", text: inlinePartsToText(segment.parts as InlinePart[]) });
      continue;
    }

    if (segment.type === "list") {
      for (const item of segment.items) {
        rows.push({
          type: "bullet",
          marker: segment.ordered ? `${item.num}.` : "•",
          text: inlinePartsToText(item.parts as InlinePart[]),
        });
      }
      continue;
    }

    if (segment.type === "para") {
      for (const line of segment.lines) {
        const text = inlinePartsToText(line as InlinePart[]).trim();
        if (text) rows.push({ type: "text", text });
      }
      continue;
    }

    if (segment.type === "code") {
      for (const line of segment.lines) {
        rows.push({ type: "text", text: line });
      }
    }
  }

  return rows.filter((row, index) => !(row.type === "blank" && rows[index - 1]?.type === "blank"));
}

function padVisual(text: string, width: number): string {
  const currentWidth = getTextWidth(text);
  if (currentWidth >= width) return text;
  return `${text}${" ".repeat(width - currentWidth)}`;
}

function splitLongWord(word: string, width: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const char of Array.from(word)) {
    if (current && getTextWidth(current + char) > width) {
      chunks.push(current);
      current = char;
    } else {
      current += char;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function wrapReviewText(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let current = "";

  for (const word of words) {
    if (getTextWidth(word) > safeWidth) {
      if (current) {
        rows.push(current);
        current = "";
      }
      rows.push(...splitLongWord(word, safeWidth));
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (getTextWidth(candidate) <= safeWidth) {
      current = candidate;
    } else {
      if (current) rows.push(current);
      current = word;
    }
  }

  if (current) rows.push(current);
  return rows.length > 0 ? rows : [""];
}

function buildDisplayRows(rows: PlanReviewRow[], width: number): PlanReviewDisplayRow[] {
  const displayRows: PlanReviewDisplayRow[] = [];

  for (const row of rows) {
    if (row.type === "blank") {
      displayRows.push({ text: " ", tone: "muted" });
      continue;
    }

    if (row.type === "header") {
      for (const line of wrapReviewText(row.text, width)) {
        displayRows.push({ text: line || " ", tone: "text", bold: true });
      }
      continue;
    }

    if (row.type === "bullet") {
      const markerWidth = Math.max(2, getTextWidth(row.marker) + 1);
      const bodyWidth = Math.max(1, width - markerWidth);
      const wrapped = wrapReviewText(row.text, bodyWidth);

      wrapped.forEach((line, index) => {
        displayRows.push({
          text: `${index === 0 ? `${row.marker} ` : " ".repeat(markerWidth)}${line || " "}`,
          tone: "text",
        });
      });
      continue;
    }

    for (const line of wrapReviewText(row.text, width)) {
      displayRows.push({ text: line || " ", tone: "text" });
    }
  }

  return displayRows;
}

function buildTopBorder(width: number, title: string): { title: string; fill: string } {
  const prefixWidth = 3;
  const titleWidth = getTextWidth(title);
  const suffixWidth = 1;
  const fillCount = Math.max(1, width - prefixWidth - titleWidth - suffixWidth);
  return { title, fill: "─".repeat(fillCount) };
}

export function PlanReviewPanel({
  planText,
  cols,
  workspaceRoot,
}: {
  planText: string;
  cols: number;
  workspaceRoot?: string | null;
}) {
  const theme = useTheme();
  const panelCols = Math.min(Math.max(20, getUsableShellWidth(cols) - 4), 96);
  const contentWidth = Math.max(1, panelCols - 4);
  const rows = useMemo(() => buildPlanReviewRows(planText, workspaceRoot), [planText, workspaceRoot]);
  const displayRows = useMemo(() => buildDisplayRows(rows, contentWidth), [rows, contentWidth]);
  const topBorder = useMemo(() => buildTopBorder(panelCols, "Review Plan "), [panelCols]);

  return (
    <Box width="100%" flexDirection="column" paddingX={2}>
      <Text wrap="truncate">
        <Text color={theme.ACCENT}>{"╭─ "}</Text>
        <Text color={theme.TEXT} bold>{topBorder.title}</Text>
        <Text color={theme.ACCENT}>{`${topBorder.fill}╮`}</Text>
      </Text>
      {displayRows.map((row, index) => (
        <Text key={index} wrap="truncate">
          <Text color={theme.ACCENT}>{"│ "}</Text>
          <Text color={row.tone === "muted" ? theme.MUTED : theme.TEXT} bold={row.bold}>
            {padVisual(row.text, contentWidth)}
          </Text>
          <Text color={theme.ACCENT}>{" │"}</Text>
        </Text>
      ))}
      <Text wrap="truncate" color={theme.ACCENT}>{`╰${"─".repeat(Math.max(1, panelCols - 2))}╯`}</Text>
    </Box>
  );
}
