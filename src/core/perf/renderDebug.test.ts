import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  configureRenderDebug,
  getRenderDebugLogPath,
  traceEvent,
  traceLifecycleTransition,
  traceFlickerEvent,
  traceStatusTick,
  traceRender,
} from "./renderDebug.js";

function clean(path: string): void {
  rmSync(path, { force: true });
}

test("render debug stays quiet by default", () => {
  const logPath = join(tmpdir(), `codexa-render-debug-quiet-${process.pid}.jsonl`);
  clean(logPath);

  configureRenderDebug({ CODEXA_RENDER_DEBUG_FILE: logPath });
  traceEvent("test", "quiet");
  traceRender("QuietComponent", "test");

  assert.equal(existsSync(logPath), false);
});

test("render debug writes JSONL only when explicitly enabled", () => {
  const logPath = join(tmpdir(), `codexa-render-debug-enabled-${process.pid}.jsonl`);
  clean(logPath);

  try {
    configureRenderDebug({
      CODEXA_RENDER_DEBUG: "1",
      CODEXA_RENDER_DEBUG_FILE: logPath,
    });
    traceRender("EnabledComponent", "unit");

    assert.equal(getRenderDebugLogPath(), logPath);
    const records = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records[0]?.kind, "session");
    assert.equal(records[1]?.kind, "render");
    assert.equal(records[1]?.component, "EnabledComponent");
    assert.equal(records[1]?.reason, "unit");
  } finally {
    configureRenderDebug({});
    clean(logPath);
  }
});

test("render trace flag enables compact render diagnostics", () => {
  const logPath = join(tmpdir(), `codexa-render-trace-${process.pid}.jsonl`);
  clean(logPath);

  try {
    configureRenderDebug({
      CODEXA_DEBUG_RENDER_TRACE: "1",
      CODEXA_RENDER_DEBUG_FILE: logPath,
    });
    traceRender("TraceComponent", "unit");
    traceFlickerEvent("viewportSlice", { reason: "unit" });

    const records = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records[0]?.kind, "session");
    assert.equal(records[1]?.kind, "render");
    assert.equal(records[1]?.component, "TraceComponent");
    assert.equal(records[2]?.kind, "flicker");
    assert.equal(records[2]?.event, "viewportSlice");
  } finally {
    configureRenderDebug({});
    clean(logPath);
  }
});

test("lifecycle trace is gated by CODEXA_DEBUG_LIFECYCLE", () => {
  const logPath = join(tmpdir(), `codexa-lifecycle-debug-${process.pid}.jsonl`);
  clean(logPath);

  try {
    configureRenderDebug({
      CODEXA_DEBUG_LIFECYCLE: "1",
      CODEXA_RENDER_DEBUG_FILE: logPath,
    });
    traceLifecycleTransition({
      prevKind: "THINKING",
      nextKind: "IDLE",
      reason: "unit",
    });

    const records = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records.length, 1);
    assert.equal(records[0]?.kind, "lifecycle");
    assert.equal(records[0]?.reason, "unit");
  } finally {
    configureRenderDebug({});
    clean(logPath);
  }
});

test("flicker trace is gated by CODEXA_DEBUG_FLICKER", () => {
  const logPath = join(tmpdir(), `codexa-flicker-debug-${process.pid}.jsonl`);
  clean(logPath);

  try {
    configureRenderDebug({
      CODEXA_DEBUG_FLICKER: "1",
      CODEXA_RENDER_DEBUG_FILE: logPath,
    });
    traceFlickerEvent("timelineRender", { reason: "unit" });
    traceStatusTick({ owner: "Status", label: "Codex is thinking" });

    const records = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records.length, 2);
    assert.equal(records[0]?.kind, "flicker");
    assert.equal(records[0]?.event, "timelineRender");
    assert.equal(records[1]?.kind, "flicker");
    assert.equal(records[1]?.event, "statusTick");
  } finally {
    configureRenderDebug({});
    clean(logPath);
  }
});
