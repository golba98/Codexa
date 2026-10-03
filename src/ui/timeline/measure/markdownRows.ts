import { getTextWidth, wrapPlainText } from "../../../core/shared/text.js";

import { type DiffRenderLineType, maybeRenderDiff } from "../../render/diffRenderer.js";

import { isShellCodeLanguage, type Segment } from "../../render/Markdown.js";
import { buildPanelRows } from "./cards.js";
import {
  appendSpan,
  buildPrefixedContentRows,
  createSpan,
  padSpansToWidth,
  wrapStyledSpans,
} from "./rows.js";
import type { MarkdownInlinePart, TimelineRowSpan, TimelineTone } from "./types.js";

// ─── Markdown rendering ───────────────────────────────────────────────────────

function normalizeMarkdownParts(parts: unknown): MarkdownInlinePart[] {
  if (!Array.isArray(parts)) return [];
  return parts
    .filter(
      (part): part is MarkdownInlinePart =>
        typeof part === "object" &&
        part !== null &&
        "kind" in part &&
        "text" in part &&
        typeof (part as { kind: unknown }).kind === "string" &&
        typeof (part as { text: unknown }).text === "string",
    )
    .map((part) => ({
      kind: part.kind,
      text: part.text,
    }));
}

function inlinePartsToSpans(parts: MarkdownInlinePart[], tone: TimelineTone): TimelineRowSpan[] {
  const spans: TimelineRowSpan[] = [];
  parts.forEach((part) => {
    if (part.kind === "code") {
      appendSpan(spans, createSpan(part.text, "info"));
      return;
    }
    if (part.kind === "bold") {
      appendSpan(spans, createSpan(part.text, tone, { bold: true }));
      return;
    }
    appendSpan(spans, createSpan(part.text, tone));
  });
  return spans;
}

function buildWrappedMarkdownLine(
  parts: MarkdownInlinePart[],
  width: number,
  tone: TimelineTone,
): TimelineRowSpan[][] {
  return wrapStyledSpans(inlinePartsToSpans(parts, tone), width).map((row) =>
    padSpansToWidth(row, width),
  );
}

function getDiffTone(kind: DiffRenderLineType): TimelineTone {
  switch (kind) {
    case "add":
      return "success";
    case "remove":
      return "error";
    case "hunk":
      return "accent";
    case "file":
    case "meta":
      return "info";
    case "context":
    default:
      return "muted";
  }
}

function buildCodePanelRows(
  keyPrefix: string,
  segment: Extract<Segment, { type: "code" }>,
  width: number,
): TimelineRowSpan[][] {
  let title = segment.lang || "code";
  let codeLines = segment.lines;
  const firstLine = codeLines[0]?.trim() ?? "";
  if (/^[a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+$/.test(firstLine)) {
    title = firstLine;
    codeLines = codeLines.slice(1);
  }

  const panelWidth = Math.max(10, width - 2);
  const panelContentWidth = Math.max(1, panelWidth - 4);

  if (isShellCodeLanguage(segment.lang)) {
    const lang = segment.lang.toLowerCase();
    const marker =
      lang === "cmd" || lang === "bat" || lang === "batch" ? `REM ${lang}` : `# ${lang}`;
    return [marker, ...codeLines].flatMap((line, index) =>
      wrapPlainText(line, Math.max(1, width - 2)).map((wrapped) => [
        createSpan("  "),
        createSpan(wrapped || " ", index === 0 ? "dim" : "muted"),
      ]),
    );
  }

  const diffLines = maybeRenderDiff(codeLines.join("\n"), {
    force: segment.lang.toLowerCase() === "diff",
  });
  const contentRows: TimelineRowSpan[][] = [];

  if (diffLines) {
    diffLines.forEach((line) => {
      wrapPlainText(line.text, panelContentWidth).forEach((wrapped) => {
        contentRows.push([createSpan(wrapped || " ", getDiffTone(line.type))]);
      });
    });
  } else {
    codeLines.forEach((line, index) => {
      const wrappedRows = wrapPlainText(line, Math.max(1, panelContentWidth - 4));
      wrappedRows.forEach((wrapped, rowIndex) => {
        contentRows.push([
          createSpan(rowIndex === 0 ? `${String(index + 1).padStart(3, " ")} ` : "    ", "dim"),
          createSpan(wrapped || " ", "muted"),
        ]);
      });
    });
  }

  const panelRows = buildPanelRows({
    keyPrefix,
    width: panelWidth,
    title,
    contentRows,
  });

  return panelRows.map((row) => [createSpan("  "), ...padSpansToWidth(row.spans, panelWidth)]);
}

export function buildMarkdownRows(segments: Segment[], width: number): TimelineRowSpan[][] {
  const rows: TimelineRowSpan[][] = [];

  segments.forEach((segment, segmentIndex) => {
    const marginTop = segmentIndex > 0 ? 1 : 0;
    if (marginTop > 0) {
      rows.push([createSpan("")]);
    }

    if (segment.type === "code") {
      rows.push(...buildCodePanelRows(`code-${segmentIndex}`, segment, width));
      return;
    }

    if (segment.type === "header") {
      const parts = normalizeMarkdownParts(segment.parts);
      const prefix = segment.level <= 2 ? "✧ " : "• ";
      const prefixTone = segment.level === 1 ? "accent" : segment.level === 2 ? "text" : "muted";
      if (segment.level <= 2) {
        rows.push([createSpan("───", "borderSubtle")]);
      }
      rows.push(
        ...buildPrefixedContentRows(
          `header-${segmentIndex}`,
          [createSpan(prefix, prefixTone)],
          [createSpan("  ", prefixTone)],
          inlinePartsToSpans(parts, prefixTone),
          width,
        ).map((row) => row.spans),
      );
      return;
    }

    if (segment.type === "list") {
      segment.items.forEach((item, itemIndex) => {
        const prefix = segment.ordered ? `${item.num}. ` : "• ";
        rows.push(
          ...buildPrefixedContentRows(
            `list-${segmentIndex}-${itemIndex}`,
            [createSpan(prefix, "accent")],
            [createSpan(" ".repeat(getTextWidth(prefix)), "accent")],
            inlinePartsToSpans(normalizeMarkdownParts(item.parts), "text"),
            width,
          ).map((row) => row.spans),
        );
      });
      return;
    }

    // Paragraph segment — check if it looks like a unified diff so we can
    // apply colour-coded tones instead of the flat 'text' tone.
    const rawParaLines = segment.lines.map((parts) =>
      normalizeMarkdownParts(parts)
        .map((p) => p.text)
        .join(""),
    );
    const diffLines = maybeRenderDiff(rawParaLines.join("\n"));
    const diffLineByIndex = new Map<
      number,
      NonNullable<ReturnType<typeof maybeRenderDiff>>[number]
    >();
    diffLines?.forEach((line, index) => {
      diffLineByIndex.set(index, line);
    });

    segment.lines.forEach((parts, lineIndex) => {
      const normalizedParts = normalizeMarkdownParts(parts);
      const isBlank =
        normalizedParts.length === 1 &&
        normalizedParts[0]?.kind === "text" &&
        !normalizedParts[0].text.trim();
      if (isBlank) {
        return;
      }

      const diffLine = diffLineByIndex.get(lineIndex);
      if (diffLine) {
        wrapStyledSpans([createSpan(diffLine.text, getDiffTone(diffLine.type))], width).forEach(
          (row) => rows.push(padSpansToWidth(row, width)),
        );
        return;
      }

      rows.push(...buildWrappedMarkdownLine(normalizedParts, width, "text"));
    });
  });

  return rows.length > 0 ? rows : [];
}
