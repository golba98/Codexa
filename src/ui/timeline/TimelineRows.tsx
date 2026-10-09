import { Box, Text } from "ink";
import { memo, useEffect } from "react";

import * as renderDebug from "../../core/perf/renderDebug.js";

import { useTheme } from "../theme.js";

import type { TimelineRow, TimelineTone } from "./timelineMeasure.js";

// ─── Row rendering ────────────────────────────────────────────────────────────

export function getToneColor(
  theme: ReturnType<typeof useTheme>,
  tone: TimelineTone | undefined,
): string | undefined {
  switch (tone) {
    case "text":
      return theme.text;
    case "dim":
      return theme.textDim;
    case "muted":
      return theme.textMuted;
    case "accent":
      return theme.accent;
    case "info":
      return theme.info;
    case "error":
      return theme.error;
    case "warning":
      return theme.warning;
    case "success":
      return theme.success;
    case "borderSubtle":
      return theme.border;
    case "borderActive":
      return theme.borderFocused;
    case "panel":
      return theme.surface;
    case "star":
      return theme.warning;
    case "logoPrimary":
      return theme.logoPrimary;
    case "logoSecondary":
      return theme.logoSecondary;
    case "logoShadow":
      return theme.logoShadow;
    default:
      return undefined;
  }
}

export const TimelineRowView = memo(
  function TimelineRowView({ row }: { row: TimelineRow }) {
    const isActionRow = row.key.includes("-action-");
    renderDebug.useRenderDebug("TimelineRow", {
      rowKey: row.key,
      row,
    });
    if (isActionRow) {
      renderDebug.traceFlickerEvent("timelineRowRender", {
        rowKey: row.key,
        spanToken: row.spans.map((span) => span.text).join("|"),
      });
    }

    useEffect(() => {
      if (!isActionRow) return;
      renderDebug.traceFlickerEvent("timelineRowMount", { rowKey: row.key });
      renderDebug.traceLifecycleEvent("ActionRow", "mount", { rowKey: row.key });
      renderDebug.traceLifecycleEvent("ActionBlock", "mount", { rowKey: row.key });
      return () => {
        renderDebug.traceFlickerEvent("timelineRowUnmount", { rowKey: row.key });
        renderDebug.traceLifecycleEvent("ActionRow", "unmount", { rowKey: row.key });
        renderDebug.traceLifecycleEvent("ActionBlock", "unmount", { rowKey: row.key });
      };
    }, [isActionRow, row.key]);

    const theme = useTheme();

    return (
      <Box width="100%" overflow="hidden">
        <Text>
          {row.spans.map((span, index) => (
            <Text
              key={index}
              color={getToneColor(theme, span.tone)}
              backgroundColor={getToneColor(theme, span.backgroundTone)}
              bold={span.bold}
              italic={span.italic}
              underline={span.underline}
              strikethrough={span.strikethrough}
            >
              {span.text}
            </Text>
          ))}
        </Text>
      </Box>
    );
  },
  (prev, next) => prev.row === next.row,
);

export function rowArraysEqual(left: TimelineRow[], right: TimelineRow[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export const TimelineRowsView = memo(
  function TimelineRowsView({ rows }: { rows: TimelineRow[] }) {
    return (
      <>
        {rows.map((row) => (
          <TimelineRowView key={row.key} row={row} />
        ))}
      </>
    );
  },
  (prev, next) => rowArraysEqual(prev.rows, next.rows),
);
