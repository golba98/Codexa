import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createClearFrameBoundaryController } from "./clearFrameBoundary.js";
import type { InkRenderInstance } from "./inkRenderReset.js";
import { configureRenderDebug } from "../perf/renderDebug.js";

function createHarness(overrides: { now?: () => number; startupGraceMs?: number; onWidthResizeRefresh?: () => void } = {}) {
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
    ...overrides,
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

test("seeded post-clear launch frame is ready even when static events are not empty", () => {
  const harness = createHarness();
  const { controller, instance, events } = harness;

  controller.syncRenderState({
    generation: 0,
    staticEventsLength: 4,
    activeEventsLength: 2,
    transcriptCleared: false,
    uiStateKind: "RESPONDING",
  });
  controller.beginClearGeneration(1);

  const repaintRequested = controller.syncRenderState({
    generation: 1,
    staticEventsLength: 1,
    activeEventsLength: 0,
    transcriptCleared: false,
    clearGenerationReady: true,
    uiStateKind: "IDLE",
  });

  assert.equal(repaintRequested, true, "seeded launch frame should be eligible for the authoritative post-clear repaint");

  instance.renderInteractiveFrame?.("██████\nLaunch mode\n│ ❯", 8, "");

  assert.equal(events[0]?.startsWith("clear:test:clearBoundary:firstPostClearFrame"), true);
  assert.equal(events.some((entry) => entry.startsWith("write:██████\nLaunch mode\n│ ❯")), true);
  assert.equal(controller.getState().clearPending, false);
  assert.equal(controller.getState().committedGeneration, 1);
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

test("onWidthResizeRefresh fires exactly once per genuine width-changing resize, and not otherwise", () => {
  // The physical clear a resize-refresh performs erases whatever <Static> has
  // already flushed (logo, past turns) without Ink ever re-emitting it on its
  // own — the caller (app.tsx) needs this callback to force a fresh <Static>
  // key so that content reprints at the new width. It must fire once per real
  // width change, and not for height-only resizes or repeated commits at the
  // same width.
  let resizeRefreshCount = 0;
  const harness = createHarness({ onWidthResizeRefresh: () => { resizeRefreshCount += 1; } });
  const { controller, instance, stdout } = harness;

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
  assert.equal(resizeRefreshCount, 0, "the post-clear commit itself is not a resize refresh");

  // Height-only resize: must not fire.
  stdout.rows = 60;
  instance.renderInteractiveFrame?.("taller-frame", 5, "");
  assert.equal(resizeRefreshCount, 0, "height-only resize should not trigger the callback");

  // Genuine width change: must fire exactly once.
  stdout.columns = 180;
  instance.renderInteractiveFrame?.("first-resize", 8, "");
  assert.equal(resizeRefreshCount, 1, "width-changing resize should trigger the callback once");

  // Another commit at the same (now-settled) width: must not fire again.
  instance.renderInteractiveFrame?.("same-width-frame", 8, "");
  assert.equal(resizeRefreshCount, 1, "a subsequent commit at the same width should not re-trigger the callback");

  // A second, later width change: must fire again.
  stdout.columns = 101;
  instance.renderInteractiveFrame?.("second-resize", 9, "");
  assert.equal(resizeRefreshCount, 2, "each new width change should trigger the callback again");
});

test("suppresses the resize-refresh clear for a width change within the startup grace window, then applies it once the window passes", () => {
  // Terminals/PTYs commonly report a provisional column count on attach and
  // correct it a few ms later. Without a grace window, that correction reads
  // as a mid-session resize on the very first frame — before <Static> content
  // (logo/system events) even has a chance to be considered "already shown" —
  // and the resulting scrollback-inclusive clear permanently erases it, since
  // <Static> never re-emits items once flushed. This must be suppressed only
  // long enough for dimensions to settle, then behave exactly as before.
  let currentTime = 1_000;
  const harness = createHarness({ now: () => currentTime, startupGraceMs: 300 });
  const { controller, instance, stdout, calls, events } = harness;

  // No prior /clear — this is the very first frame the boundary ever sees.
  instance.renderInteractiveFrame?.("first-frame", 4, "");
  const resetAfterFirstFrame = calls.logReset;

  // A width change lands while still inside the grace window.
  currentTime += 50;
  stdout.columns = 180;
  instance.renderInteractiveFrame?.("settling-width-frame", 4, "");
  assert.equal(controller.getState().lastFrameWasAuthoritative, false, "width settle inside grace window must not be authoritative");
  assert.equal(calls.logReset, resetAfterFirstFrame, "no Ink cache reset during the startup grace window");
  assert.equal(
    events.filter((entry) => entry.startsWith("clear:test:clearBoundary:resizeRefresh")).length,
    0,
    "no scrollback-inclusive clear during the startup grace window",
  );

  // Once the grace window has passed, a genuine width change is still refreshed authoritatively.
  currentTime += 300;
  stdout.columns = 100;
  instance.renderInteractiveFrame?.("post-grace-resize-frame", 4, "");
  assert.equal(controller.getState().lastFrameWasAuthoritative, true, "width change after the grace window should still be authoritative");
  assert.equal(
    events.filter((entry) => entry.startsWith("clear:test:clearBoundary:resizeRefresh")).length,
    1,
    "width change after the grace window should emit its scrollback-inclusive clear",
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

test("terminal trace marker counts include Ink static output from the startup frame", () => {
  const logPath = join(tmpdir(), `codexa-clear-boundary-markers-${process.pid}-${Date.now()}.jsonl`);
  rmSync(logPath, { force: true });

  try {
    configureRenderDebug({
      CODEXA_TERMINAL_TRACE: "1",
      CODEXA_RENDER_DEBUG_FILE: logPath,
    });

    const harness = createHarness();
    const { instance } = harness;

    instance.renderInteractiveFrame?.(
      [
        "│ ❯",
        "Local / qwen/qwen3.6-35b-a3b (High)",
        "Context: 115 / 262K",
      ].join("\n"),
      9,
      [
        "██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝██╔══██╗",
        "Launch mode",
        "Provider migrated",
      ].join("\n"),
    );

    const records = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)) as Array<Record<string, unknown>>;
    const frame = records.find((entry) => entry.kind === "terminal" && entry.event === "clearBoundaryFrame");
    assert.ok(frame, "startup frame should be traced");
    assert.equal(frame.codexaLogoCount, 1);
    assert.equal(frame.providerMigratedCount, 1);
    assert.equal(frame.launchModeCount, 1);
    assert.equal(frame.composerCount, 1);
    assert.equal(frame.footerCount, 1);
    assert.equal(frame.currentCols, 120);
    assert.equal(frame.currentRows, 40);
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
