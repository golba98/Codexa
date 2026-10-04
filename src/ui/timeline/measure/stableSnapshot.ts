import * as renderDebug from "../../../core/perf/renderDebug.js";
import type { RunEvent } from "../../../session/types.js";
import { getResponseSegmentText } from "../../../session/types.js";
import { LOGO_LARGE_MIN_COLS } from "../../render/logoVariants.js";
import { getCachedFrozenRows, getStaticRows, rowCacheKey, textCacheToken } from "./caches.js";
import { buildUserInputRows } from "./cards.js";
import { buildActionRequiredRows, buildIntroRows, buildStandaloneEventRows } from "./eventRows.js";
import { createBlankRow, rowsToSnapshot, wrapItemRows, wrapRows } from "./rows.js";
import {
  applyTurnOpacity,
  buildActionSummaryRows,
  buildStreamEventRows,
  buildTurnRows,
  collectStreamEvents,
  compactActionBursts,
} from "./streamRows.js";
import type {
  BuiltTimelineItem,
  RenderTimelineItem,
  StableTimelineSnapshot,
  StreamEvent,
  TimelineBuildOptions,
  TimelineRow,
  TimelineSnapshot,
  TurnRenderItem,
} from "./types.js";

function buildStableEventRows(
  item: Extract<RenderTimelineItem, { type: "event" }>,
  innerWidth: number,
): TimelineRow[] {
  const cacheKey = rowCacheKey([
    "stable-event",
    item.key,
    item.event.type,
    item.event.id,
    innerWidth,
    textCacheToken("title" in item.event ? item.event.title : item.event.command),
    textCacheToken("content" in item.event ? item.event.content : (item.event.summary ?? "")),
    "status" in item.event ? item.event.status : "",
    "durationMs" in item.event ? item.event.durationMs : "",
  ]);
  return getCachedFrozenRows(cacheKey, () => buildStandaloneEventRows(item, innerWidth));
}

function buildStableIntroRows(
  item: Extract<RenderTimelineItem, { type: "intro" }>,
  innerWidth: number,
): TimelineRow[] {
  const cacheKey = rowCacheKey([
    "stable-intro",
    item.key,
    innerWidth,
    item.intro.version,
    item.intro.layoutMode,
    item.intro.startupHeaderMode ?? "",
    item.intro.authLabel,
    textCacheToken(item.intro.workspaceLabel),
    item.intro.providerLabel ?? "",
  ]);
  return getCachedFrozenRows(cacheKey, () => buildIntroRows(item, innerWidth));
}

function buildPlanCacheSignature(run: RunEvent | null | undefined): string {
  if (!run) return "";
  const plan = run.plan;
  return rowCacheKey([
    "plan",
    plan?.id ?? "",
    plan?.status ?? "",
    plan?.streamSeq ?? "",
    (plan?.chunks ?? []).map((chunk) => textCacheToken(chunk)),
    textCacheToken(run.approvedPlan),
    (run.streamItems ?? []).map((item) => `${item.streamSeq}:${item.kind}:${item.refId}`),
  ]);
}

function buildStableFrozenTurnRows(
  item: TurnRenderItem,
  innerWidth: number,
  options: { verbose?: boolean; workspaceRoot?: string | null },
): TimelineRow[] {
  const verbose = options.verbose ?? false;
  const run = item.item.run;
  const user = item.item.user;
  const cacheKey = rowCacheKey([
    "stable-turn",
    item.key,
    innerWidth,
    verbose,
    item.renderState.opacity,
    item.renderState.runPhase,
    user?.id,
    textCacheToken(user?.prompt),
    run?.id,
    run?.status,
    buildPlanCacheSignature(run),
    run?.durationMs,
    textCacheToken(run?.summary),
    textCacheToken(item.item.assistant?.content),
    textCacheToken(item.item.assistant?.contentChunks.join("")),
    run?.toolActivities
      .map(
        (tool) =>
          `${tool.id}:${tool.status}:${tool.startedAt}:${tool.completedAt ?? ""}:${textCacheToken(tool.command)}:${textCacheToken(tool.summary)}`,
      )
      .join("|"),
    run?.responseSegments
      ?.map(
        (segment) =>
          `${segment.id}:${segment.status}:${textCacheToken(getResponseSegmentText(segment))}`,
      )
      .join("|"),
    run?.progressEntries
      .map(
        (entry) =>
          `${entry.id}:${entry.blocks.map((block) => `${block.id}:${block.status}:${block.updatedAt}:${textCacheToken(block.text)}`).join(",")}`,
      )
      .join("|"),
    options.workspaceRoot ?? "",
  ]);
  return getCachedFrozenRows(cacheKey, () => buildTurnRows(item, innerWidth, options));
}

function isLiveStreamEvent(event: StreamEvent, run: RunEvent): boolean {
  if (run.status !== "running") return false;
  if (event.kind === "response") return event.segment.status === "active";
  if (event.kind === "action") return event.tool.status === "running";
  if (event.kind === "actionSummary") return false;
  return false;
}

function buildStableActiveTurnGroups(
  item: TurnRenderItem,
  innerWidth: number,
  options: { verbose?: boolean; workspaceRoot?: string | null },
): { frozenRows: TimelineRow[]; liveRows: TimelineRow[] } {
  const verbose = options.verbose ?? false;
  const run = item.item.run;
  if (
    !run ||
    (item.renderState.runPhase !== "streaming" && item.renderState.runPhase !== "thinking")
  ) {
    return {
      frozenRows: buildStableFrozenTurnRows(item, innerWidth, options),
      liveRows: [],
    };
  }

  const actionBorderTone = item.renderState.opacity === "dim" ? "borderSubtle" : "borderActive";
  const finalized = run.status !== "running";
  const events = compactActionBursts(collectStreamEvents(item), verbose, finalized);
  const orderedRows = [
    ...getCachedFrozenRows(
      rowCacheKey([
        "stable-active-user",
        item.key,
        innerWidth,
        item.renderState.opacity,
        textCacheToken(item.item.user?.prompt),
      ]),
      () => buildUserInputRows(item, innerWidth),
    ),
  ];
  orderedRows.push(createBlankRow(`${item.key}-active-prompt-gap`, innerWidth));

  events.forEach((event, index) => {
    const liveEvent = isLiveStreamEvent(event, run);
    const targetRows: TimelineRow[] = [];
    const isLastEvent = index === events.length - 1;

    if (index > 0) {
      // Stable creation-order key (streamSeq), not array index — matches the
      // native path and avoids index-based remount when events change.
      targetRows.push(createBlankRow(`${item.key}-stream-gap-${event.streamSeq}`, innerWidth));
    }

    if (event.kind === "thinking") {
      const build = () =>
        buildStreamEventRows({
          item,
          event,
          innerWidth,
          verbose,
          isLive: liveEvent,
          isLastEvent,
          workspaceRoot: options.workspaceRoot,
        });
      targetRows.push(
        ...(liveEvent
          ? build()
          : getCachedFrozenRows(
              rowCacheKey([
                "stable-thinking",
                item.key,
                innerWidth,
                verbose,
                event.block.id,
                event.block.status,
                event.block.updatedAt,
                textCacheToken(event.block.text),
              ]),
              build,
            )),
      );
    } else if (event.kind === "action") {
      const build = () =>
        buildStreamEventRows({
          item,
          event,
          innerWidth,
          verbose,
          isLive: liveEvent,
          isLastEvent,
          workspaceRoot: options.workspaceRoot,
        });
      targetRows.push(
        ...(liveEvent
          ? build()
          : getCachedFrozenRows(
              rowCacheKey([
                "stable-action",
                item.key,
                innerWidth,
                verbose,
                event.tool.id,
                event.tool.status,
                event.tool.startedAt,
                event.tool.completedAt ?? "",
                textCacheToken(event.tool.command),
              ]),
              build,
            )),
      );
    } else if (event.kind === "actionSummary") {
      targetRows.push(
        ...buildActionSummaryRows({
          keyPrefix: `${item.key}-action-summary-${event.streamSeq}`,
          width: innerWidth,
          event,
          borderTone: actionBorderTone,
        }),
      );
    } else if (event.kind === "response") {
      const build = () =>
        buildStreamEventRows({
          item,
          event,
          innerWidth,
          verbose,
          isLive: liveEvent,
          isLastEvent,
          workspaceRoot: options.workspaceRoot,
        });
      targetRows.push(
        ...(liveEvent
          ? build()
          : getCachedFrozenRows(
              rowCacheKey([
                "stable-response",
                item.key,
                innerWidth,
                verbose,
                run.status,
                event.segment.id,
                event.segment.status,
                textCacheToken(getResponseSegmentText(event.segment)),
              ]),
              build,
            )),
      );
    } else if (event.kind === "plan") {
      const build = () =>
        buildStreamEventRows({
          item,
          event,
          innerWidth,
          verbose,
          isLive: liveEvent,
          isLastEvent,
          workspaceRoot: options.workspaceRoot,
        });
      targetRows.push(
        ...getCachedFrozenRows(
          rowCacheKey([
            "stable-plan",
            item.key,
            innerWidth,
            textCacheToken(event.planText),
            event.approved ? "approved" : "draft",
            options.workspaceRoot ?? "",
          ]),
          build,
        ),
      );
    }

    orderedRows.push(...targetRows);
  });

  const questionRows = buildActionRequiredRows(item, innerWidth);
  if (questionRows.length > 0) {
    orderedRows.push(...questionRows);
  }

  orderedRows.push(createBlankRow(`${item.key}-active-turn-end-gap`, innerWidth));

  return {
    frozenRows: applyTurnOpacity(orderedRows, item.renderState.opacity),
    liveRows: [],
  };
}

// ─── Public snapshot builders ─────────────────────────────────────────────────

export function buildStableTimelineSnapshot(
  items: RenderTimelineItem[],
  options: TimelineBuildOptions,
): StableTimelineSnapshot {
  const verbose = options.verboseMode ?? false;
  renderDebug.traceFlickerEvent("snapshotBuild", {
    reason: options.debugLabel ?? "stable",
    items: items.length,
    totalWidth: options.totalWidth,
    verbose,
    stable: true,
  });

  const builtItems: BuiltTimelineItem[] = [];
  const frozenRows: TimelineRow[] = [];
  const liveRows: TimelineRow[] = [];

  for (const item of items) {
    const innerWidth = Math.max(10, options.totalWidth - (item.padded ? 2 : 0));
    let itemFrozenRows: TimelineRow[];
    let itemLiveRows: TimelineRow[];

    if (item.type === "intro") {
      itemFrozenRows = buildStableIntroRows(item, innerWidth);
      itemLiveRows = [];
    } else if (item.type === "event") {
      itemFrozenRows = buildStableEventRows(item, innerWidth);
      itemLiveRows = [];
    } else {
      const groups = buildStableActiveTurnGroups(item, innerWidth, {
        verbose,
        workspaceRoot: options.workspaceRoot,
      });
      itemFrozenRows = groups.frozenRows;
      itemLiveRows = groups.liveRows;
    }

    const hasLiveRows = itemLiveRows.length > 0;
    const wrappedFrozenRows = wrapRows(
      itemFrozenRows,
      options.totalWidth,
      item.padded,
      item.key,
      !hasLiveRows,
    );
    const wrappedLiveRows = hasLiveRows
      ? wrapRows(itemLiveRows, options.totalWidth, item.padded, item.key, true)
      : [];
    const rows = [...wrappedFrozenRows, ...wrappedLiveRows];
    frozenRows.push(...wrappedFrozenRows);
    liveRows.push(...wrappedLiveRows);
    builtItems.push({
      key: item.key,
      rows,
      rowCount: rows.length,
    });
  }

  return {
    snapshot: rowsToSnapshot(builtItems),
    frozenRows,
    liveRows,
  };
}

export function buildTimelineSnapshot(
  items: RenderTimelineItem[],
  options: TimelineBuildOptions,
): TimelineSnapshot {
  const verbose = options.verboseMode ?? false;
  renderDebug.traceEvent("timeline", "buildSnapshot", {
    items: items.length,
    totalWidth: options.totalWidth,
    verbose,
  });
  renderDebug.traceFlickerEvent("snapshotBuild", {
    reason: options.debugLabel ?? "unknown",
    items: items.length,
    totalWidth: options.totalWidth,
    verbose,
  });

  const builtItems = items.map((item) => {
    const innerWidth = Math.max(10, options.totalWidth - (item.padded ? 2 : 0));

    let builtRows: TimelineRow[];

    if (item.type === "intro") {
      const cacheKey = `i:${item.key}:${innerWidth}:${item.intro.version}:${item.intro.layoutMode}:${item.intro.startupHeaderMode ?? ""}:${item.intro.authLabel}:${item.intro.workspaceLabel}:${item.intro.providerLabel ?? ""}:v${LOGO_LARGE_MIN_COLS}`;
      builtRows = getStaticRows(cacheKey, () => buildIntroRows(item, innerWidth), {
        itemKey: item.key,
        itemType: "intro",
        innerWidth,
      });
    } else if (item.type === "event") {
      // Standalone events are immutable for a given event payload, not just id.
      const cacheKey = rowCacheKey([
        "event",
        item.key,
        item.event.type,
        item.event.id,
        innerWidth,
        textCacheToken("title" in item.event ? item.event.title : item.event.command),
        textCacheToken("content" in item.event ? item.event.content : (item.event.summary ?? "")),
        "status" in item.event ? item.event.status : "",
        "durationMs" in item.event ? item.event.durationMs : "",
      ]);
      builtRows = getStaticRows(cacheKey, () => buildStandaloneEventRows(item, innerWidth), {
        itemKey: item.key,
        itemType: "event",
        innerWidth,
      });
    } else {
      const { runPhase, opacity } = item.renderState;
      // Only cache completed turns (runPhase "none"/"final") at a stable
      // opacity. Streaming and thinking items change every tick.
      const cacheable = runPhase !== "streaming" && runPhase !== "thinking";
      if (cacheable) {
        const cacheKey = rowCacheKey([
          "turn",
          item.key,
          innerWidth,
          verbose,
          runPhase,
          opacity,
          options.workspaceRoot ?? "",
          buildPlanCacheSignature(item.item.run),
        ]);
        builtRows = getStaticRows(
          cacheKey,
          () => buildTurnRows(item, innerWidth, { verbose, workspaceRoot: options.workspaceRoot }),
          { itemKey: item.key, itemType: "turn", innerWidth, runPhase, opacity },
        );
      } else {
        renderDebug.traceEvent("timeline", "rowGeneration", {
          itemKey: item.key,
          itemType: "turn",
          runPhase,
          opacity,
          cache: "active",
          innerWidth,
        });
        renderDebug.traceEvent("timeline", "activeBuild", { itemKey: item.key, runPhase, opacity });
        builtRows = buildTurnRows(item, innerWidth, {
          verbose,
          workspaceRoot: options.workspaceRoot,
        });
      }
    }

    const rows = wrapItemRows(builtRows, options.totalWidth, item.padded, item.key);
    return {
      key: item.key,
      rows,
      rowCount: rows.length,
    };
  });

  return rowsToSnapshot(builtItems);
}
