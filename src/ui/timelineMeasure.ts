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
  const fillSpacerWidth = rightBadge ? 2 : 1;
  const fillCount = Math.max(1, safeWidth - prefixWidth - titleWidth - badgeWidth - suffixWidth - fillSpacerWidth);

  const spans: TimelineRowSpan[] = [
    createSpan("╭── ", "borderSubtle"),
    createSpan(title, "muted", { bold: true }),
    createSpan(rightBadge ? ` ${"─".repeat(fillCount)} ` : ` ${"─".repeat(fillCount)}`, "borderSubtle"),
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
  const dim = item.renderState.opacity === "dim";
  const contentWidth = Math.max(1, width - 4);
  const lines = wrapPlainText(sanitizeTerminalOutput(item.item.user?.prompt ?? ""), Math.max(1, contentWidth - 2))
    .map((line, index) => [
      createSpan(index === 0 ? "❯ " : "  ", dim ? "dim" : "text"),
      createSpan(line || " ", dim ? "dim" : "text"),
    ]);

  return buildDashCardRows({
    keyPrefix: `${item.key}-user`,
    width,
    title: "PROMPT",
    borderTone: "borderSubtle",
    contentRows: lines,
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildTaskStatusRow(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number): TimelineRow {
  const run = item.item.run!;
  // PERF: Do NOT call Date.now() here — this function runs inside buildTimelineSnapshot
  // which is computed inside a useMemo in Timeline.tsx.  Using Date.now() prevents the
  // snapshot from ever fully stabilising, causing unnecessary downstream invalidation.
  // The spinner animation is handled by TurnGroup/StatusLine via its own setInterval.
  // We use a static frame so the data-layer row is deterministic and memo-stable.
  const spinnerPlaceholder = "⠿";
  const isActive = run.status === "running";

  if (!isActive) {
    // Completed state — clean summary line
    const icon = run.status === "failed" ? "✕" : "✔";
    const iconTone: TimelineTone = run.status === "failed" ? "error" : "success";
    const label = run.status === "failed" ? "Failed" : run.status === "canceled" ? "Canceled" : "Complete";
    const durationText = run.durationMs != null ? ` • ${formatDuration(run.durationMs)}` : "";
    return createRow(
      `${item.key}-status`,
      [
        createSpan(" "),
        createSpan(`${icon} `, iconTone),
        createSpan(`${label}${durationText}`, "dim"),
      ],
      width,
    );
  }

  // Active state — spinner + concise status
  const statusText = item.renderState.runPhase === "streaming"
    ? "Streaming response..."
    : "CODEXA is working...";

  return createRow(
    `${item.key}-status`,
    [
      createSpan(" "),
      createSpan(`${spinnerPlaceholder} `, "info"),
      createSpan(statusText, "muted"),
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

/**
 * Verbose mode renders the full reasoning card.
 * Default mode renders a compact live-activity card only when there are
 * meaningful progress, tool, or file signals to show.
 */
function buildThinkingRows(run: RunEvent, width: number, verbose: boolean): TimelineRow[] {
  const latestTool = run.toolActivities[run.toolActivities.length - 1] ?? null;
  const thinkingLines = run.thinkingLines ?? [];
  const recentActivity = run.activity.slice(-2);
  const contentWidth = Math.max(1, width - 4);
  const contentRows: TimelineRowSpan[][] = [];
  if (!verbose) {
    const visibleLines = thinkingLines.slice(-2);
    visibleLines.forEach((line) => {
      const clamped = clampVisualText(line, contentWidth);
      if (!clamped.trim()) return;
      contentRows.push([createSpan(clamped, "muted")]);
    });

    if (latestTool) {
      const toolPrefix = latestTool.status === "failed" ? "✕ " : latestTool.status === "completed" ? "✓ " : "• ";
      const toolTone = latestTool.status === "failed" ? "error" : latestTool.status === "completed" ? "success" : "info";
      const toolText = latestTool.status === "running"
        ? latestTool.command
        : latestTool.summary ?? latestTool.command;
      const clampedTool = clampVisualText(toolText, Math.max(1, contentWidth - 2));
      if (clampedTool.trim()) {
        contentRows.push([
          createSpan(toolPrefix, toolTone),
          createSpan(clampedTool, toolTone),
        ]);
      }
    }

    recentActivity.forEach((file) => {
      const prefix = file.operation === "created" ? "+ " : file.operation === "deleted" ? "- " : "~ ";
      const tone = file.operation === "created" ? "success" : file.operation === "deleted" ? "error" : "info";
      const text = clampVisualText(file.path, Math.max(1, contentWidth - 2));
      if (!text.trim()) return;
      contentRows.push([
        createSpan(prefix, tone),
        createSpan(text, tone),
      ]);
    });

    if (contentRows.length === 0) {
      return [];
    }

    return buildDashCardRows({
      keyPrefix: `${run.turnId}-thinking`,
      width,
      title: "Processing",
      rightBadge: "active",
      borderTone: "borderActive",
      contentRows: contentRows.slice(-4),
    });
  }

  const toolLine = latestTool
    ? latestTool.status === "running"
      ? `running: ${latestTool.command}`
      : latestTool.summary ?? latestTool.command
    : null;
  const hiddenCount = Math.max(0, thinkingLines.length - MAX_VISIBLE_THINKING_LINES);
  const visibleLines = thinkingLines.slice(-MAX_VISIBLE_THINKING_LINES);
  const hasContent = thinkingLines.length > 0 || toolLine;

  if (!hasContent) {
    contentRows.push([createSpan("Waiting for response...", "dim")]);
  } else if (hiddenCount > 0) {
    contentRows.push([createSpan(`... ${hiddenCount} more above`, "dim")]);
  }

  if (hasContent) {
    visibleLines.forEach((line) => {
      const clamped = clampVisualText(line, contentWidth);
      contentRows.push([createSpan(clamped || " ", "muted")]);
    });
  }

  while (contentRows.length < MAX_VISIBLE_THINKING_LINES) {
    contentRows.push([createSpan(" ", "dim")]);
  }

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

/**
 * Compact impact summary for completed runs (default mode).
 * Shows file changes and a summary footer.
 */
function buildImpactSummaryRows(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number): TimelineRow[] {
  const run = item.item.run!;
  const summary = run.activitySummary;
  const hasFiles = run.touchedFileCount > 0;
  const hasTools = run.toolActivities.length > 0;
  if (!hasFiles && !hasTools) return [];

  const rows: TimelineRow[] = [];
  const recentFiles = summary?.recent ?? run.activity.slice(-6);
  const hasDeletes = (summary?.deleted ?? 0) > 0;

  const opLabel = (op: string) => {
    switch (op) {
      case "created": return "CREATED ";
      case "modified": return "MODIFIED";
      case "deleted": return "DELETED ";
      default: return op.toUpperCase().padEnd(8);
    }
  };
  const opTone = (op: string): TimelineTone => {
    switch (op) {
      case "created": return "success";
      case "deleted": return "error";
      default: return "info";
    }
  };

  // Warning banner for destructive changes
  if (hasDeletes) {
    rows.push(createRow(
      `${item.key}-impact-warn`,
      [createSpan(" "), createSpan("⚠ Destructive changes detected:", "warning")],
      width,
    ));
  }

  // "Changes:" label
  if (hasFiles) {
    rows.push(createRow(
      `${item.key}-impact-label`,
      [createSpan("   "), createSpan("Changes:", "dim")],
      width,
    ));

    // File list
    recentFiles.forEach((file, index) => {
      const diffInfo = file.addedLines != null || file.removedLines != null
        ? ` (+${file.addedLines ?? 0} -${file.removedLines ?? 0})`
        : "";
      rows.push(createRow(
        `${item.key}-impact-file-${index}`,
        [
          createSpan("     "),
          createSpan(opLabel(file.operation), opTone(file.operation)),
          createSpan(` ${file.path}`, "text"),
          createSpan(diffInfo, "dim"),
        ],
        width,
      ));
    });
  }

  // Summary footer
  const parts: string[] = [];
  if (run.touchedFileCount > 0) parts.push(`${run.touchedFileCount} file${run.touchedFileCount === 1 ? "" : "s"}`);
  if (hasTools) parts.push(`${run.toolActivities.length} action${run.toolActivities.length === 1 ? "" : "s"}`);
  if (run.durationMs != null) parts.push(formatDuration(run.durationMs));

  rows.push(createRow(
    `${item.key}-impact-summary`,
    [
      createSpan("   "),
      createSpan("✔ ", "success"),
      createSpan(parts.join(" • "), "dim"),
    ],
    width,
  ));

  return rows;
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

/**
 * Map a unified-diff line to a timeline tone for colour-coded rendering.
 *
 * Standard unified diff format:
 *   diff --git a/... b/...   → file header   (info)
 *   index abc..def 100644    → file metadata  (info)
 *   --- a/...               → left-file marker (info)
 *   +++ b/...               → right-file marker (info)
 *   @@ -1,4 +1,4 @@         → hunk header    (accent/cyan)
 *   +added line             → addition        (success/green)
 *   -removed line           → deletion        (error/red)
 *   ("unchanged" context)   → muted/default
 */
function getDiffTone(line: string): TimelineTone {
  // Additions: any line starting with + that is not the +++ file marker
  if (line.startsWith("+") && !line.startsWith("+++")) return "success";
  // Deletions: any line starting with - that is not the --- file marker
  if (line.startsWith("-") && !line.startsWith("---")) return "error";
  // Hunk headers: @@ -1,4 +1,4 @@ (optional context)
  if (line.startsWith("@@")) return "accent";
  // File-level header lines (diff/index/---/+++) shown in info tone
  if (
    line.startsWith("diff --")
    || line.startsWith("index ")
    || line.startsWith("+++ ")
    || line.startsWith("--- ")
  ) {
    return "info";
  }
  // Context / unchanged lines
  return "muted";
}

/**
 * Detect whether a paragraph-style block looks like a unified diff.
 * Requires at least one strong diff signal (hunk header, file header) to
 * avoid false-positives from prose that starts with '+' or '-'.
 */
function isDiffParagraph(lines: string[]): boolean {
  // Need at least 2 lines to be a plausible diff
  if (lines.length < 2) return false;
  // A strong signal: hunk header or diff/index/file-header line
  const hasStrongSignal = lines.some((line) =>
    line.startsWith("@@")
    || line.startsWith("diff --")
    || line.startsWith("index ")
    || (line.startsWith("+++ ") && lines.some((l) => l.startsWith("--- ")))
    || (line.startsWith("--- ") && lines.some((l) => l.startsWith("+++ ")))
  );
  if (!hasStrongSignal) return false;
  // Also verify at least one addition or deletion line is present
  return lines.some((line) =>
    (line.startsWith("+") && !line.startsWith("+++ "))
    || (line.startsWith("-") && !line.startsWith("--- "))
  );
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

  // Detect diff blocks using a two-tier test:
  //   Tier 1 — "strong signal": explicit lang=diff, @@ hunk header, diff --git/--unified,
  //            index <sha>, or a paired +++ / --- file-header pair.
  //   Tier 2 — addition / deletion lines (+/-) are only treated as diff colouring when
  //            Tier 1 fired.  This prevents false-positives from code that contains
  //            arithmetic (+1, -1), CLI flags (-v, --verbose), POSIX permissions (+x),
  //            or any other prose that starts with + or -.
  const isExplicitDiff = segment.lang.toLowerCase() === "diff";
  const hasStrongDiffSignal = isExplicitDiff
    || codeLines.some((line) =>
      line.startsWith("@@")
      || line.startsWith("diff --")
      || line.startsWith("index ")
      || (line.startsWith("+++ ") && codeLines.some((l) => l.startsWith("--- ")))
      || (line.startsWith("--- ") && codeLines.some((l) => l.startsWith("+++ ")))
    );
  const isDiffBlock = hasStrongDiffSignal
    && codeLines.some((line) =>
      (line.startsWith("+") && !line.startsWith("+++ "))
      || (line.startsWith("-") && !line.startsWith("--- "))
    );
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

    // Paragraph segment — check if it looks like a unified diff so we can
    // apply colour-coded tones instead of the flat 'text' tone.
    const rawParaLines = segment.lines.map((parts) =>
      normalizeMarkdownParts(parts).map((p) => p.text).join(""),
    );
    const segmentIsDiffPara = isDiffParagraph(rawParaLines);

    segment.lines.forEach((parts, lineIndex) => {
      const normalizedParts = normalizeMarkdownParts(parts);
      const isBlank = normalizedParts.length === 1
        && normalizedParts[0]?.kind === "text"
        && !normalizedParts[0].text.trim();
      if (isBlank) {
        return;
      }

      // If all parts are plain text and the paragraph looks like a unified diff,
      // apply diff tones instead of the default 'text' tone for better readability.
      const rawLineText = normalizedParts.map((p) => p.text).join("");
      // isDiffParagraph is checked per-segment (below), so we use a captured flag.
      if (segmentIsDiffPara) {
        const tone = getDiffTone(rawLineText);
        // Wrap and apply the diff tone to the entire line
        wrapStyledSpans([createSpan(rawLineText, tone)], width)
          .forEach((row) => rows.push(padSpansToWidth(row, width)));
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
  const contentWidth = Math.max(1, width - 4);
  const rawContent = assistant?.content ?? "";
  const sanitized = streaming ? sanitizeStreamChunk(rawContent) : sanitizeOutput(rawContent);
  const normalized = normalizeOutput(sanitized);
  const segments = formatForBox(classifyOutput(normalized), contentWidth);
  const contentRows: TimelineRowSpan[][] = [];

  if (!streaming && run.status === "failed") {
    const failureMessage = sanitizeTerminalOutput(run.errorMessage ?? run.summary);
    wrapPlainText(failureMessage, Math.max(1, contentWidth - 2)).forEach((row, index) => {
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
      wrapPlainText(sanitizeTerminalOutput(run.summary), contentWidth).forEach((wrapped) => {
        contentRows.push([createSpan(wrapped || " ", "warning")]);
      });
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

  // 1. Add top margin for separation from the task status line above.
  rows.push(createBlankRow(`${item.key}-agent-top-gap`, width));

  // 2. Render the agent response inside a DashCard — visually consistent with
  //    every other block in the timeline: USER INPUT, Processing, File Scan,
  //    and Activity all use the same ╭──...──╮ frame.  The title is the model
  //    name (e.g. "GPT 4O") or the generic "AGENT RESPONSE" fallback.
  rows.push(...buildDashCardRows({
    keyPrefix: `${item.key}-agent`,
    width,
    title: heading,
    rightBadge,
    borderTone,
    contentRows,
  }));

  // 3. Add bottom margin for separation from the next section / turn.
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

    // Show the full content — not just the first line.  Error messages can span
    // multiple lines (stack traces, multi-step explanations) and silently
    // truncating to line 1 hides important diagnostic information.
    const errorContentLines = sanitizeTerminalOutput(event.content)
      .split("\n")
      .filter((line) => line.trim());
    if (errorContentLines.length > 0) {
      const wrappedRows = errorContentLines.flatMap((line) =>
        wrapPlainText(line, Math.max(1, width - 2)).map((row) => [createSpan(row || " ", "muted")])
      );
      rows.push(...buildIndentedRows(
        `${item.key}-error-content`,
        wrappedRows,
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

  // Show the full content — not just the first line.  System events carry
  // rich multi-line payloads: /help output, auth status, model listings,
  // workspace summaries, etc.  Limiting to line 1 silently hides all of it.
  const systemContentLines = sanitizeTerminalOutput(event.content)
    .split("\n")
    .filter((line) => line.trim());
  if (systemContentLines.length > 0) {
    const wrappedRows = systemContentLines.flatMap((line) =>
      wrapPlainText(line, Math.max(1, width - 2)).map((row) => [createSpan(row || " ", "dim")])
    );
    rows.push(...buildIndentedRows(
      `${item.key}-system-content`,
      wrappedRows,
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
          return { ...span, tone: "borderSubtle" as TimelineTone };
        }
        return { ...span };
      }),
    }));
  }

  // Dim mode: tone down most colours to "dim" but preserve semantic diff
  // colours ("success" for additions, "error" for deletions) so that diff
  // blocks in older turns remain readable instead of collapsing to a uniform
  // monochrome.  "accent" (hunk headers) is mapped to "muted" for a softer
  // but still-distinct visual.
  return rows.map((row) => ({
    ...row,
    spans: row.spans.map((span) => {
      if (
        span.tone === "text"
        || span.tone === "muted"
        || span.tone === "info"
        || span.tone === "warning"
      ) {
        return { ...span, tone: "dim" as TimelineTone };
      }
      if (span.tone === "accent") {
        return { ...span, tone: "muted" as TimelineTone };
      }
      if (span.tone === "borderActive") {
        return { ...span, tone: "borderSubtle" as TimelineTone };
      }
      // "success" and "error" pass through — keeps diff additions (green)
      // and deletions (red) visible in dimmed turns.
      return { ...span };
    }),
  }));
}

function buildTurnRows(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number, verbose = false): TimelineRow[] {
  const rows: TimelineRow[] = [];

  rows.push(...buildUserInputRows(item, width));

  if (item.item.run) {
    rows.push(buildTaskStatusRow(item, width));

    const processingRows = item.item.run.status === "running"
      ? buildThinkingRows(item.item.run, width, verbose)
      : [];

    if (item.renderState.runPhase === "thinking") {
      rows.push(...processingRows);
    } else {
      rows.push(...processingRows);
      // Agent response first
      rows.push(...buildAgentRows(item, width));

      // After the response: either compact impact summary (default) or verbose cards
      if (item.item.run.status !== "running") {
        if (verbose) {
          if (item.item.run.touchedFileCount > 0) {
            rows.push(...buildFileScanRows(item, width));
          }
          if (item.item.run.toolActivities.length > 0) {
            rows.push(...buildActivityRows(item, width));
          }
        } else {
          rows.push(...buildImpactSummaryRows(item, width));
        }
      }
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
    verboseMode?: boolean;
  },
): TimelineSnapshot {
  const verbose = options.verboseMode ?? false;
  const builtItems = items.map((item) => {
    const innerWidth = Math.max(10, options.totalWidth - (item.padded ? 2 : 0));
    const builtRows = item.type === "event"
      ? buildStandaloneEventRows(item, innerWidth)
      : buildTurnRows(item, innerWidth, verbose);
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
