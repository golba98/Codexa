import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import React from "react";
import { render, Text } from "ink";
import type { RuntimeSummary } from "../config/runtimeConfig.js";
import type { RunEvent, TimelineEvent, UIState, UserPromptEvent } from "../session/types.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";
import { resetInkOutputForFreshFrame, resolveInkRenderInstance } from "../core/terminal/inkRenderReset.js";
import { createLayoutSnapshot } from "./layout.js";
import { LOGO_COMPACT, LOGO_LARGE } from "./logoVariants.js";
import { ThemeProvider } from "./theme.js";
import { TranscriptShell } from "./TranscriptShell.js";

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
  rows = 30;
}

const IDLE: UIState = { kind: "IDLE" };
const TEST_RUNTIME_SUMMARY: RuntimeSummary = {
  providerLabel: "Local",
  model: "gpt-5.4",
  modelLabel: "qwen/qwen3.6-35b-a3b",
  reasoningLabel: "High",
  contextLabel: "115 / 262K",
  modeLabel: "Full Auto",
  sandboxLabel: "Workspace Write",
  approvalLabel: "Never",
  networkLabel: "Enabled",
  writableRootsLabel: "none",
};

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function countOccurrences(value: string, needle: string): number {
  return stripAnsi(value).split(needle).length - 1;
}

function assertFullLargeLogoVisible(value: string): void {
  const text = stripAnsi(value);
  LOGO_LARGE.forEach((line) => {
    assert.ok(
      text.includes(line.trim()),
      `expected full large logo row to be visible: ${line}`,
    );
  });
}

function firstLineIndex(value: string, needle: string): number {
  return stripAnsi(value).split(/\r?\n/).findIndex((line) => line.includes(needle));
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function systemEvent(id: number, content: string): TimelineEvent {
  return {
    id,
    type: "system",
    createdAt: id,
    title: `System ${id}`,
    content,
  };
}

function launchEvent(id = 1): TimelineEvent {
  return {
    id,
    type: "system",
    createdAt: id,
    title: "Launch mode",
    content: "Ready. Type a prompt, run !shell, or use /command.\nTip: /workspace relaunch <path>",
  };
}

function providerMigrationEvent(id = 2): TimelineEvent {
  return {
    id,
    type: "system",
    createdAt: id,
    title: "Provider migrated",
    content: "Antigravity provider is no longer supported. Reverted to Local.",
  };
}

function userPromptEvent(turnId = 10, prompt = "hi"): UserPromptEvent {
  return {
    id: turnId * 10,
    type: "user",
    createdAt: turnId,
    prompt,
    turnId,
  };
}

function runningRunEvent(turnId = 10, prompt = "hi"): RunEvent {
  return {
    id: (turnId * 10) + 1,
    type: "run",
    createdAt: turnId,
    startedAt: turnId,
    durationMs: null,
    backendId: "codex-subprocess",
    backendLabel: "Codexa",
    runtime: TEST_RUNTIME,
    prompt,
    progressEntries: [],
    status: "running",
    summary: "thinking...",
    truncatedOutput: false,
    toolActivities: [],
    activity: [],
    touchedFileCount: 0,
    errorMessage: null,
    turnId,
    streamItems: [],
    responseSegments: [],
    lastStreamSeq: 0,
    activeResponseSegmentId: null,
  };
}

function transcriptNode({
  staticEvents,
  activeEvents = [],
  uiState = IDLE,
  visible = true,
  prompt = "LIVE PROMPT",
  clearCount = 0,
  repaintGeneration = 0,
  cols = 120,
  rows = 30,
}: {
  staticEvents: TimelineEvent[];
  activeEvents?: TimelineEvent[];
  uiState?: UIState;
  visible?: boolean;
  prompt?: string;
  clearCount?: number;
  repaintGeneration?: number;
  cols?: number;
  rows?: number;
}) {
  const layout = createLayoutSnapshot(cols, rows);
  return (
    <ThemeProvider theme="purple">
      <TranscriptShell
        layout={layout}
        authState="authenticated"
        workspaceLabel="/workspace/codexa"
        workspaceRoot="/workspace/codexa"
        runtimeSummary={TEST_RUNTIME_SUMMARY}
        staticEvents={staticEvents}
        activeEvents={activeEvents}
        uiState={uiState}
        composer={<Text>{prompt}</Text>}
        composerRows={5}
        clearCount={clearCount}
        repaintGeneration={repaintGeneration}
        visible={visible}
      />
    </ThemeProvider>
  );
}

function renderTranscript(
  staticEvents: TimelineEvent[] = [],
  options: {
    prompt?: string;
    activeEvents?: TimelineEvent[];
    uiState?: UIState;
    cols?: number;
    rows?: number;
  } = {},
) {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = options.cols ?? stdout.columns;
  stdout.rows = options.rows ?? stdout.rows;
  let output = "";
  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const instance = render(transcriptNode({ staticEvents, ...options }), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  return { instance, stdout, getOutput: () => output };
}

function detectBrandTier(value: string): "large" | "compact" | "wordmark" | "none" {
  const text = stripAnsi(value);
  if (text.includes(LOGO_LARGE[0]!.trim())) return "large";
  if (text.includes(LOGO_COMPACT[0]!)) return "compact";
  if (text.includes("CODEXA") || text.includes("Codexa")) return "wordmark";
  return "none";
}

function assertHomeScreenFrame(value: string, size: { cols: number; rows: number }, expectedTier: "large" | "compact" | "wordmark") {
  const text = stripAnsi(value);
  assert.equal(detectBrandTier(text), expectedTier, `${size.cols}x${size.rows} should use the same responsive brand tier`);
  assert.match(text, /Codexa v/);
  assert.match(text, /Workspace: codexa/);
  assert.match(text, /Provider: Local/);
  assert.equal(countOccurrences(text, "│ ❯"), 1, `${size.cols}x${size.rows} should render one composer`);
  assert.equal(countOccurrences(text, "Context:"), 1, `${size.cols}x${size.rows} should render one footer/status area`);

  const lines = text.split(/\r?\n/);
  const brandIndex = lines.findIndex((line) => line.includes("██████") || line.includes("✦ CODEXA") || line.includes("CODEXA") || line.includes("Codexa v"));
  const composerIndex = lines.findIndex((line) => line.includes("│ ❯"));
  assert.ok(brandIndex >= 0, `${size.cols}x${size.rows} should render branding`);
  assert.ok(composerIndex > brandIndex, `${size.cols}x${size.rows} should render branding before composer`);
}

test("prints the Codexa intro once into the transcript across prompt rerenders", async () => {
  const { instance, getOutput } = renderTranscript([launchEvent(), systemEvent(2, "initial history line")]);
  await sleep();

  instance.rerender(transcriptNode({
    staticEvents: [launchEvent(), systemEvent(2, "initial history line")],
    prompt: "UPDATED LIVE PROMPT",
  }));
  await sleep();
  instance.cleanup();

  const output = getOutput();
  assert.equal(countOccurrences(output, "Codexa v"), 1);
  assert.equal(countOccurrences(output, "Provider: Local"), 1);
  assert.match(stripAnsi(output), /UPDATED LIVE PROMPT/);
});

test("reprints already-flushed transcript content when repaintGeneration changes", async () => {
  // A width-changing resize physically clears the real terminal AND resets
  // Ink's own output caches (clearFrameBoundary.ts's resetInkOutputForFreshFrame,
  // called before app.tsx's onWidthResizeRefresh bumps repaintGeneration) —
  // both steps are required for a reprint: without the cache reset, Ink's
  // internal fullStaticOutput bookkeeping suppresses the rewrite even though
  // React mounted a fresh <Static>. Simulate both here, in that order, the
  // same as the real clearFrameBoundary.ts code path.
  //
  // repaintGeneration is folded into the OUTER TranscriptShell remount key,
  // not just <Static>'s own key — confirmed empirically that keying away only
  // the inner <Static> node does not reliably trigger Ink's "capture static
  // content before it gets deleted" escape hatch (reconciler.js's
  // isStaticDirty/onImmediateRender). A full remount also remounts the
  // composer, same as it already does for /clear (clearCount) — an acceptable
  // trade-off, since a real terminal resize is already a disruptive,
  // whole-screen event, unlike normal typing.
  const { instance, stdout, getOutput } = renderTranscript([launchEvent(), systemEvent(2, "initial history line")]);
  await sleep();

  const beforeOutput = getOutput();
  assert.equal(countOccurrences(beforeOutput, "Codexa v"), 1);
  assert.equal(countOccurrences(beforeOutput, "Launch mode"), 1);

  resetInkOutputForFreshFrame({ instance: resolveInkRenderInstance(stdout), columns: stdout.columns });
  instance.rerender(transcriptNode({
    staticEvents: [launchEvent(), systemEvent(2, "initial history line")],
    repaintGeneration: 1,
  }));
  await sleep();
  instance.cleanup();

  const output = getOutput();
  assert.equal(countOccurrences(output, "Codexa v"), 2, "the intro should reprint once <Static> remounts");
  assert.equal(countOccurrences(output, "Launch mode"), 2, "prior static events should reprint too, not just the intro");
  assert.match(stripAnsi(output), /LIVE PROMPT/, "the composer should still be present after the reprint");
});

test("repaintGeneration alone (no clearCount change) is enough to force the reprint", async () => {
  const { instance, stdout, getOutput } = renderTranscript([launchEvent()]);
  await sleep();
  assert.equal(countOccurrences(getOutput(), "Codexa v"), 1);

  resetInkOutputForFreshFrame({ instance: resolveInkRenderInstance(stdout), columns: stdout.columns });
  instance.rerender(transcriptNode({ staticEvents: [launchEvent()], clearCount: 0, repaintGeneration: 1 }));
  await sleep();
  instance.cleanup();

  assert.equal(countOccurrences(getOutput(), "Codexa v"), 2, "repaintGeneration must trigger the remount on its own, independent of clearCount");
});

test("fresh launch renders the banner before Launch mode as transcript content", async () => {
  const { instance, getOutput } = renderTranscript([launchEvent()]);
  await sleep();
  instance.cleanup();

  const text = stripAnsi(getOutput());
  assertFullLargeLogoVisible(text);
  assert.match(text, /██████/);
  assert.match(text, /Codexa v/);
  assert.match(text, /Workspace: codexa/);
  assert.match(text, /Provider: Local/);
  assert.ok(text.indexOf("██████") < text.indexOf("Launch mode"));
  assert.equal(countOccurrences(text, "Codexa v"), 1);
  assert.equal(countOccurrences(text, "Launch mode"), 1);
});

test("fresh launch with provider migration keeps one logo, one composer, and one footer", async () => {
  const { instance, getOutput } = renderTranscript(
    [launchEvent(), providerMigrationEvent()],
    {
      prompt: [
        "│ ❯",
        "Local / qwen/qwen3.6-35b-a3b (High)",
        "Context: 115 / 262K",
      ].join("\n"),
    },
  );
  await sleep();
  instance.cleanup();

  const text = stripAnsi(getOutput());
  assertFullLargeLogoVisible(text);
  assert.equal(countOccurrences(text, "Provider migrated"), 1);
  assert.equal(countOccurrences(text, "Launch mode"), 1);
  assert.equal(countOccurrences(text, "│ ❯"), 1, "migration startup must not create a second composer prompt");
  assert.equal(countOccurrences(text, "Context:"), 1, "migration startup must not create a second runtime footer");
  assert.ok(text.indexOf("██████") < text.indexOf("Launch mode"));
  assert.ok(text.indexOf("Launch mode") < text.indexOf("Provider migrated"));
  assert.ok(text.indexOf("Provider migrated") < text.indexOf("│ ❯"));
});

test("fresh launch reserves top space so the large logo is not clipped", async () => {
  const { instance, getOutput } = renderTranscript([launchEvent()]);
  await sleep();
  instance.cleanup();

  const output = getOutput();
  assertFullLargeLogoVisible(output);
  const firstLogoIndex = firstLineIndex(output, LOGO_LARGE[0]!.trim());
  assert.ok(firstLogoIndex > 0, "large logo should not start on the first terminal row");
});

test("first submitted prompt stays in conversation order without reprinting the intro", async () => {
  const { instance, getOutput } = renderTranscript([launchEvent()]);
  await sleep();

  instance.rerender(transcriptNode({
    staticEvents: [launchEvent()],
    activeEvents: [userPromptEvent(10, "hi"), runningRunEvent(10, "hi")],
    uiState: { kind: "THINKING", turnId: 10 },
    prompt: "BOTTOM COMPOSER AFTER SUBMIT",
  }));
  await sleep();
  instance.cleanup();

  const text = stripAnsi(getOutput());
  assertFullLargeLogoVisible(text);
  assert.equal(countOccurrences(text, "Codexa v"), 1);
  assert.equal(countOccurrences(text, "Launch mode"), 1);
  assert.ok(text.indexOf("Launch mode") < text.lastIndexOf("PROMPT"));
  assert.ok(text.lastIndexOf("PROMPT") < text.lastIndexOf("hi"));
  assert.ok(text.lastIndexOf("hi") < text.lastIndexOf("BOTTOM COMPOSER AFTER SUBMIT"));
});

test("does not clear the terminal or slice history to the current viewport height", async () => {
  const manyEvents = [launchEvent(90), ...Array.from({ length: 30 }, (_, index) => systemEvent(index + 100, `history line ${index}`))];
  const { instance, getOutput } = renderTranscript(manyEvents);
  await sleep();
  instance.cleanup();

  const output = getOutput();
  const text = stripAnsi(output);
  assert.doesNotMatch(output, /\u001b\[2J|\u001b\[3J|\u001bc/);
  assert.match(text, /history line 0/);
  assert.match(text, /history line 29/);
  assert.ok(
    text.lastIndexOf("LIVE PROMPT") > text.lastIndexOf("history line 29"),
    "composer prompt should render after transcript history at the live bottom",
  );
});

test("hides transcript input during overlay mode without reprinting the intro on return", async () => {
  const initialEvents = [launchEvent(199), systemEvent(200, "visible history")];
  const hiddenEvents = [...initialEvents, systemEvent(201, "queued while overlay is visible")];
  const { instance, getOutput } = renderTranscript(initialEvents);
  await sleep();

  instance.rerender(transcriptNode({
    staticEvents: initialEvents,
    visible: false,
    prompt: "HIDDEN PROMPT",
  }));
  await sleep();
  const hiddenOutput = getOutput();
  assert.doesNotMatch(stripAnsi(hiddenOutput), /HIDDEN PROMPT/);

  instance.rerender(transcriptNode({
    staticEvents: hiddenEvents,
    visible: false,
    prompt: "STILL HIDDEN",
  }));
  await sleep();
  assert.doesNotMatch(stripAnsi(getOutput()), /queued while overlay is visible/);

  instance.rerender(transcriptNode({
    staticEvents: hiddenEvents,
    visible: true,
    prompt: "RESTORED PROMPT",
  }));
  await sleep();
  instance.cleanup();

  const output = getOutput();
  assert.equal(countOccurrences(output, "Codexa v"), 1);
  assert.match(stripAnsi(output), /queued while overlay is visible/);
  assert.match(stripAnsi(output), /RESTORED PROMPT/);
});

test("clear rerender shows fresh banner and launch text once without stale messages", async () => {
  const beforeClearEvents = [
    launchEvent(300),
    systemEvent(301, "old message before clear"),
  ];
  const afterClearEvents = [launchEvent(400)];
  const { instance, getOutput } = renderTranscript(beforeClearEvents);
  await sleep();
  const beforeClearLength = getOutput().length;

  instance.rerender(transcriptNode({
    staticEvents: afterClearEvents,
    clearCount: 1,
    prompt: "PROMPT AFTER CLEAR\nLocal / qwen/qwen3.6-35b-a3b (High)\nContext: 115 / 262K",
  }));
  await sleep();
  instance.cleanup();

  const postClearOutput = stripAnsi(getOutput().slice(beforeClearLength));
  assertFullLargeLogoVisible(postClearOutput);
  assert.match(postClearOutput, /██████/);
  assert.match(postClearOutput, /Launch mode/);
  assert.match(postClearOutput, /PROMPT AFTER CLEAR/);
  assert.match(postClearOutput, /Local \/ qwen\/qwen3\.6-35b-a3b \(High\)/);
  assert.match(postClearOutput, /Context: 115 \/ 262K/);
  assert.equal(countOccurrences(postClearOutput, "Codexa v"), 1);
  assert.equal(countOccurrences(postClearOutput, "Launch mode"), 1);
  assert.doesNotMatch(postClearOutput, /old message before clear/);
});

const CLEAR_HOME_SCREEN_CASES: Array<{
  cols: number;
  rows: number;
  expectedTier: "large" | "compact" | "wordmark";
}> = [
  { cols: 140, rows: 40, expectedTier: "large" },
  { cols: 120, rows: 32, expectedTier: "large" },
  { cols: 100, rows: 28, expectedTier: "large" },
  { cols: 80, rows: 24, expectedTier: "large" },
  { cols: 70, rows: 20, expectedTier: "compact" },
  { cols: 60, rows: 18, expectedTier: "compact" },
];

for (const testCase of CLEAR_HOME_SCREEN_CASES) {
  test(`fresh startup and /clear render the same branded home screen at ${testCase.cols}x${testCase.rows}`, async () => {
    const prompt = [
      "│ ❯ Ask Codexa, run !shell, or use /command",
      "OpenAI Codex CLI / gpt-5.4-mini (Low)",
      "Context: 0 / 1M",
    ].join("\n");
    const startupEvents = [launchEvent(500), providerMigrationEvent(501)];
    const { instance, getOutput } = renderTranscript(startupEvents, {
      cols: testCase.cols,
      rows: testCase.rows,
      prompt,
    });
    await sleep();

    const freshOutput = stripAnsi(getOutput());
    assertHomeScreenFrame(freshOutput, testCase, testCase.expectedTier);
    assert.equal(countOccurrences(freshOutput, "Provider migrated"), 1);
    assert.equal(countOccurrences(freshOutput, "Launch mode"), 1);

    const clearOutputOffset = getOutput().length;
    instance.rerender(transcriptNode({
      staticEvents: [launchEvent(600), providerMigrationEvent(601)],
      clearCount: 1,
      prompt,
      cols: testCase.cols,
      rows: testCase.rows,
    }));
    await sleep();
    instance.cleanup();

    const postClearOutput = stripAnsi(getOutput().slice(clearOutputOffset));
    assertHomeScreenFrame(postClearOutput, testCase, testCase.expectedTier);
    assert.equal(countOccurrences(postClearOutput, "Provider migrated"), 1);
    assert.equal(countOccurrences(postClearOutput, "Launch mode"), 1);
    assert.doesNotMatch(postClearOutput, /old message before clear/);
    assert.equal(
      detectBrandTier(postClearOutput),
      detectBrandTier(freshOutput),
      `${testCase.cols}x${testCase.rows} clear should use startup's responsive home layout rules`,
    );
  });
}
