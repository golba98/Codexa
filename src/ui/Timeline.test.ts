import assert from "node:assert/strict";
import test from "node:test";
import type { TimelineEvent } from "../session/types.js";
import { buildTimelineItems, resolveTurnOpacity } from "./Timeline.js";

test("groups user, run, and assistant events into a single turn item", () => {
  const events: TimelineEvent[] = [
    {
      id: 1,
      type: "user",
      createdAt: 1,
      prompt: "Implement rate limiting",
      turnId: 10,
    },
    {
      id: 2,
      type: "run",
      createdAt: 2,
      startedAt: 2,
      durationMs: null,
      backendId: "codex-subprocess",
      backendLabel: "Codexa",
      mode: "auto-edit",
      model: "gpt-5.4",
      prompt: "Implement rate limiting",
      thinkingLines: ["Scanning routes..."],
      status: "running",
      summary: "Running",
      truncatedOutput: false,
      toolActivities: [],
      activity: [],
      touchedFileCount: 0,
      errorMessage: null,
      turnId: 10,
    },
    {
      id: 3,
      type: "assistant",
      createdAt: 3,
      content: "I found the auth router.",
      turnId: 10,
    },
    {
      id: 4,
      type: "system",
      createdAt: 4,
      title: "Mode updated",
      content: "AUTO-EDIT enabled",
    },
  ];

  const items = buildTimelineItems(events);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.type, "turn");
  assert.equal(items[1]?.type, "event");

  if (items[0]?.type !== "turn") {
    throw new Error("Expected first item to be a turn");
  }

  assert.equal(items[0].turnId, 10);
  assert.equal(items[0].user?.prompt, "Implement rate limiting");
  assert.equal(items[0].run?.thinkingLines[0], "Scanning routes...");
  assert.equal(items[0].assistant?.content, "I found the auth router.");
});

test("derives active, recent, and dim turn opacity from ordered turn ids", () => {
  const turnIds = [1, 2, 3];

  assert.equal(resolveTurnOpacity(turnIds, 3, 3), "active");
  assert.equal(resolveTurnOpacity(turnIds, 2, 3), "recent");
  assert.equal(resolveTurnOpacity(turnIds, 1, 3), "dim");

  assert.equal(resolveTurnOpacity(turnIds, 3, null), "recent");
  assert.equal(resolveTurnOpacity(turnIds, 1, null), "dim");
});
