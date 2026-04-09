import type { RunEvent, ShellEvent } from "../session/types.js";
import { RUN_OUTPUT_TRUNCATION_NOTICE } from "../session/chatLifecycle.js";
import { sanitizeTerminalLines, sanitizeTerminalOutput } from "../core/terminalSanitize.js";
import { clampVisualText } from "./layout.js";
import type { Segment } from "./Markdown.js";
import { classifyOutput, formatForBox, normalizeOutput, sanitizeOutput, sanitizeStreamChunk } from "./outputPipeline.js";
import { selectVisibleRunActivity } from "./runActivityView.js";
import { getTextUnits, getTextWidth, wrapPlainText } from "./textLayout.js";
import type { RenderTimelineItem } from "./Timeline.js";

export type TimelineTone =
  | "text"
  | "dim"
  | "muted"
  | "accent"
  | "info"
  | "error"
  | "warning"
  | "success"
  | "borderSubtle"
  | "borderActive"
  | "panel"
  | "star";

export interface TimelineRowSpan {
  text: string;
  tone?: TimelineTone;
  bold?: boolean;
  backgroundTone?: TimelineTone;
}

export interface TimelineRow {
  key: string;
  spans: TimelineRowSpan[];
}

export interface BuiltTimelineItem {
  key: string;
  rows: TimelineRow[];
  rowCount: number;
}

export interface TimelineSnapshot {
  items: BuiltTimelineItem[];
  rows: TimelineRow[];
  totalRows: number;
  itemCount: number;
}

interface MarkdownInlinePart {
  kind: "text" | "code" | "bold";
  text: string;
}

const MAX_SHELL_FAILURE_EXCERPT_LINES = 3;
const MAX_VISIBLE_THINKING_LINES = 5;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

function createSpan(
  text: string,
  tone?: TimelineTone,
  options: Pick<TimelineRowSpan, "bold" | "backgroundTone"> = {},
): TimelineRowSpan {
  return {
    text,
    tone,
    bold: options.bold,
    backgroundTone: options.backgroundTone,
  };
}

function spansEqual(left: TimelineRowSpan | undefined, right: TimelineRowSpan): boolean {
  return left?.tone === right.tone
    && left?.bold === right.bold
    && left?.backgroundTone === right.backgroundTone;
}

function appendSpan(target: TimelineRowSpan[], span: TimelineRowSpan) {
  if (!span.text) return;
  const previous = target[target.length - 1];
  if (previous && spansEqual(previous, span)) {
    previous.text += span.text;
    return;
  }
  target.push({ ...span });
}

function cloneSpan(span: TimelineRowSpan, text = span.text): TimelineRowSpan {
  return {
    text,
    tone: span.tone,
    bold: span.bold,
    backgroundTone: span.backgroundTone,
  };
}

function getSpansWidth(spans: TimelineRowSpan[]): number {
  return spans.reduce((width, span) => width + getTextWidth(span.text), 0);
}

function padSpansToWidth(spans: TimelineRowSpan[], width: number): TimelineRowSpan[] {
  const safeWidth = Math.max(0, width);
  const next = spans.map((span) => ({ ...span }));
  const currentWidth = getSpansWidth(next);
  if (currentWidth < safeWidth) {
    appendSpan(next, createSpan(" ".repeat(safeWidth - currentWidth)));
  }
  return next;
}

function createRow(key: string, spans: TimelineRowSpan[], width: number): TimelineRow {
  return {
    key,
    spans: padSpansToWidth(spans, width),
  };
}

function createBlankRow(key: string, width: number): TimelineRow {
  return createRow(key, [createSpan(" ".repeat(Math.max(0, width)))], width);
}

function wrapStyledSpans(spans: TimelineRowSpan[], width: number): TimelineRowSpan[][] {
  const safeWidth = Math.max(1, width);
  const rows: TimelineRowSpan[][] = [];
  let currentRow: TimelineRowSpan[] = [];
  let currentWidth = 0;

  const pushRow = () => {
    rows.push(currentRow.length > 0 ? currentRow : [createSpan("")]);
    currentRow = [];
    currentWidth = 0;
  };

  for (const span of spans) {
    for (const unit of getTextUnits(span.text)) {
      if (unit.text === "\n") {
        pushRow();
        continue;
      }

      if (currentWidth > 0 && currentWidth + unit.width > safeWidth) {
        pushRow();
      }

      appendSpan(currentRow, cloneSpan(span, unit.text));
      currentWidth += unit.width;
    }
  }

  if (currentRow.length === 0 && rows.length === 0) {
    rows.push([createSpan("")]);
  } else if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

function buildPrefixedContentRows(
  keyPrefix: string,
  marker: TimelineRowSpan[],
  continuationMarker: TimelineRowSpan[],
  content: TimelineRowSpan[],
  width: number,
): TimelineRow[] {
  const markerWidth = Math.max(0, getSpansWidth(marker));
  const bodyWidth = Math.max(1, width - markerWidth);
  const wrappedRows = wrapStyledSpans(content, bodyWidth);

  return wrappedRows.map((row, index) => createRow(
    `${keyPrefix}-${index}`,
    [
      ...(index === 0 ? marker : continuationMarker),
      ...padSpansToWidth(row, bodyWidth),
    ],
    width,
  ));
}

function buildIndentedRows(
  keyPrefix: string,
  rows: TimelineRowSpan[][],
  width: number,
  indent: number,
): TimelineRow[] {
  const safeIndent = Math.max(0, indent);
  const contentWidth = Math.max(1, width - safeIndent);
  return rows.map((row, index) => createRow(
    `${keyPrefix}-${index}`,
    [
      createSpan(" ".repeat(safeIndent)),
      ...padSpansToWidth(row, contentWidth),
    ],
    width,
  ));
}

function buildPlainRows(
  keyPrefix: string,
  lines: string[],
  width: number,
  tone?: TimelineTone,
): TimelineRowSpan[][] {
  return lines.flatMap((line, index) => wrapPlainText(line, Math.max(1, width)).map((row, rowIndex) => (
    [createSpan(row || " ", tone)]
  )));
}

function buildTopBorder(width: number, title: string, rightBadge?: string): TimelineRowSpan[] {
  const safeWidth = Math.max(4, width);
  const prefixWidth = 4;
  const titleWidth = getTextWidth(title);
  const badgeWidth = rightBadge ? getTextWidth(rightBadge) : 0;
  const suffixWidth = rightBadge ? 4 : 3;
  const fillCount = Math.max(1, safeWidth - prefixWidth - titleWidth - badgeWidth - suffixWidth - 2);

  const spans: TimelineRowSpan[] = [
    createSpan("╭── ", "borderSubtle"),
    createSpan(title, "muted", { bold: true }),
    createSpan(` ${"─".repeat(fillCount)} `, "borderSubtle"),
  ];

  if (rightBadge) {
    spans.push(createSpan(rightBadge, "dim"));
    spans.push(createSpan(" ──╮", "borderSubtle"));
  } else {
    spans.push(createSpan("──╮", "borderSubtle"));
  }

  return spans;
}

function buildDashCardRows(params: {
  keyPrefix: string;
  width: number;
  title: string;
  rightBadge?: string;
  borderTone?: TimelineTone;
  titleTone?: TimelineTone;
  badgeTone?: TimelineTone;
  contentRows: TimelineRowSpan[][];
}): TimelineRow[] {
  const width = Math.max(4, params.width);
  const contentWidth = Math.max(1, width - 4);
  const borderTone = params.borderTone ?? "borderSubtle";
  const titleTone = params.titleTone ?? "muted";
  const badgeTone = params.badgeTone ?? "dim";
  const topBase = buildTopBorder(width, params.title, params.rightBadge);
  const topRow = topBase.map((span) => {
    if (span.tone === "muted") return { ...span, tone: titleTone };
    if (span.tone === "dim") return { ...span, tone: badgeTone };
    return { ...span, tone: borderTone };
  });

  const rows: TimelineRow[] = [createRow(`${params.keyPrefix}-top`, topRow, width)];

  params.contentRows.forEach((row, index) => {
    rows.push(createRow(
      `${params.keyPrefix}-content-${index}`,
      [
        createSpan("│ ", borderTone),
        ...padSpansToWidth(row, contentWidth),
        createSpan(" │", borderTone),
      ],
      width,
    ));
  });

  rows.push(createRow(
    `${params.keyPrefix}-bottom`,
    [createSpan(`╰${"─".repeat(Math.max(1, width - 2))}╯`, borderTone)],
    width,
  ));

  return rows;
}

function buildPanelRows(params: {
  keyPrefix: string;
  width: number;
  title: string;
  rightTitle?: string;
  contentRows: TimelineRowSpan[][];
}): TimelineRow[] {
  const width = Math.max(10, params.width);
  const leftLabel = ` ${params.title} `;
  const rightLabel = params.rightTitle ? ` ${params.rightTitle} ` : "";
  const dashCount = Math.max(0, width - 3 - getTextWidth(leftLabel) - getTextWidth(rightLabel));
  const rows: TimelineRow[] = [
    createRow(
      `${params.keyPrefix}-top`,
      [
        createSpan("╭─", "borderActive"),
        createSpan(leftLabel, "text"),
        createSpan("─".repeat(dashCount), "borderActive"),
        ...(params.rightTitle ? [createSpan(rightLabel, "dim")] : []),
        createSpan("╮", "borderActive"),
      ],
      width,
    ),
  ];

  const contentWidth = Math.max(1, width - 4);
  params.contentRows.forEach((row, index) => {
    rows.push(createRow(
      `${params.keyPrefix}-content-${index}`,
      [
        createSpan("│ ", "borderActive"),
        ...padSpansToWidth(row, contentWidth),
        createSpan(" │", "borderActive"),
      ],
      width,
    ));
  });

  rows.push(createRow(
    `${params.keyPrefix}-bottom`,
    [createSpan(`╰${"─".repeat(Math.max(1, width - 2))}╯`, "borderActive")],
    width,
  ));

  return rows;
}

function buildUserInputRows(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number): TimelineRow[] {
  const runStatus = item.item.run?.status ?? null;
  const statusBadge = runStatus
    ? runStatus === "running"
      ? "active"
      : runStatus === "completed"
        ? "done"
        : runStatus
    : "queued";
  const dim = item.renderState.opacity === "dim";
  const contentWidth = Math.max(1, width - 4);
  const lines = wrapPlainText(sanitizeTerminalOutput(item.item.user?.prompt ?? ""), Math.max(1, contentWidth - 2))
    .map((line, index) => [
      createSpan(index === 0 ? "> " : "  ", dim ? "dim" : "text"),
      createSpan(line || " ", dim ? "dim" : "text"),
    ]);

  return buildDashCardRows({
    keyPrefix: `${item.key}-user`,
    width,
    title: "USER INPUT",
    rightBadge: statusBadge,
    borderTone: dim
      ? "borderSubtle"
      : runStatus === "running"
        ? "borderActive"
        : "borderSubtle",
    contentRows: lines,
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildTaskStatusRow(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number): TimelineRow {
  const run = item.item.run!;
  const frame = SPINNER_FRAMES[Math.floor(Date.now() / 90) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
  const isActive = run.status === "running";
  let phaseText: string;
  let badge: string;

  if (run.status !== "running") {
    phaseText = "Complete";
    badge = run.status === "failed" ? "failed" : "done";
  } else if (item.renderState.runPhase === "streaming") {
    phaseText = "Streaming response ...";
    badge = "active";
  } else {
    phaseText = "Receiving response ...";
    badge = "active";
  }

  const leftSpans: TimelineRowSpan[] = [
    createSpan("✧ ", "star"),
    ...(isActive ? [createSpan(`${frame} `, "info")] : []),
    createSpan(`Task: ${phaseText}`, "text"),
  ];
  const durationText = run.durationMs != null ? ` ${formatDuration(run.durationMs)}` : "";
  const rightText = `${badge}${durationText}`;
  const leftWidth = getSpansWidth(leftSpans);
  const rightWidth = getTextWidth(rightText);
  const padding = Math.max(1, width - leftWidth - rightWidth);

  return createRow(
    `${item.key}-status`,
    [
      createSpan(" ", undefined),
      ...leftSpans,
      createSpan(" ".repeat(Math.max(0, padding - 1))),
      createSpan(rightText, "dim"),
    ],
    width,
  );
}

function getShellFailureExcerpt(event: ShellEvent): string[] {
  const source = event.stderrLines.length > 0 ? event.stderrLines : event.lines;
  const summary = sanitizeTerminalOutput(event.summary ?? "").trim().toLowerCase();
  return sanitizeTerminalLines(source)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => !(index === 0 && summary && line.toLowerCase() === summary))
    .slice(0, MAX_SHELL_FAILURE_EXCERPT_LINES);
}

// Fixed total content rows inside the thinking card (MAX_VISIBLE_THINKING_LINES + 1 tool row)
const THINKING_CARD_ROWS = MAX_VISIBLE_THINKING_LINES + 1;

function buildThinkingRows(run: RunEvent, width: number): TimelineRow[] {
  const latestTool = run.toolActivities[run.toolActivities.length - 1] ?? null;
  const toolLine = latestTool
    ? latestTool.status === "running"
      ? `running: ${latestTool.command}`
      : latestTool.summary ?? latestTool.command
    : null;
  const thinkingLines = run.thinkingLines ?? [];
  const hiddenCount = Math.max(0, thinkingLines.length - MAX_VISIBLE_THINKING_LINES);
  const visibleLines = thinkingLines.slice(-MAX_VISIBLE_THINKING_LINES);
  const contentWidth = Math.max(1, width - 4);
  const contentRows: TimelineRowSpan[][] = [];

  const hasContent = thinkingLines.length > 0 || toolLine;

  if (!hasContent) {
    // Placeholder while waiting
    contentRows.push([createSpan("Waiting for response...", "dim")]);
  } else if (hiddenCount > 0) {
    contentRows.push([createSpan(`... ${hiddenCount} more above`, "dim")]);
  }

  // Truncate each thinking line to a single row instead of wrapping
  if (hasContent) {
    visibleLines.forEach((line) => {
      const clamped = clampVisualText(line, contentWidth);
      contentRows.push([createSpan(clamped || " ", "muted")]);
    });
  }

  // Pad to fixed count (before tool row) so card height is stable
  while (contentRows.length < MAX_VISIBLE_THINKING_LINES) {
    contentRows.push([createSpan(" ", "dim")]);
  }

  // Always include a tool status row (blank if no tool activity)
  if (toolLine) {
    const clampedTool = clampVisualText(toolLine, Math.max(1, contentWidth - 2));
    contentRows.push([
      createSpan("• ", "info"),
      createSpan(clampedTool, "info"),
    ]);
  } else {
    contentRows.push([createSpan(" ", "dim")]);
  }

  return buildDashCardRows({
    keyPrefix: `${run.turnId}-thinking`,
    width,
    title: "Processing",
    rightBadge: "active",
    borderTone: "borderActive",
    contentRows,
  });
}

function normalizeMarkdownParts(parts: unknown): MarkdownInlinePart[] {
  if (!Array.isArray(parts)) return [];
  return parts
    .filter((part): part is MarkdownInlinePart => (
      typeof part === "object"
      && part !== null
      && ("kind" in part)
      && ("text" in part)
      && typeof (part as { kind: unknown }).kind === "string"
      && typeof (part as { text: unknown }).text === "string"
    ))
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
  keyPrefix: string,
  parts: MarkdownInlinePart[],
  width: number,
  tone: TimelineTone,
): TimelineRowSpan[][] {
  return wrapStyledSpans(inlinePartsToSpans(parts, tone), width)
    .map((row, index) => padSpansToWidth(row, width));
}

function getDiffTone(line: string): TimelineTone {
  if (line.startsWith("+") && !line.startsWith("+++")) return "success";
  if (line.startsWith("-") && !line.startsWith("---")) return "error";
  if (line.startsWith("@@")) return "accent";
  if (
    line.startsWith("diff --")
    || line.startsWith("index ")
    || line.startsWith("+++ ")
    || line.startsWith("--- ")
  ) {
    return "info";
  }
  return "muted";
}

function buildCodePanelRows(keyPrefix: string, segment: Extract<Segment, { type: "code" }>, width: number): TimelineRowSpan[][] {
  let title = segment.lang || "code";
  let codeLines = segment.lines;
  const firstLine = codeLines[0]?.trim() ?? "";
  if (/^[a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+$/.test(firstLine)) {
    title = firstLine;
    codeLines = codeLines.slice(1);
  }

  const rightTitle = segment.lang ? `${segment.lang.toUpperCase()} ⎘ Copy Code` : "⎘ Copy Code";
  const panelWidth = Math.max(10, width - 2);
  const panelContentWidth = Math.max(1, panelWidth - 4);
  const isDiffBlock = segment.lang.toLowerCase() === "diff"
    || codeLines.some((line) => (
      line.startsWith("+")
      || line.startsWith("-")
      || line.startsWith("@@")
      || line.startsWith("diff --")
      || line.startsWith("index ")
      || line.startsWith("+++ ")
      || line.startsWith("--- ")
    ));
  const contentRows: TimelineRowSpan[][] = [];

  codeLines.forEach((line, index) => {
    if (isDiffBlock) {
      wrapPlainText(line, panelContentWidth).forEach((wrapped) => {
        contentRows.push([createSpan(wrapped || " ", getDiffTone(line))]);
      });
      return;
    }

    const wrappedRows = wrapPlainText(line, Math.max(1, panelContentWidth - 4));
    wrappedRows.forEach((wrapped, rowIndex) => {
      contentRows.push([
        createSpan(rowIndex === 0 ? `${String(index + 1).padStart(3, " ")} ` : "    ", "dim"),
        createSpan(wrapped || " ", "muted"),
      ]);
    });
  });

  const panelRows = buildPanelRows({
    keyPrefix,
    width: panelWidth,
    title,
    rightTitle,
    contentRows,
  });

  return panelRows.map((row) => [
    createSpan("  "),
    ...padSpansToWidth(row.spans, panelWidth),
  ]);
}

function buildMarkdownRows(segments: Segment[], width: number): TimelineRowSpan[][] {
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
      rows.push(...buildPrefixedContentRows(
        `header-${segmentIndex}`,
        [createSpan(prefix, prefixTone)],
        [createSpan("  ", prefixTone)],
        inlinePartsToSpans(parts, prefixTone),
        width,
      ).map((row) => row.spans));
      return;
    }

    if (segment.type === "list") {
      segment.items.forEach((item, itemIndex) => {
        const prefix = segment.ordered ? `${item.num}. ` : "• ";
        rows.push(...buildPrefixedContentRows(
          `list-${segmentIndex}-${itemIndex}`,
          [createSpan(prefix, "accent")],
          [createSpan(" ".repeat(getTextWidth(prefix)), "accent")],
          inlinePartsToSpans(normalizeMarkdownParts(item.parts), "text"),
          width,
        ).map((row) => row.spans));
      });
      return;
    }

    segment.lines.forEach((parts, lineIndex) => {
      const normalizedParts = normalizeMarkdownParts(parts);
      const isBlank = normalizedParts.length === 1
        && normalizedParts[0]?.kind === "text"
        && !normalizedParts[0].text.trim();
      if (isBlank) {
        return;
      }
      rows.push(...buildWrappedMarkdownLine(`para-${segmentIndex}-${lineIndex}`, normalizedParts, width, "text"));
    });
  });

  return rows.length > 0 ? rows : [];
}

function buildAgentRows(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number): TimelineRow[] {
  const run = item.item.run!;
  const assistant = item.item.assistant;
  const streaming = item.renderState.runPhase === "streaming";
  const dim = item.renderState.opacity !== "active";
  const contentWidth = Math.max(1, width);
  const rawContent = assistant?.content ?? "";
  const sanitized = streaming ? sanitizeStreamChunk(rawContent) : sanitizeOutput(rawContent);
  const normalized = normalizeOutput(sanitized);
  const segments = formatForBox(classifyOutput(normalized), contentWidth);
  const contentRows: TimelineRowSpan[][] = [];

  if (!streaming && run.status === "failed") {
    const failureMessage = sanitizeTerminalOutput(run.errorMessage ?? run.summary);
    wrapPlainText(failureMessage, contentWidth).forEach((row, index) => {
      contentRows.push([
        createSpan(index === 0 ? "✕ " : "  ", "error"),
        createSpan(row || " ", "error"),
      ]);
    });
  }

  contentRows.push(...buildMarkdownRows(segments, contentWidth));

  if (streaming) {
    contentRows.push([
      createSpan("  "),
      createSpan("▌", "accent"),
    ]);
  }

  if (!streaming && run.status !== "running") {
    if (run.status === "canceled") {
      contentRows.push([createSpan(sanitizeTerminalOutput(run.summary), "warning")]);
    } else if (run.status === "completed" && normalized.length === 0) {
      contentRows.push([createSpan("(no output)", "dim")]);
    }

    if (run.truncatedOutput) {
      contentRows.push([createSpan(RUN_OUTPUT_TRUNCATION_NOTICE, "dim")]);
    }
  }

  const heading = run.model ? run.model.toUpperCase().replace(/-/g, " ") : "AGENT RESPONSE";
  const runStatus = streaming
    ? "streaming"
    : run.status === "completed"
      ? "complete"
      : run.status ?? "running";
  const rightBadge = run.durationMs != null && !streaming
    ? `${runStatus} • ${formatDuration(run.durationMs)}`
    : runStatus;

  const borderTone = dim ? "borderSubtle" : streaming ? "borderActive" : "borderSubtle";

  const rows: TimelineRow[] = [];

  // 1. Add top margin for separation
  rows.push(createBlankRow(`${item.key}-agent-top-gap`, width));

  // 2. Build prominent execution block header
  const title = ` EXECUTION: ${heading} `;
  const rightLabel = rightBadge ? ` ${rightBadge} ` : "";
  const dashCount = Math.max(0, width - 2 - getTextWidth(title) - getTextWidth(rightLabel));
  const topRowSpans: TimelineRowSpan[] = [
    createSpan("──", borderTone),
    createSpan(title, "text", { bold: true }),
    createSpan("─".repeat(dashCount), borderTone),
    ...(rightBadge ? [createSpan(rightLabel, "dim")] : []),
  ];
  rows.push(createRow(`${item.key}-agent-header`, topRowSpans, width));

  // 3. Add header content margin
  rows.push(createBlankRow(`${item.key}-agent-header-gap`, width));

  // 4. Add the actual content rows
  contentRows.forEach((row, index) => {
    rows.push(createRow(`${item.key}-agent-content-${index}`, padSpansToWidth(row, width), width));
  });

  // 5. Add bottom margin
  rows.push(createBlankRow(`${item.key}-agent-bottom-gap`, width));

  return rows;
}

function buildFileScanRows(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number): TimelineRow[] {
  const run = item.item.run!;
  const { visible, hiddenCount } = selectVisibleRunActivity(run);
  const contentRows: TimelineRowSpan[][] = [];

  if (hiddenCount > 0) {
    contentRows.push([createSpan(`... ${hiddenCount} more`, "dim")]);
  }

  visible.forEach((file) => {
    contentRows.push([
      createSpan("● ", "success"),
      createSpan(file.path, "text"),
    ]);
  });

  return buildDashCardRows({
    keyPrefix: `${item.key}-files`,
    width,
    title: "Scanning workspace ...",
    rightBadge: `${run.touchedFileCount} file${run.touchedFileCount === 1 ? "" : "s"}`,
    contentRows,
  });
}

function buildActivityRows(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number): TimelineRow[] {
  const run = item.item.run!;
  const contentWidth = Math.max(1, width - 4);
  const contentRows: TimelineRowSpan[][] = [];

  run.toolActivities.forEach((tool, index) => {
    const icon = tool.status === "failed" ? "✕" : "✓";
    const iconTone = tool.status === "failed" ? "error" : "success";
    const duration = tool.completedAt && tool.startedAt
      ? ` • ${formatDuration(tool.completedAt - tool.startedAt)}`
      : "";
    const headRows = wrapPlainText(tool.command, Math.max(1, contentWidth - 2));
    headRows.forEach((row, rowIndex) => {
      contentRows.push([
        createSpan(rowIndex === 0 ? `${icon} ` : "  ", iconTone),
        createSpan(row || " ", "text"),
        ...(rowIndex === 0 && duration ? [createSpan(duration, "dim")] : []),
      ]);
    });
    if (tool.summary) {
      wrapPlainText(tool.summary, Math.max(1, contentWidth - 2)).forEach((row) => {
        contentRows.push([
          createSpan("  "),
          createSpan(row || " ", "muted"),
        ]);
      });
    }
    if (index < run.toolActivities.length - 1) {
      contentRows.push([createSpan("")]);
    }
  });

  return buildDashCardRows({
    keyPrefix: `${item.key}-activity`,
    width,
    title: "Activity",
    rightBadge: "done",
    contentRows,
  });
}

function buildActionRequiredRows(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number): TimelineRow[] {
  const question = item.renderState.question;
  if (!question) return [];

  const contentWidth = Math.max(1, width - 4);
  const wrappedQuestion = question
    .split("\n")
    .flatMap((line) => {
      const rows = wrapPlainText(line, contentWidth);
      return rows.length > 0 ? rows : [""];
    });

  const rows: TimelineRow[] = [
    createRow(`${item.key}-question-top`, [createSpan(`┌${"─".repeat(Math.max(1, width - 2))}┐`, "borderActive")], width),
  ];

  const title = `[${item.item.turnIndex}] ACTION REQUIRED`;
  const titleWidth = getTextWidth(title) + getTextWidth("⚡");
  const padding = Math.max(1, contentWidth - titleWidth);
  rows.push(createRow(
    `${item.key}-question-title`,
    [
      createSpan("│ ", "borderActive"),
      createSpan(title, "text", { bold: true }),
      createSpan(" ".repeat(padding)),
      createSpan("⚡", "text", { bold: true }),
      createSpan(" │", "borderActive"),
    ],
    width,
  ));
  rows.push(createBlankRow(`${item.key}-question-gap`, width));
  rows.push(createRow(
    `${item.key}-question-label`,
    [
      createSpan("│ ", "borderActive"),
      createSpan("Verification Question", "text", { bold: true }),
      createSpan(" ".repeat(Math.max(0, contentWidth - getTextWidth("Verification Question")))),
      createSpan(" │", "borderActive"),
    ],
    width,
  ));

  wrappedQuestion.forEach((row, index) => {
    rows.push(createRow(
      `${item.key}-question-row-${index}`,
      [
        createSpan("│ ", "borderActive"),
        createSpan(row || " ", "text"),
        createSpan(" ".repeat(Math.max(0, contentWidth - getTextWidth(row || " ")))),
        createSpan(" │", "borderActive"),
      ],
      width,
    ));
  });

  rows.push(createBlankRow(`${item.key}-question-end-gap`, width));
  rows.push(createRow(`${item.key}-question-bottom`, [createSpan(`└${"─".repeat(Math.max(1, width - 2))}┘`, "borderActive")], width));
  return rows;
}

function buildStandaloneEventRows(item: Extract<RenderTimelineItem, { type: "event" }>, width: number): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const event = item.event;

  if (event.type === "shell") {
    const command = sanitizeTerminalOutput(event.command);
    const summary = sanitizeTerminalOutput(event.summary ?? "");
    const marker = event.status === "failed" ? "✕ " : "✧ ";
    const markerTone = event.status === "failed" ? "error" : "accent";
    const verb = event.status === "running"
      ? "Executing shell"
      : event.status === "completed"
        ? "Executed shell"
        : "Shell failed";
    const statusBits = [
      event.exitCode !== null && event.status !== "running" ? `exit ${event.exitCode}` : null,
      event.durationMs !== null ? `${(event.durationMs / 1000).toFixed(2)}s` : null,
    ].filter(Boolean).join(" • ");
    const heading = `${verb}: ${command}${statusBits ? `  •  ${statusBits}` : ""}`;

    rows.push(...buildPrefixedContentRows(
      `${item.key}-shell`,
      [createSpan(marker, markerTone)],
      [createSpan("  ", markerTone)],
      [createSpan(heading, "text")],
      width,
    ));

    if (summary && event.status !== "running") {
      const summaryRows = wrapPlainText(summary, Math.max(1, width - 2));
      rows.push(...buildIndentedRows(
        `${item.key}-summary`,
        summaryRows.map((row) => [createSpan(row || " ", event.status === "failed" ? "error" : "muted")]),
        width,
        2,
      ));
    }

    if (event.status === "failed") {
      const failureExcerpt = getShellFailureExcerpt(event);
      rows.push(...buildIndentedRows(
        `${item.key}-stderr`,
        failureExcerpt.map((line) => [createSpan(line, "error")]),
        width,
        2,
      ));
    }

    return rows;
  }

  if (event.type === "error") {
    rows.push(...buildPrefixedContentRows(
      `${item.key}-error`,
      [createSpan("✕ ", "error")],
      [createSpan("  ", "error")],
      [createSpan(sanitizeTerminalOutput(event.title), "error")],
      width,
    ));

    const content = sanitizeTerminalOutput(event.content).split("\n").find((line) => line.trim()) ?? "";
    if (content) {
      rows.push(...buildIndentedRows(
        `${item.key}-error-content`,
        wrapPlainText(content, Math.max(1, width - 2)).map((row) => [createSpan(row || " ", "muted")]),
        width,
        2,
      ));
    }
    return rows;
  }

  rows.push(...buildPrefixedContentRows(
    `${item.key}-system`,
    [createSpan("• ", "info")],
    [createSpan("  ", "info")],
    [createSpan(sanitizeTerminalOutput(event.title), "text")],
    width,
  ));

  const firstLine = sanitizeTerminalOutput(event.content).split("\n").find((line) => line.trim()) ?? "";
  if (firstLine) {
    rows.push(...buildIndentedRows(
      `${item.key}-system-content`,
      wrapPlainText(firstLine, Math.max(1, width - 2)).map((row) => [createSpan(row || " ", "dim")]),
      width,
      2,
    ));
  }

  return rows;
}

function applyTurnOpacity(rows: TimelineRow[], opacity: "active" | "recent" | "dim"): TimelineRow[] {
  if (opacity === "active") {
    return rows;
  }

  if (opacity === "recent") {
    return rows.map((row) => ({
      ...row,
      spans: row.spans.map((span) => {
        if (span.tone === "borderActive") {
          return { ...span, tone: "borderSubtle" };
        }
        return { ...span };
      }),
    }));
  }

  return rows.map((row) => ({
    ...row,
    spans: row.spans.map((span) => {
      if (
        span.tone === "text"
        || span.tone === "muted"
        || span.tone === "accent"
        || span.tone === "info"
        || span.tone === "success"
        || span.tone === "warning"
      ) {
        return { ...span, tone: "dim" };
      }
      if (span.tone === "borderActive") {
        return { ...span, tone: "borderSubtle" };
      }
      return { ...span };
    }),
  }));
}

function buildTurnRows(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number): TimelineRow[] {
  const rows: TimelineRow[] = [];

  rows.push(...buildUserInputRows(item, width));

  if (item.item.run) {
    rows.push(buildTaskStatusRow(item, width));

    if (item.renderState.runPhase === "thinking") {
      rows.push(...buildThinkingRows(item.item.run, width));
    } else {
      // Reordered: First File Scans and Activity (Process)
      if (item.item.run.status !== "running" && item.item.run.touchedFileCount > 0) {
        rows.push(...buildFileScanRows(item, width));
      }

      if (item.item.run.status !== "running" && item.item.run.toolActivities.length > 0) {
        rows.push(...buildActivityRows(item, width));
      }

      // Then the Agent response (Result)
      rows.push(...buildAgentRows(item, width));
    }
  }

  rows.push(...buildActionRequiredRows(item, width));
  return applyTurnOpacity(rows, item.renderState.opacity);
}

function wrapItemRows(rows: TimelineRow[], totalWidth: number, padded: boolean, keyPrefix: string): TimelineRow[] {
  const leftPad = padded ? 1 : 0;
  const innerWidth = Math.max(1, totalWidth - (leftPad * 2));
  const prefixedRows = rows.map((row, index) => createRow(
    `${keyPrefix}-wrapped-${index}`,
    [
      ...(leftPad > 0 ? [createSpan(" ".repeat(leftPad))] : []),
      ...padSpansToWidth(row.spans, innerWidth),
      ...(leftPad > 0 ? [createSpan(" ".repeat(leftPad))] : []),
    ],
    totalWidth,
  ));

  prefixedRows.push(createBlankRow(`${keyPrefix}-margin`, totalWidth));
  return prefixedRows;
}

export function buildTimelineSnapshot(
  items: RenderTimelineItem[],
  options: {
    totalWidth: number;
  },
): TimelineSnapshot {
  const builtItems = items.map((item) => {
    const innerWidth = Math.max(10, options.totalWidth - (item.padded ? 2 : 0));
    const builtRows = item.type === "event"
      ? buildStandaloneEventRows(item, innerWidth)
      : buildTurnRows(item, innerWidth);
    const rows = wrapItemRows(builtRows, options.totalWidth, item.padded, item.key);
    return {
      key: item.key,
      rows,
      rowCount: rows.length,
    };
  });

  const rows = builtItems.flatMap((item) => item.rows);

  return {
    items: builtItems,
    rows,
    totalRows: rows.length,
    itemCount: builtItems.length,
  };
}
