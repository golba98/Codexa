import type { RunEvent } from "../session/types.js";

const MAX_VISIBLE_ACTIVE_ACTIVITY = 6;
const MAX_VISIBLE_SUMMARY_ACTIVITY = 4;
export function selectVisibleRunActivity(event: RunEvent) {
  const source = event.status === "running"
    ? event.activity
    : event.activitySummary?.recent ?? event.activity;
  const limit = event.status === "running" ? MAX_VISIBLE_ACTIVE_ACTIVITY : MAX_VISIBLE_SUMMARY_ACTIVITY;
  const visible = source.slice(-limit);
  return {
    visible,
    hiddenCount: Math.max(0, source.length - visible.length),
  };
}

export function shouldShowRawOutputFallback(event: RunEvent): boolean {
  void event;
  return false;
}

export function getVisibleRawOutputLines(event: RunEvent): string[] {
  void event;
  return [];
}

export function formatRunActivityStats(event: RunEvent): string | null {
  const summary = event.activitySummary;
  if (!summary || event.touchedFileCount === 0) return null;

  return [
    `${event.touchedFileCount} file${event.touchedFileCount === 1 ? "" : "s"} touched`,
    `+${summary.created}`,
    `~${summary.modified}`,
    `-${summary.deleted}`,
  ].join("  ");
}
