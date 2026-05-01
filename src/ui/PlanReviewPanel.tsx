import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { normalizePlanReviewMarkdown } from "../core/planStorage.js";
import { getUsableShellWidth } from "./layout.js";
import { parseMarkdown } from "./Markdown.js";
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

function inlinePartsToText(parts: InlinePart[]): string {
  return parts.map((part) => part.text).join("");
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

export function buildPlanReviewDisplayRows(rows: PlanReviewRow[], width: number): PlanReviewDisplayRow[] {
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
  const displayRows = useMemo(() => buildPlanReviewDisplayRows(rows, contentWidth), [rows, contentWidth]);
  const topBorder = useMemo(() => buildTopBorder(panelCols, "Review Plan "), [panelCols]);

  return (
    <Box width="100%" flexDirection="column" paddingX={2}>
      <Text wrap="truncate">
        <Text color={theme.BORDER_SUBTLE}>{"╭─ "}</Text>
        <Text color={theme.TEXT} bold>{topBorder.title}</Text>
        <Text color={theme.BORDER_SUBTLE}>{topBorder.fill}</Text>
        <Text color={theme.BORDER_SUBTLE}>{"╮"}</Text>
      </Text>
      {displayRows.map((row, index) => (
        <Text key={index} wrap="truncate">
          <Text color={theme.BORDER_SUBTLE}>{"│ "}</Text>
          <Text color={row.tone === "muted" ? theme.MUTED : theme.TEXT} bold={row.bold}>
            {padVisual(row.text, contentWidth)}
          </Text>
          <Text color={theme.BORDER_SUBTLE}>{" │"}</Text>
        </Text>
      ))}
      <Text wrap="truncate" color={theme.BORDER_SUBTLE}>{`╰${"─".repeat(Math.max(1, panelCols - 2))}╯`}</Text>
    </Box>
  );
}
