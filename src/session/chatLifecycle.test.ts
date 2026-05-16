import assert from "node:assert/strict";
import test from "node:test";
import { appendStaticEvents } from "./chatLifecycle.js";
import type { TimelineEvent } from "./types.js";

test("appendStaticEvents deduplicates consecutive identical system events", () => {
  const events: TimelineEvent[] = [
    { id: 1, type: "system", createdAt: 100, title: "T1", content: "C1" },
  ];
  const additions: TimelineEvent[] = [
    { id: 2, type: "system", createdAt: 200, title: "T1", content: "C1" }, // Duplicate
    { id: 3, type: "system", createdAt: 300, title: "T2", content: "C2" }, // Different
  ];

  const result = appendStaticEvents(events, additions);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.id, 1);
  assert.equal(result[1]?.id, 3);
});

test("appendStaticEvents deduplicates consecutive identical error events", () => {
  const events: TimelineEvent[] = [
    { id: 1, type: "error", createdAt: 100, title: "E1", content: "M1" },
  ];
  const additions: TimelineEvent[] = [
    { id: 2, type: "error", createdAt: 200, title: "E1", content: "M1" }, // Duplicate
    { id: 3, type: "error", createdAt: 300, title: "E2", content: "M2" }, // Different
  ];

  const result = appendStaticEvents(events, additions);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.id, 1);
  assert.equal(result[1]?.id, 3);
});

test("appendStaticEvents does not deduplicate different event types with same content", () => {
  const events: TimelineEvent[] = [
    { id: 1, type: "system", createdAt: 100, title: "Same", content: "Same" },
  ];
  const additions: TimelineEvent[] = [
    { id: 2, type: "error", createdAt: 200, title: "Same", content: "Same" },
  ];

  const result = appendStaticEvents(events, additions);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.id, 1);
  assert.equal(result[1]?.id, 2);
});

test("appendStaticEvents does not deduplicate non-consecutive duplicates", () => {
  const events: TimelineEvent[] = [
    { id: 1, type: "system", createdAt: 100, title: "T1", content: "C1" },
  ];
  const additions: TimelineEvent[] = [
    { id: 2, type: "system", createdAt: 200, title: "T2", content: "C2" },
    { id: 3, type: "system", createdAt: 300, title: "T1", content: "C1" }, // Identical to first, but not consecutive
  ];

  const result = appendStaticEvents(events, additions);
  assert.equal(result.length, 3);
  assert.equal(result[0]?.id, 1);
  assert.equal(result[1]?.id, 2);
  assert.equal(result[2]?.id, 3);
});
