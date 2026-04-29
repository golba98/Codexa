import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import React from "react";
import { render } from "ink";
import type { TimelineEvent, UIState } from "../session/types.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";
import * as renderDebug from "../core/perf/renderDebug.js";
import { AppShell } from "./AppShell.js";
import { BottomComposer, measureBottomComposerRows } from "./BottomComposer.js";
import { createLayoutSnapshot } from "./layout.js";
import { ThemeProvider } from "./theme.js";

class TestInput extends PassThrough {
  readonly isTTY = true;

  setRawMode(): this {
    return this;
  }

  override resume(): this {
    return this;
  }

  override pause(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

class TestOutput extends PassThrough {
  readonly isTTY = true;
  columns = 120;
  rows = 40;
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRecords(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];
}

function countMatching(records: Array<Record<string, unknown>>, predicate: (record: Record<string, unknown>) => boolean): number {
  return records.filter(predicate).length;
}

function makeActiveEvents(actionStatus: "running" | "completed" = "completed"): TimelineEvent[] {
  const actionCompletedAt = actionStatus === "completed" ? 4 : null;
  return [
    {
      id: 1,
      type: "user",
      createdAt: 1,
      prompt: "What is the point of 5-Date Verification",
      turnId: 1,
    },
    {
      id: 2,
      type: "run",
      createdAt: 2,
      startedAt: 2,
      durationMs: null,
      backendId: "codex-subprocess",
      backendLabel: "Codexa",
      runtime: TEST_RUNTIME,
      prompt: "What is the point of 5-Date Verification",
      progressEntries: [{
        id: "thinking-1",
        source: "reasoning",
        text: "Checking the verification rule.",
        sequence: 1,
        createdAt: 2,
        updatedAt: 2,
        pendingNewlineCount: 0,
        blocks: [{
          id: "thinking-1-block-1",
          text: "Checking the verification rule.",
          sequence: 1,
          createdAt: 2,
          updatedAt: 2,
          status: "completed",
          streamSeq: 1,
        }],
      }],
      status: "running",
      summary: "Running",
      truncatedOutput: false,
      toolActivities: [{
        id: "tool-1",
        command: "Get-Content README.md",
        status: actionStatus,
        startedAt: 3,
        completedAt: actionCompletedAt,
        summary: actionStatus === "completed" ? "Read 12 lines" : null,
        streamSeq: 2,
      }],
      activity: [],
      touchedFileCount: 0,
      errorMessage: null,
      turnId: 1,
      streamItems: [
        { kind: "thinking", streamSeq: 1, refId: "thinking-1-block-1" },
        { kind: "action", streamSeq: 2, refId: "tool-1" },
      ],
      responseSegments: [],
      lastStreamSeq: 2,
      activeResponseSegmentId: null,
    },
  ];
}

function Harness({ actionStatus = "completed" }: { actionStatus?: "running" | "completed" }) {
  const layout = createLayoutSnapshot(120, 40);
  const uiState: UIState = { kind: "THINKING", turnId: 1 };
  const composerRows = measureBottomComposerRows({
    layout,
    uiState,
    mode: "suggest",
    model: "gpt-5.4",
    reasoningLevel: "balanced",
    value: "",
    cursor: 0,
  });

  return (
    <ThemeProvider theme="purple">
      <AppShell
        layout={layout}
        screen="main"
        authState="authenticated"
        workspaceLabel="workspace"
        runtimeSummary={null}
        staticEvents={[]}
        activeEvents={makeActiveEvents(actionStatus)}
        uiState={uiState}
        composerRows={composerRows}
        panel={null}
        composer={(
          <BottomComposer
            layout={layout}
            uiState={uiState}
            mode="suggest"
            model="gpt-5.4"
            reasoningLevel="balanced"
            tokensUsed={100}
            value=""
            cursor={0}
            onChangeInput={() => {}}
            onSubmit={() => {}}
            onCancel={() => {}}
            onChangeValue={() => {}}
            onChangeCursor={() => {}}
            onHistoryUp={() => {}}
            onHistoryDown={() => {}}
            onOpenBackendPicker={() => {}}
            onOpenModelPicker={() => {}}
            onOpenModePicker={() => {}}
            onOpenThemePicker={() => {}}
            onOpenAuthPanel={() => {}}
            onTogglePlanMode={() => {}}
            onClear={() => {}}
            onCycleMode={() => {}}
            onQuit={() => {}}
          />
        )}
      />
    </ThemeProvider>
  );
}

test("status dot ticks do not invalidate timeline rendering", async () => {
  const logPath = join(tmpdir(), `codexa-status-isolation-${process.pid}.jsonl`);
  rmSync(logPath, { force: true });
  renderDebug.configureRenderDebug({
    CODEXA_DEBUG_RENDER_TRACE: "1",
    CODEXA_RENDER_DEBUG_FILE: logPath,
  });

  const stdin = new TestInput();
  const stdout = new TestOutput();
  const instance = render(<Harness />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
  });

  try {
    await sleep(100);
    const beforeTick = readRecords(logPath);

    await sleep(420);
    const afterTick = readRecords(logPath);
    const tickWindow = afterTick.slice(beforeTick.length);

    assert.equal(countMatching(tickWindow, (record) => record.kind === "status" && record.event === "tick"), 1);
    assert(countMatching(tickWindow, (record) => record.kind === "render" && record.component === "Status") >= 1);
    assert.equal(countMatching(tickWindow, (record) => record.kind === "render" && record.component === "Timeline"), 0);
    assert.equal(countMatching(tickWindow, (record) => record.kind === "timeline" && record.event === "rowGeneration"), 0);
    assert.equal(countMatching(tickWindow, (record) => record.kind === "viewport" && record.event === "slice"), 0);
    assert.equal(countMatching(tickWindow, (record) => record.kind === "render" && record.component === "ActionLog"), 0);
  } finally {
    instance.unmount();
    renderDebug.configureRenderDebug({});
    rmSync(logPath, { force: true });
  }
});

test("action rows update without remounting when a running action completes", async () => {
  const logPath = join(tmpdir(), `codexa-action-remount-${process.pid}.jsonl`);
  rmSync(logPath, { force: true });
  renderDebug.configureRenderDebug({
    CODEXA_DEBUG_RENDER_TRACE: "1",
    CODEXA_RENDER_DEBUG_FILE: logPath,
  });

  const stdin = new TestInput();
  const stdout = new TestOutput();
  const instance = render(<Harness actionStatus="running" />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
  });

  try {
    await sleep(100);
    const beforeCompletion = readRecords(logPath);
    const mountedActionRows = beforeCompletion
      .filter((record) => record.kind === "flicker" && record.event === "timelineRowMount")
      .map((record) => String(record.rowKey ?? ""))
      .filter((rowKey) => rowKey.includes("-action-"));

    assert.ok(mountedActionRows.length > 0, "expected action rows to mount in the initial frame");

    instance.rerender(<Harness actionStatus="completed" />);
    await sleep(100);

    const afterCompletion = readRecords(logPath).slice(beforeCompletion.length);
    const unmountedActionRows = afterCompletion
      .filter((record) => record.kind === "flicker" && record.event === "timelineRowUnmount")
      .map((record) => String(record.rowKey ?? ""))
      .filter((rowKey) => rowKey.includes("-action-"));

    assert.deepEqual(unmountedActionRows, []);
  } finally {
    instance.unmount();
    renderDebug.configureRenderDebug({});
    rmSync(logPath, { force: true });
  }
});
