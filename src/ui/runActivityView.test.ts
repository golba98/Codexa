import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "../session/types.js";
import { summarizeRunActivity } from "../core/workspaceActivity.js";
import {
  formatRunActivityStats,
  getVisibleRawOutputLines,
  selectVisibleRunActivity,
  shouldShowRawOutputFallback,
} from "./runActivityView.js";

function makeRunEvent(overrides: Partial<RunEvent> = {}): RunEvent {
  const activity = overrides.activity ?? [];
  return {
    id: 1,
    type: "run",
    createdAt: 1,
    startedAt: 1,
    durationMs: null,
    backendId: "codex-subprocess",
    backendLabel: "Codex CLI",
    mode: "auto-edit",
    model: "gpt-5.4",
    prompt: "Build something",
    thinkingLines: [],
    status: "running",
    summary: "Running",
    truncatedOutput: false,
    toolActivities: overrides.toolActivities ?? [],
    activity,
    touchedFileCount: overrides.touchedFileCount ?? new Set(activity.map((item) => item.path)).size,
    activitySummary: overrides.activitySummary ?? summarizeRunActivity(activity),
    errorMessage: null,
    turnId: overrides.turnId ?? 1,
    ...overrides,
  };
}

test("does not surface raw output fallback while a run is active", () => {
  const event = makeRunEvent({
    thinkingLines: ["raw line 1", "raw line 2"],
    activity: [{ path: "src/app.tsx", operation: "modified", detectedAt: 1 }],
  });

  assert.equal(shouldShowRawOutputFallback(event), false);
  assert.deepEqual(getVisibleRawOutputLines(event), []);
});

test("keeps raw output hidden even when no structured activity exists yet", () => {
  const event = makeRunEvent({
    thinkingLines: ["line 1", "line 2", "line 3", "line 4", "line 5"],
  });

  assert.equal(shouldShowRawOutputFallback(event), false);
  assert.deepEqual(getVisibleRawOutputLines(event), []);
});

test("keeps only the compact recent activity for completed runs", () => {
  const activity = Array.from({ length: 6 }, (_, index) => ({
    path: `src/file-${index}.ts`,
    operation: "modified" as const,
    detectedAt: index,
  }));
  const event = makeRunEvent({
    status: "completed",
    activity,
    activitySummary: summarizeRunActivity(activity),
  });

  const { visible, hiddenCount } = selectVisibleRunActivity(event);
  assert.equal(visible.length, 4);
  assert.equal(hiddenCount, 2);
  assert.equal(visible[0]?.path, "src/file-2.ts");
});

test("formats touched-file stats for the run card header", () => {
  const activity = [
    { path: "README.md", operation: "created" as const, detectedAt: 1 },
    { path: "src/app.tsx", operation: "modified" as const, detectedAt: 2 },
    { path: "old.txt", operation: "deleted" as const, detectedAt: 3 },
  ];
  const event = makeRunEvent({
    activity,
    touchedFileCount: 3,
    activitySummary: summarizeRunActivity(activity),
  });

  assert.equal(formatRunActivityStats(event), "3 files touched  +1  ~1  -1");
});
