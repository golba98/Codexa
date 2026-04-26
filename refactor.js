import fs from 'fs';

const timelinePath = 'src/ui/timelineMeasure.ts';
let code = fs.readFileSync(timelinePath, 'utf8');

const buildUnifiedStreamRowsStr = `
type StreamEvent =
  | { kind: "thinking"; block: RunProgressBlock; text: string; timestamp: number; isActive: boolean; isLast: boolean }
  | { kind: "response"; timestamp: number }
  | { kind: "action"; tool: RunToolActivity; timestamp: number };

function buildUnifiedStreamRows(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number, verbose = false): TimelineRow[] {
  const run = item.item.run!;
  const assistant = item.item.assistant;
  const streaming = item.renderState.runPhase === "streaming";
  const dim = item.renderState.opacity !== "active";
  const contentWidth = Math.max(1, width - 4);
  const borderTone = dim ? "borderSubtle" : streaming ? "borderActive" : "borderSubtle";

  const events: StreamEvent[] = [];

  // Extract thinking blocks
  const progressEntries = run.progressEntries ?? [];
  const blocks = progressEntries.flatMap(entry => entry.blocks.map(block => ({
    block,
    source: entry.source
  })));
  
  // Mark last block and active blocks
  const visibleBlocks = blocks.filter(b => b.block.text.trim().length > 0);
  visibleBlocks.forEach((b, i) => {
    events.push({
      kind: "thinking",
      block: b.block,
      text: b.block.text,
      timestamp: b.block.createdAt,
      isActive: run.status === "running" && b.block.status === "active",
      isLast: i === visibleBlocks.length - 1
    });
  });

  // Extract tool activities
  run.toolActivities.forEach(tool => {
    events.push({
      kind: "action",
      tool,
      timestamp: tool.startedAt
    });
  });

  // Extract response
  // We place response at the end of the current events if it has content or is streaming
  const rawContent = splitSentenceWall(getAssistantContent(assistant));
  if (rawContent.length > 0 || streaming) {
    const responseTimestamp = (assistant?.createdAt || run.startedAt) + 1; // logical sort after initial processing
    events.push({
      kind: "response",
      timestamp: responseTimestamp
    });
  }

  // Sort events by timestamp
  // To ensure stable sorting when timestamps match, we might want to preserve relative order,
  // but JS sort is stable.
  events.sort((a, b) => a.timestamp - b.timestamp);

  const contentRows: TimelineRowSpan[][] = [];

  events.forEach((event, index) => {
    const isLastEvent = index === events.length - 1;
    const isLive = run.status === "running" && isLastEvent; // The cursor is on the last event

    if (index > 0) {
      contentRows.push([createSpan("")]);
    }

    if (event.kind === "thinking") {
      contentRows.push([
        createSpan("  thinking", "dim")
      ]);
      const bodyLines = formatProgressBlockBodyLines(event.text, Math.max(1, contentWidth - 4));
      const lineCap = verbose ? bodyLines.length : COMPACT_PROCESSING_BODY_LINE_CAP;
      const visibleBodyLines = bodyLines.slice(0, lineCap);
      const overflowCount = bodyLines.length - visibleBodyLines.length;

      visibleBodyLines.forEach((line) => {
        contentRows.push([
          createSpan("  ", "dim"),
          createSpan(line || " ", "dim")
        ]);
      });

      if (overflowCount > 0) {
        contentRows.push([
          createSpan("  ", "dim"),
          createSpan(\`… (\${overflowCount} more line\${overflowCount === 1 ? "" : "s"})\`, "dim")
        ]);
      }

      if (event.isActive && run.status === "running") {
        contentRows.push([
          createSpan("  ", "dim"),
          createSpan("▌", "accent")
        ]);
      }
    } else if (event.kind === "action") {
      contentRows.push([
        createSpan("  action", "dim")
      ]);
      const tool = event.tool;
      const icon = tool.status === "failed" ? "✕" : tool.status === "completed" ? "✓" : "•";
      const iconTone = tool.status === "failed" ? "error" : tool.status === "completed" ? "success" : "info";
      const duration = tool.completedAt && tool.startedAt
        ? \` • \${formatDuration(tool.completedAt - tool.startedAt)}\`
        : "";
      const headRows = wrapPlainText(tool.command, Math.max(1, contentWidth - 4));
      headRows.forEach((row, rowIndex) => {
        contentRows.push([
          createSpan(\`  \${rowIndex === 0 ? icon + " " : "  "}\`, iconTone),
          createSpan(row || " ", "text"),
          ...(rowIndex === 0 && duration ? [createSpan(duration, "dim")] : []),
        ]);
      });
      if (tool.summary && verbose) {
        wrapPlainText(tool.summary, Math.max(1, contentWidth - 4)).forEach((row) => {
          contentRows.push([
            createSpan("    "),
            createSpan(row || " ", "muted"),
          ]);
        });
      }
      if (tool.status === "running") {
        contentRows.push([
          createSpan("  ", "dim"),
          createSpan("▌", "accent")
        ]);
      }
    } else if (event.kind === "response") {
      contentRows.push([
        createSpan("  response", "dim")
      ]);

      let responseRows: TimelineRowSpan[][] = [];

      if (streaming && rawContent.length > 0) {
        const turnKey = item.key;
        const cache = _streamingRowCache;

        if (
          cache
          && cache.turnKey === turnKey
          && cache.width === contentWidth
          && rawContent.length >= cache.contentLength
        ) {
          const newBoundary = findSafeBoundary(rawContent, cache.safeBoundaryOffset);

          const tailContent = rawContent.slice(cache.safeBoundaryOffset);
          const tailNormalized = normalizeOutput(tailContent);
          const tailSegments = formatForBox(classifyOutput(tailNormalized), contentWidth);
          const tailRows = buildMarkdownRows(tailSegments, contentWidth);
          responseRows = [...cache.cachedRows, ...tailRows];

          if (newBoundary > cache.safeBoundaryOffset) {
            const safePart = rawContent.slice(cache.safeBoundaryOffset, newBoundary);
            const safeNormalized = normalizeOutput(safePart);
            const safeSegments = formatForBox(classifyOutput(safeNormalized), contentWidth);
            const safeRows = buildMarkdownRows(safeSegments, contentWidth);

            _streamingRowCache = {
              turnKey,
              width: contentWidth,
              safeBoundaryOffset: newBoundary,
              cachedRows: [...cache.cachedRows, ...safeRows],
              contentLength: rawContent.length,
            };
          } else {
            _streamingRowCache = {
              ...cache,
              contentLength: rawContent.length,
            };
          }
        } else {
          const normalized = normalizeOutput(rawContent);
          const segments = formatForBox(classifyOutput(normalized), contentWidth);
          responseRows = buildMarkdownRows(segments, contentWidth);

          const boundary = findSafeBoundary(rawContent, 0);
          if (boundary > 0 && boundary < rawContent.length) {
            const safeNormalized = normalizeOutput(rawContent.slice(0, boundary));
            const safeSegments = formatForBox(classifyOutput(safeNormalized), contentWidth);
            const safeRows = buildMarkdownRows(safeSegments, contentWidth);

            _streamingRowCache = {
              turnKey,
              width: contentWidth,
              safeBoundaryOffset: boundary,
              cachedRows: safeRows,
              contentLength: rawContent.length,
            };
          } else {
            _streamingRowCache = {
              turnKey,
              width: contentWidth,
              safeBoundaryOffset: 0,
              cachedRows: [],
              contentLength: rawContent.length,
            };
          }
        }
      } else {
        if (!streaming) _streamingRowCache = null;
        const sanitized = sanitizeOutput(rawContent);
        const normalized = normalizeOutput(sanitized);
        const segments = formatForBox(classifyOutput(normalized), contentWidth);
        responseRows = buildMarkdownRows(segments, contentWidth);
      }

      if (!streaming && run.status === "failed") {
        const failureMessage = sanitizeTerminalOutput(run.errorMessage ?? run.summary);
        const failureRows: TimelineRowSpan[][] = [];
        wrapPlainText(failureMessage, Math.max(1, contentWidth - 2)).forEach((row, index) => {
          failureRows.push([
            createSpan(index === 0 ? "✕ " : "  ", "error"),
            createSpan(row || " ", "error"),
          ]);
        });
        responseRows = [...failureRows, ...responseRows];
      }

      if (streaming && !verbose && responseRows.length > COMPACT_STREAMING_TAIL_CAP) {
        const hiddenRowCount = responseRows.length - COMPACT_STREAMING_TAIL_CAP;
        responseRows = [
          [createSpan(\`… (\${hiddenRowCount} line\${hiddenRowCount === 1 ? "" : "s"} above)\`, "dim")],
          ...responseRows.slice(-COMPACT_STREAMING_TAIL_CAP),
        ];
      }

      // Indent response rows by 2 spaces to align with 'response' label
      responseRows.forEach(row => {
        contentRows.push([
          createSpan("  "),
          ...row
        ]);
      });

      if (streaming) {
        contentRows.push([
          createSpan("  "),
          createSpan("▌", "accent"),
        ]);
      }
    }
  });

  if (!streaming && run.status !== "running") {
    if (run.status === "canceled") {
      wrapPlainText(sanitizeTerminalOutput(run.summary), contentWidth).forEach((wrapped) => {
        contentRows.push([createSpan(wrapped || " ", "warning")]);
      });
    } else if (run.status === "completed" && rawContent.trim().length === 0) {
      // contentRows.push([createSpan("(no output)", "dim")]); // Optional
    }

    if (run.truncatedOutput) {
      contentRows.push([createSpan(RUN_OUTPUT_TRUNCATION_NOTICE, "dim")]);
    }
  }

  const heading = run.runtime.model ? run.runtime.model.toUpperCase().replace(/-/g, " ") : "AGENT RESPONSE";
  const runStatus = streaming
    ? "streaming"
    : run.status === "completed"
      ? "complete"
      : run.status ?? "running";
  const rightBadge = run.durationMs != null && !streaming
    ? \`\${runStatus} • \${formatDuration(run.durationMs)}\`
    : runStatus;

  const rows: TimelineRow[] = [];

  rows.push(createBlankRow(\`\${item.key}-unified-top-gap\`, width));

  rows.push(...buildDashCardRows({
    keyPrefix: \`\${item.key}-unified\`,
    width,
    title: heading,
    rightBadge,
    borderTone,
    contentRows: contentRows.length > 0 ? contentRows : [[createSpan(" ")]],
  }));

  return rows;
}
`;

const buildTurnRowsStr = `function buildTurnRows(item: Extract<RenderTimelineItem, { type: "turn" }>, width: number, verbose = false): TimelineRow[] {
  const rows: TimelineRow[] = [];

  rows.push(...buildUserInputRows(item, width));

  if (item.item.run) {
    rows.push(...buildUnifiedStreamRows(item, width, verbose));

    if (item.item.run.status !== "running") {
      if (verbose) {
        if (item.item.run.touchedFileCount > 0) {
          rows.push(...buildFileScanRows(item, width));
        }
        if (item.item.run.toolActivities.length > 0) {
          // The actions are now in the unified stream, but we keep ActivityRows for verbose summary 
          // or we could skip it to prevent duplication.
          // Let's keep file scans, skip duplicate tool activity.
        }
      } else {
        rows.push(...buildImpactSummaryRows(item, width));
      }
    }
  }

  rows.push(...buildActionRequiredRows(item, width));
  return applyTurnOpacity(rows, item.renderState.opacity);
}`;

let newCode = code.replace(/function buildTurnRows\([\s\S]*?^}/m, buildUnifiedStreamRowsStr + '\n' + buildTurnRowsStr);

if (!newCode.includes('RunProgressBlock')) {
    newCode = newCode.replace(/import type { RunEvent, ShellEvent } from "\.\.\/session\/types\.js";/, 'import type { RunEvent, ShellEvent, RunProgressBlock, RunToolActivity } from "../session/types.js";');
} else {
    // If it already includes RunEvent, but not RunProgressBlock
    if (newCode.match(/import type {[^}]*RunEvent[^}]*} from "\.\.\/session\/types\.js";/) && !newCode.includes('RunToolActivity')) {
        newCode = newCode.replace(/RunEvent,\s*ShellEvent/, 'RunEvent, ShellEvent, RunProgressBlock, RunToolActivity');
    }
}

fs.writeFileSync(timelinePath, newCode, 'utf8');
console.log("Updated timelineMeasure.ts");
