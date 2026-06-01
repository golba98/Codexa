import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createClearFrameBoundaryController } from "./clearFrameBoundary.js";
import type { InkRenderInstance } from "./inkRenderReset.js";
import { configureRenderDebug } from "../perf/renderDebug.js";

function createHarness() {
  const events: string[] = [];
  const stdout = { columns: 120, rows: 40 };
  const calls = { logReset: 0, throttledOnRenderCancel: 0, throttledLogCancel: 0 };

  const instance: InkRenderInstance = {
    lastOutput: "old-frame",
    lastOutputToRender: "old-frame\n",
    lastOutputHeight: 10,
    fullStaticOutput: "",
    log: {
      reset() {
        calls.logReset += 1;
        events.push("log.reset");
      },
    },
    throttledOnRender: {
      cancel() {
        calls.throttledOnRenderCancel += 1;
        events.push("throttledOnRender.cancel");
      },
    },
    throttledLog: {
      cancel() {
        calls.throttledLogCancel += 1;
        events.push("throttledLog.cancel");
      },
    },
    renderInteractiveFrame(output: string, outputHeight: number, staticOutput: string) {
      events.push(`write:${output}:${outputHeight}:${staticOutput.length}`);
      this.lastOutput = output;
      this.lastOutputToRender = `${output}\n`;
      this.lastOutputHeight = outputHeight;
    },
  };

  const terminalControl = {
    clearTranscript(source: string) {
      events.push(`clear:${source}`);
    },
    clearViewport(source: string) {
      events.push(`clearViewport:${source}`);
    },
  };

  const controller = createClearFrameBoundaryController({
    instance,
    terminalControl,
    stdout,
    source: "test:clearBoundary",
  });

  assert.ok(controller, "controller should be created");

  return {
    instance,
    stdout,
    calls,
    events,
    controller,
  };
}

test("suppresses stale pre-clear frames while clear is pending and commits one authoritative post-clear frame", () => {
  const harness = createHarness();
  const { controller, instance, calls, events } = harness;

  controller.syncRenderState({
    generation: 0,
    staticEventsLength: 2,
    activeEventsLength: 1,
    transcriptCleared: false,
    uiStateKind: "RESPONDING",
  });
  assert.equal(controller.beginClearGeneration(1), true);

  instance.renderInteractiveFrame?.("old-frame", 10, "");
  assert.equal(events.length, 0, "stale pre-clear frame should be dropped without writes");
  assert.equal(controller.getState().clearPending, true);

  controller.syncRenderState({
    generation: 1,
    staticEventsLength: 0,
    activeEventsLength: 0,
    transcriptCleared: true,
    uiStateKind: "IDLE",
  });
  instance.renderInteractiveFrame?.("fresh-post-clear", 6, "");

  assert.equal(events[0]?.startsWith("clear:test:clearBoundary:firstPostClearFrame"), true);
  assert.equal(events.includes("throttledOnRender.cancel"), true);
  assert.equal(events.includes("throttledLog.cancel"), true);
  assert.equal(events.includes("log.reset"), true);
  assert.equal(events.some((entry) => entry.startsWith("write:fresh-post-clear")), true);
  assert.equal(calls.logReset, 1);
  assert.equal(calls.throttledOnRenderCancel, 1);
  assert.equal(calls.throttledLogCancel, 1);
  assert.equal(controller.getState().clearPending, false);
  assert.equal(controller.getState().committedGeneration, 1);
});

test("drops stale frames by snapshot hash even after app generation has advanced", () => {
  const harness = createHarness();
  const { controller, instance, events } = harness;

  controller.syncRenderState({
    generation: 0,
    staticEventsLength: 1,
    activeEventsLength: 1,
    transcriptCleared: false,
    uiStateKind: "RESPONDING",
  });
  assert.equal(controller.beginClearGeneration(1), true);
  controller.syncRenderState({
    generation: 1,
    staticEventsLength: 1,
    activeEventsLength: 1,
    transcriptCleared: false,
    uiStateKind: "RESPONDING",
  });

  instance.renderInteractiveFrame?.("old-frame", 10, "");
  assert.equal(events.length, 0, "stale pre-clear frame should still be suppressed until transcript clears");

  controller.syncRenderState({
    generation: 1,
    staticEventsLength: 0,
    activeEventsLength: 0,
    transcriptCleared: true,
    uiStateKind: "IDLE",
  });
  instance.renderInteractiveFrame?.("new-frame", 5, "");
  assert.equal(events.some((entry) => entry.startsWith("clear:")), true);
  assert.equal(events.some((entry) => entry.startsWith("write:new-frame")), true);
});

test("marks only the first committed post-clear frame as authoritative", () => {
  const harness = createHarness();
  const { controller, instance } = harness;

  controller.syncRenderState({
    generation: 0,
    staticEventsLength: 2,
    activeEventsLength: 1,
    transcriptCleared: false,
    uiStateKind: "RESPONDING",
  });
  controller.beginClearGeneration(1);
  controller.syncRenderState({
    generation: 1,
    staticEventsLength: 0,
    activeEventsLength: 0,
    transcriptCleared: true,
    uiStateKind: "IDLE",
  });

  instance.renderInteractiveFrame?.("first-post-clear", 4, "");
  assert.equal(controller.getState().lastFrameWasAuthoritative, true);

  instance.renderInteractiveFrame?.("later-frame", 4, "");
  assert.equal(controller.getState().lastFrameWasAuthoritative, false);
});

test("syncRenderState signals a post-clear repaint until the authoritative frame commits", () => {
  const harness = createHarness();
  const { controller, instance, events } = harness;

  controller.syncRenderState({
    generation: 0,
    staticEventsLength: 2,
    activeEventsLength: 1,
    transcriptCleared: false,
    uiStateKind: "RESPONDING",
  });
  controller.beginClearGeneration(1);

  // The cleared render state hasn't been synced yet: the frame must stay
  // suppressed and no repaint should be requested.
  const beforeCleared = controller.syncRenderState({
    generation: 0,
    staticEventsLength: 2,
    activeEventsLength: 1,
    transcriptCleared: false,
    uiStateKind: "RESPONDING",
  });
  assert.equal(beforeCleared, false, "no repaint requested before the transcript clears");

  // Mirrors the post-CLEAR_TRANSCRIPT passive effect: generation advanced and
  // events empty. Ink already wrote/suppressed the cleared frame during the
  // commit, so the boundary must now ask the host to force one more render.
  const afterCleared = controller.syncRenderState({
    generation: 1,
    staticEventsLength: 0,
    activeEventsLength: 0,
    transcriptCleared: true,
    uiStateKind: "IDLE",
  });
  assert.equal(afterCleared, true, "host must be told to force a repaint once the cleared frame is ready");

  // The forced repaint runs renderInteractiveFrame again, which now commits the
  // authoritative frame instead of leaving it stuck behind the stale gate.
  instance.renderInteractiveFrame?.("fresh-post-clear", 6, "");
  assert.equal(controller.getState().clearPending, false, "post-clear frame committed");
  assert.equal(events.some((entry) => entry.startsWith("write:fresh-post-clear")), true, "authoritative frame is written");

  // Once committed, no further repaint should be requested (no render loop).
  const afterCommit = controller.syncRenderState({
    generation: 1,
    staticEventsLength: 0,
    activeEventsLength: 0,
    transcriptCleared: true,
    uiStateKind: "IDLE",
  });
  assert.equal(afterCommit, false, "no repeated repaint once the post-clear frame is committed");
});

test("repaints authoritatively with a scrollback-inclusive clear on a width-changing resize after clear", () => {
  const harness = createHarness();
  const { controller, instance, stdout, calls, events } = harness;

  controller.syncRenderState({
    generation: 0,
    staticEventsLength: 2,
    activeEventsLength: 1,
    transcriptCleared: false,
    uiStateKind: "RESPONDING",
  });
  controller.beginClearGeneration(1);
  controller.syncRenderState({
    generation: 1,
    staticEventsLength: 0,
    activeEventsLength: 0,
    transcriptCleared: true,
    uiStateKind: "IDLE",
  });
  instance.renderInteractiveFrame?.("first-post-clear", 4, "");

  stdout.columns = 180;
  stdout.rows = 50;
  instance.renderInteractiveFrame?.("resize-refresh-frame", 8, "");

  // The resize repaint must use the transcript clear (scrollback-inclusive), not
  // a viewport-only clear — otherwise the pre-resize frame survives in scrollback
  // and stacks on a GNOME Terminal grow.
  const transcriptClearIndex = events.findIndex((entry) => entry.startsWith("clear:test:clearBoundary:resizeRefresh"));
  const resizeWriteIndex = events.findIndex((entry) => entry.startsWith("write:resize-refresh-frame"));
  assert.ok(transcriptClearIndex >= 0, "width-changing resize should emit a scrollback-inclusive transcript clear");
  assert.equal(
    events.some((entry) => entry.startsWith("clearViewport:")),
    false,
    "resize repaint must not use a viewport-only clear",
  );
  assert.ok(resizeWriteIndex > transcriptClearIndex, "transcript clear should happen before the resize repaint write");
  assert.equal(controller.getState().lastFrameWasAuthoritative, true);
  assert.equal(calls.logReset, 2, "log-update reset should run at post-clear commit and the resize repaint");
});

test("repaints authoritatively on every width-changing resize, not just the first after clear", () => {
  const harness = createHarness();
  const { controller, instance, stdout, calls, events } = harness;

  controller.syncRenderState({
    generation: 0,
    staticEventsLength: 2,
    activeEventsLength: 1,
    transcriptCleared: false,
    uiStateKind: "RESPONDING",
  });
  controller.beginClearGeneration(1);
  controller.syncRenderState({
    generation: 1,
    staticEventsLength: 0,
    activeEventsLength: 0,
    transcriptCleared: true,
    uiStateKind: "IDLE",
  });
  instance.renderInteractiveFrame?.("first-post-clear", 4, "");

  stdout.columns = 180;
  stdout.rows = 50;
  instance.renderInteractiveFrame?.("first-resize", 8, "");
  const resetAfterFirstResize = calls.logReset;

  // Restore (a second width change) must also repaint authoritatively — the old
  // bug was that only the first resize after /clear recovered.
  stdout.columns = 101;
  stdout.rows = 23;
  instance.renderInteractiveFrame?.("second-resize", 9, "");
  assert.equal(controller.getState().lastFrameWasAuthoritative, true, "second width change should also be authoritative");
  assert.equal(calls.logReset, resetAfterFirstResize + 1, "second width-changing resize should force another reset");
  assert.equal(
    events.filter((entry) => entry.startsWith("clear:test:clearBoundary:resizeRefresh")).length,
    2,
    "each width-changing resize should emit its own transcript clear",
  );
});

test("does not repaint on a height-only resize (no width change)", () => {
  const harness = createHarness();
  const { controller, instance, stdout, calls, events } = harness;

  controller.syncRenderState({
    generation: 0,
    staticEventsLength: 2,
    activeEventsLength: 1,
    transcriptCleared: false,
    uiStateKind: "RESPONDING",
  });
  controller.beginClearGeneration(1);
  controller.syncRenderState({
    generation: 1,
    staticEventsLength: 0,
    activeEventsLength: 0,
    transcriptCleared: true,
    uiStateKind: "IDLE",
  });
  instance.renderInteractiveFrame?.("first-post-clear", 4, "");
  const resetAfterClear = calls.logReset;

  // Only the row count changes — no reflow risk, so no authoritative repaint.
  stdout.rows = 60;
  instance.renderInteractiveFrame?.("taller-frame", 5, "");
  assert.equal(controller.getState().lastFrameWasAuthoritative, false);
  assert.equal(calls.logReset, resetAfterClear, "height-only resize should not force a reset");
  assert.equal(
    events.filter((entry) => entry.startsWith("clear:test:clearBoundary:resizeRefresh")).length,
    0,
    "height-only resize should not emit a resize repaint clear",
  );
});

test("logs clear generation, stale suppression, and first committed post-clear frame fields for terminal tracing", () => {
  const logPath = join(tmpdir(), `codexa-clear-boundary-${process.pid}-${Date.now()}.jsonl`);
  rmSync(logPath, { force: true });

  try {
    configureRenderDebug({
      CODEXA_TERMINAL_TRACE: "1",
      CODEXA_RENDER_DEBUG_FILE: logPath,
    });

    const harness = createHarness();
    const { controller, instance } = harness;

    controller.syncRenderState({
      generation: 0,
      staticEventsLength: 2,
      activeEventsLength: 1,
      transcriptCleared: false,
      uiStateKind: "RESPONDING",
    });
    controller.beginClearGeneration(1);
    instance.renderInteractiveFrame?.("old-frame", 10, "");
    controller.syncRenderState({
      generation: 1,
      staticEventsLength: 0,
      activeEventsLength: 0,
      transcriptCleared: true,
      uiStateKind: "IDLE",
    });
    instance.renderInteractiveFrame?.("post-clear-frame", 6, "");
    harness.stdout.columns = 160;
    harness.stdout.rows = 52;
    instance.renderInteractiveFrame?.("post-clear-resize-frame", 7, "");

    const records = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)) as Array<Record<string, unknown>>;
    const frameRecords = records.filter((entry) => entry.kind === "terminal" && entry.event === "clearBoundaryFrame");
    const firstCommit = records.find((entry) => entry.kind === "terminal" && entry.event === "firstCommittedPostClearFrame");
    const resizeCommit = records.find((entry) => entry.kind === "terminal" && entry.event === "resizeRefreshCommitted");
    assert.ok(frameRecords.some((entry) => entry.staleFrameSuppressed === true), "stale pre-clear suppression should be traced");
    assert.ok(frameRecords.some((entry) => entry.frameClassification === "post-clear"), "post-clear frame classification should be traced");
    assert.ok(frameRecords.some((entry) => entry.resizeRefreshApplied === true), "width-change resize refresh should be traced");
    assert.ok(frameRecords.some((entry) => entry.frameClassification === "resize-refresh"), "resize-refresh classification should be traced");
    assert.ok(firstCommit, "first committed post-clear frame should be traced");
    assert.ok(resizeCommit, "resize refresh commit should be traced");
    assert.equal(typeof firstCommit.frameHash, "string");
    assert.equal(firstCommit.firstFrameAuthoritative, true);
  } finally {
    configureRenderDebug({});
    rmSync(logPath, { force: true });
  }
});

test("returns null when no live Ink instance is available", () => {
  const controller = createClearFrameBoundaryController({
    instance: null,
    terminalControl: { clearTranscript() {}, clearViewport() {} },
    stdout: { columns: 100, rows: 30 },
  });
  assert.equal(controller, null);
});
