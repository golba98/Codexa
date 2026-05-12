import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { render, Text } from "ink";
import type { TimelineEvent, UIState } from "../session/types.js";
import { buildRuntimeSummary } from "../config/runtimeConfig.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";
import { BottomComposer, measureBottomComposerRows } from "./BottomComposer.js";
import { AppShell, calculateNativeSpacerRows } from "./AppShell.js";
import { createLayoutSnapshot, useTerminalViewport } from "./layout.js";
import { PlanActionPicker, measurePlanActionPickerRows } from "./PlanActionPicker.js";
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

const EVENTS: TimelineEvent[] = [
  { id: 1, type: "system", createdAt: 1, title: "Launch mode", content: "Dev shell attached" },
  { id: 2, type: "user", createdAt: 2, prompt: "Reproduce the resize flicker and fix it.", turnId: 1 },
  {
    id: 3,
    type: "run",
    createdAt: 3,
    startedAt: 3,
    durationMs: 1250,
    backendId: "codex-subprocess",
    backendLabel: "Codexa",
    runtime: TEST_RUNTIME,
    prompt: "Reproduce the resize flicker and fix it.",
    progressEntries: [],
    status: "completed",
    summary: "Completed",
    truncatedOutput: false,
    toolActivities: [],
    activity: [],
    touchedFileCount: 1,
    errorMessage: null,
    turnId: 1,
  },
  {
    id: 4,
    type: "assistant",
    createdAt: 4,
    content: "Root cause looks like a layout gutter mismatch during resize.\n\nThis response is intentionally a bit longer to force wrapping at smaller widths.",
    contentChunks: [],
    turnId: 1,
  },
];

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function compactText(value: string): string {
  return stripAnsi(value).replace(/\s+/g, "");
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderShell(
  layoutCols: number,
  layoutRows: number,
  uiState: UIState,
  screen: "main" | "theme-picker" | "model-picker" = "main",
  panel: React.ReactNode = null,
  mainPanel: React.ReactNode = null,
  mainPanelMode: "viewport" | "full-output" = "viewport",
): Promise<string> {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = layoutCols;
  stdout.rows = layoutRows;
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const layout = createLayoutSnapshot(layoutCols, layoutRows);
  const composerRows = measureBottomComposerRows({
    layout,
    uiState,
    mode: "auto-edit",
    model: "gpt-5.4",
    reasoningLevel: "medium",
    tokensUsed: 1200,
    value: "",
    cursor: 0,
  });

  const instance = render(
    <ThemeProvider theme="purple">
      <AppShell
        layout={layout}
        screen={screen}
        authState="authenticated"
        workspaceLabel={"C:\\Development\\1-JavaScript\\13-Custom CLI"}
        runtimeSummary={buildRuntimeSummary(TEST_RUNTIME)}
        staticEvents={EVENTS}
        activeEvents={[]}
        uiState={uiState}
        panel={panel}
        mainPanel={mainPanel}
        mainPanelMode={mainPanelMode}
        composer={
          <BottomComposer
            layout={layout}
            uiState={uiState}
            mode="auto-edit"
            model="gpt-5.4"
            themeName="purple"
            reasoningLevel="medium"
            tokensUsed={1200}
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
        }
        composerRows={composerRows}
      />
    </ThemeProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  return sleep(100).then(async () => {
    instance.cleanup();
    await sleep(20);
    return stripAnsi(output);
  });
}

function renderStartupShell(
  layoutCols: number,
  layoutRows: number,
  screen: "main" | "model-picker" = "main",
  staticEvents: TimelineEvent[] = [],
  panel: React.ReactNode = null,
): Promise<string> {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = layoutCols;
  stdout.rows = layoutRows;
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const layout = createLayoutSnapshot(layoutCols, layoutRows);
  const uiState: UIState = { kind: "IDLE" };
  const composerRows = measureBottomComposerRows({
    layout,
    uiState,
    mode: "auto-edit",
    model: "gpt-5.4",
    reasoningLevel: "medium",
    tokensUsed: 0,
    value: "",
    cursor: 0,
  });

  const instance = render(
    <ThemeProvider theme="purple">
      <AppShell
        layout={layout}
        screen={screen}
        authState="authenticated"
        workspaceLabel={"C:\\Development\\1-JavaScript\\13-Custom CLI"}
        runtimeSummary={buildRuntimeSummary(TEST_RUNTIME)}
        staticEvents={staticEvents}
        activeEvents={[]}
        uiState={uiState}
        panel={panel}
        mainPanel={null}
        composer={
          <BottomComposer
            layout={layout}
            uiState={uiState}
            mode="auto-edit"
            model="gpt-5.4"
            themeName="purple"
            reasoningLevel="medium"
            tokensUsed={0}
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
        }
        composerRows={composerRows}
      />
    </ThemeProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  return sleep(100).then(async () => {
    instance.cleanup();
    await sleep(20);
    return stripAnsi(output);
  });
}

test("startup uses the large logo only when the viewport height can contain it", async () => {
  const output = await renderStartupShell(120, 30);

  assert.match(output, /██████/);
  assert.match(output, /Codexa v/);
  assert.match(output, /\n╭[─]+╮\n│ ❯/);
});

test("startup uses compact header at normal shorter terminal height", async () => {
  const output = await renderStartupShell(100, 24);

  assert.match(output, /CODEXA/);
  assert.match(output, /Codexa v/);
  assert.match(output, /\n╭[─]+╮\n│ ❯/);
  assert.doesNotMatch(output, /██████/);
});

test("startup tiny mode shows a resize message without the composer", async () => {
  const output = await renderStartupShell(39, 13);

  assert.match(output, /Terminal is too small/);
  assert.doesNotMatch(output, /\n╭[─]+╮\n│ ❯/);
  assert.doesNotMatch(output, /██████/);
});

test("80x24 keeps the last timeline content visible above the composer", async () => {
  const output = await renderShell(80, 24, { kind: "IDLE" });

  assert.match(output, /Launch mode/);
  assert.match(output, /\n╭[─]+╮\n│ ❯/);
  assert.doesNotMatch(output, /◎ Auto  gpt-5\.4 \(medium\)  Ctrl\+O/);
});

test("larger terminals keep the composer metadata row", async () => {
  const output = await renderShell(100, 30, { kind: "IDLE" });

  assert.match(output, /◎ Auto  gpt-5\.4 \(medium\)  Ctrl\+O/);
  assert.match(output, /Launch mode/);
  assert.match(output, /gpt-5\.4/i);
});

test("cramped busy state uses the run footer in app composition", async () => {
  const output = await renderShell(80, 24, { kind: "THINKING", turnId: 1 });

  assert.match(output, /Codexa is thinking/i);
  assert.doesNotMatch(output, /CODEXA\s+\|\s+gpt-5\.4/i);
  assert.doesNotMatch(output, /CODEXA AGENT/);
});

test("cramped streaming state avoids response-labelled footer text", async () => {
  const output = await renderShell(80, 24, { kind: "RESPONDING", turnId: 1 });

  assert.match(output, /Codexa is thinking/i);
  assert.doesNotMatch(output, /Codexa is streaming/i);
  assert.doesNotMatch(output, /Streaming response/i);
});

test("non-main screens center the active panel and keep the composer hidden", async () => {
  const output = await renderShell(
    100,
    30,
    { kind: "IDLE" },
    "theme-picker",
    <Text>Theme panel</Text>,
  );

  assert.match(output, /Theme panel/);
  assert.doesNotMatch(output, /◎ Auto  gpt-5\.4 \(medium\)  Ctrl\+O/);
});

test("non-main panel content updates while the active screen is unchanged", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const layout = createLayoutSnapshot(100, 30);
  const instance = render(
    <ThemeProvider theme="purple">
      <AppShell
        layout={layout}
        screen="model-picker"
        authState="authenticated"
        workspaceLabel={"C:\\Development\\1-JavaScript\\13-Custom CLI"}
        runtimeSummary={buildRuntimeSummary(TEST_RUNTIME)}
        staticEvents={EVENTS}
        activeEvents={[]}
        uiState={{ kind: "IDLE" }}
        panel={<Text>Loading model list</Text>}
        mainPanel={null}
        composer={null}
        composerRows={0}
      />
    </ThemeProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  try {
    await sleep(80);
    instance.rerender(
      <ThemeProvider theme="purple">
        <AppShell
          layout={layout}
          screen="model-picker"
          authState="authenticated"
          workspaceLabel={"C:\\Development\\1-JavaScript\\13-Custom CLI"}
          runtimeSummary={buildRuntimeSummary(TEST_RUNTIME)}
          staticEvents={EVENTS}
          activeEvents={[]}
          uiState={{ kind: "IDLE" }}
          panel={<Text>Interactive model list</Text>}
          mainPanel={null}
          composer={null}
          composerRows={0}
        />
      </ThemeProvider>,
    );
    await sleep(80);

    const frame = stripAnsi(output);
    assert.match(frame, /Loading model list/);
    assert.match(frame, /Interactive model list/);
  } finally {
    instance.cleanup();
    await sleep(20);
  }
});

test("model picker renders as a compact command panel without composer", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 120;
  stdout.rows = 30;
  let raw = "";
  stdout.on("data", (chunk) => { raw += chunk.toString(); });
  const layout = createLayoutSnapshot(120, 30);

  const instance = render(
    <ThemeProvider theme="purple">
      <AppShell
        layout={layout}
        screen="model-picker"
        authState="authenticated"
        workspaceLabel={"C:\\Development\\1-JavaScript\\13-Custom CLI"}
        runtimeSummary={buildRuntimeSummary(TEST_RUNTIME)}
        staticEvents={EVENTS}
        activeEvents={[]}
        uiState={{ kind: "IDLE" }}
        panel={<Text>Select model command panel</Text>}
        mainPanel={null}
        composer={buildComposerNode(layout, { kind: "IDLE" })}
        composerRows={measureBottomComposerRows({
          layout,
          uiState: { kind: "IDLE" },
          value: "",
          cursor: 0,
        })}
      />
    </ThemeProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  await sleep(100);
  instance.cleanup();
  await sleep(20);

  const output = stripAnsi(raw);
  assert.match(output, /Select model command panel/);
  assert.match(output, /Codexa v/);
  assert.doesNotMatch(output, /◎ Auto  gpt-5\.4 \(medium\)  Ctrl\+O/);
});

test("native spacer subtracts persistent transcript rows before anchoring the composer", () => {
  const spacerRows = calculateNativeSpacerRows({
    shellRows: 30,
    introRows: 10,
    composerRows: 5,
    staticRows: 4,
    liveRows: 2,
  });

  assert.equal(spacerRows, 9);
  assert.equal(10 + 4 + 2 + spacerRows + 5, 30);
});

test("native spacer clamps when model update events fill the body", () => {
  const spacerRows = calculateNativeSpacerRows({
    shellRows: 24,
    introRows: 9,
    composerRows: 5,
    staticRows: 12,
    liveRows: 0,
  });

  assert.equal(spacerRows, 0);
});

test("main screen keeps the transcript visible while showing the plan action picker", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const layout = createLayoutSnapshot(100, 30);
  const instance = render(
    <ThemeProvider theme="purple">
      <AppShell
        layout={layout}
        screen="main"
        authState="authenticated"
        workspaceLabel={"C:\\Development\\1-JavaScript\\13-Custom CLI"}
        runtimeSummary={buildRuntimeSummary(TEST_RUNTIME)}
        staticEvents={EVENTS}
        activeEvents={[]}
        uiState={{ kind: "IDLE" }}
        panel={null}
        mainPanel={null}
        composer={<PlanActionPicker onSelect={() => {}} onCancel={() => {}} />}
        composerRows={measurePlanActionPickerRows()}
      />
    </ThemeProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  await sleep(100);
  const frame = compactText(output);
  instance.cleanup();
  await sleep(20);

  // Assert transcript content is visible
  assert.match(frame, /Reproducetheresizeflickerandfixit\./);
  assert.match(frame, /Rootcauselookslikealayoutguttermismatchduringresize\./);
  // Assert action picker is visible
  assert.match(frame, /Planready/);
  assert.match(frame, /\[I\]Implementchanges/);
  assert.match(frame, /\[U\]Updateplan/);
  assert.doesNotMatch(frame, /╭──Planready/);
  assert.doesNotMatch(frame, /Requestchanges/);
  assert.doesNotMatch(frame, /Addconstraints/);
});



test("memoized composer re-renders when only the terminal height changes", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const renderComposer = (rows: number) => (
    <ThemeProvider theme="purple">
      <BottomComposer
        layout={createLayoutSnapshot(100, rows)}
        uiState={{ kind: "IDLE" }}
        mode="auto-edit"
        model="gpt-5.4"
        reasoningLevel="medium"
        tokensUsed={1200}
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
    </ThemeProvider>
  );

  const instance = render(renderComposer(30), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(80);
  let frame = stripAnsi(output);
  assert.match(frame, /◎ Auto  gpt-5\.4 \(medium\)  Ctrl\+O/);

  output = "";
  instance.rerender(renderComposer(24));
  await sleep(80);
  frame = stripAnsi(output);
  assert.doesNotMatch(frame, /◎ Auto  gpt-5\.4 \(medium\)  Ctrl\+O/);

  instance.cleanup();
  await sleep(20);
});

function ViewportProbe() {
  const viewport = useTerminalViewport();

  return (
    <Text>
      {`stable:${viewport.cols}x${viewport.rows} raw:${viewport.rawCols ?? 0}x${viewport.rawRows ?? 0} unstable:${viewport.unstable} epoch:${viewport.layoutEpoch}`}
    </Text>
  );
}

test("terminal viewport ignores invalid restore sizes and bumps layout epoch on recovery", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const instance = render(
    <ThemeProvider theme="purple">
      <ViewportProbe />
    </ThemeProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  await sleep(80);
  let frame = compactText(output);
  assert.match(frame, /stable:120x40raw:120x40unstable:falseepoch:0/);

  output = "";
  stdout.columns = 1;
  stdout.rows = 1;
  stdout.emit("resize");
  await sleep(30);
  frame = compactText(output);
  assert.match(frame, /stable:120x40raw:1x1unstable:trueepoch:0/);

  output = "";
  stdout.columns = 120;
  stdout.rows = 40;
  stdout.emit("resize");
  await sleep(140);
  frame = compactText(output);
  assert.match(frame, /stable:120x40raw:120x40unstable:falseepoch:1/);

  instance.cleanup();
  await sleep(20);
});

// ---------------------------------------------------------------------------
// Logo / intro duplication tests
//
// These tests use debug:false (real Ink cursor-control mode) so that Ink's
// <Static> commitment semantics are exercised correctly.  In debug:true each
// full frame is flushed to stdout, making logo-count comparisons meaningless.
// In real mode, <Static> items are written once; subsequent renders only
// update the live portion below the static area.  After stripping ANSI the
// cumulative stdout therefore contains the logo exactly once if — and only if
// — the logo was never re-emitted as a fresh <Static> commit.
// ---------------------------------------------------------------------------

function buildComposerNode(layout: ReturnType<typeof createLayoutSnapshot>, uiState: UIState) {
  return (
    <BottomComposer
      layout={layout}
      uiState={uiState}
      mode="auto-edit"
      model="gpt-5.4"
      themeName="purple"
      reasoningLevel="medium"
      tokensUsed={0}
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
  );
}

function buildShellNode(
  layout: ReturnType<typeof createLayoutSnapshot>,
  staticEvents: TimelineEvent[],
  options: {
    screen?: "main" | "model-picker" | "theme-picker";
    authState?: "authenticated" | "checking" | "unauthenticated";
    workspaceLabel?: string;
    clearCount?: number;
  } = {},
) {
  const { screen = "main", authState = "authenticated", workspaceLabel = "C:\\Test", clearCount = 0 } = options;
  const uiState: UIState = { kind: "IDLE" };
  const composerRows = measureBottomComposerRows({
    layout,
    uiState,
    mode: "auto-edit",
    model: "gpt-5.4",
    reasoningLevel: "medium",
    tokensUsed: 0,
    value: "",
    cursor: 0,
  });
  return (
    <ThemeProvider theme="purple">
      <AppShell
        key={`app-shell-${clearCount}`}
        layout={layout}
        screen={screen}
        authState={authState}
        workspaceLabel={workspaceLabel}
        staticEvents={staticEvents}
        activeEvents={[]}
        uiState={uiState}
        panel={null}
        mainPanel={null}
        composer={buildComposerNode(layout, uiState)}
        composerRows={composerRows}
        clearCount={clearCount}
      />
    </ThemeProvider>
  );
}

function countLogoInOutput(raw: string): number {
  // Count occurrences of a distinctive second line of the ASCII logo.
  // This line appears exactly once per physical logo render in real-mode output.
  return (stripAnsi(raw).match(/██╔════╝██╔═══██╗/g) ?? []).length;
}

test("intro logo is not duplicated when transitioning from startup frame to first prompt", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  // Use a tall terminal so the large ASCII logo is chosen.
  stdout.columns = 120;
  stdout.rows = 40;
  let raw = "";
  stdout.on("data", (chunk) => { raw += chunk.toString(); });

  const layout = createLayoutSnapshot(120, 40);

  const instance = render(buildShellNode(layout, []), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(100);

  // Simulate first prompt completing — transitions from startup frame to transcript.
  instance.rerender(buildShellNode(layout, EVENTS));
  await sleep(100);

  instance.cleanup();
  await sleep(20);

  assert.equal(
    countLogoInOutput(raw),
    1,
    "intro logo must appear exactly once after startup→prompt transition",
  );
});

test("post-clear empty native frame re-emits the intro and empty composer", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 120;
  stdout.rows = 40;
  let raw = "";
  stdout.on("data", (chunk) => { raw += chunk.toString(); });

  const layout = createLayoutSnapshot(120, 40);

  const instance = render(buildShellNode(layout, [], { clearCount: 1 }), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(100);
  instance.cleanup();
  await sleep(20);

  const output = stripAnsi(raw);
  assert.equal(countLogoInOutput(raw), 1, "post-clear frame should repaint the intro once");
  assert.match(output, /Codexa v/);
  assert.match(output, /\n╭[─]+╮\n│ ❯/);
  assert.doesNotMatch(output, /Reproduce the resize flicker and fix it\./);
});

test("clear transition physically reprints the intro after previous transcript output", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 120;
  stdout.rows = 40;
  let raw = "";
  stdout.on("data", (chunk) => { raw += chunk.toString(); });

  const layout = createLayoutSnapshot(120, 40);

  const instance = render(buildShellNode(layout, EVENTS, { clearCount: 0 }), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(100);
  const clearOutputOffset = raw.length;

  instance.rerender(buildShellNode(layout, [], { clearCount: 1 }));
  await sleep(100);
  instance.cleanup();
  await sleep(20);

  const postClearOutput = stripAnsi(raw.slice(clearOutputOffset));
  assert.match(postClearOutput, /Codexa v/);
  assert.match(postClearOutput, /\n╭[─]+╮\n│ ❯/);
  assert.doesNotMatch(postClearOutput, /Reproduce the resize flicker and fix it\./);
  assert.doesNotMatch(postClearOutput, /Root cause looks like a layout gutter mismatch/);
});

test("intro logo is not duplicated when panel opens and then closes", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 120;
  stdout.rows = 40;
  let raw = "";
  stdout.on("data", (chunk) => { raw += chunk.toString(); });

  const layout = createLayoutSnapshot(120, 40);

  // Start on main screen with events already committed.
  const instance = render(buildShellNode(layout, EVENTS), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(100);

  // Open model picker panel.
  instance.rerender(buildShellNode(layout, EVENTS, { screen: "model-picker" }));
  await sleep(80);

  // Close panel — return to main screen.
  instance.rerender(buildShellNode(layout, EVENTS));
  await sleep(80);

  instance.cleanup();
  await sleep(20);

  assert.equal(
    countLogoInOutput(raw),
    1,
    "intro logo must appear exactly once after panel open→close transition",
  );
});

test("intro logo is not duplicated after a terminal resize on the startup frame", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 120;
  stdout.rows = 40;
  let raw = "";
  stdout.on("data", (chunk) => { raw += chunk.toString(); });

  const layout = createLayoutSnapshot(120, 40);

  const instance = render(buildShellNode(layout, []), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(100);

  // Simulate a resize (terminal width change).
  stdout.columns = 140;
  stdout.rows = 45;
  stdout.emit("resize");
  instance.rerender(buildShellNode(createLayoutSnapshot(140, 45), []));
  await sleep(100);

  instance.cleanup();
  await sleep(20);

  assert.equal(
    countLogoInOutput(raw),
    1,
    "intro logo must appear exactly once after a resize on the startup frame",
  );
});

test("intro logo is not duplicated when auth state updates during startup", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 120;
  stdout.rows = 40;
  let raw = "";
  stdout.on("data", (chunk) => { raw += chunk.toString(); });

  const layout = createLayoutSnapshot(120, 40);

  // Start with auth in "checking" state (before auth resolves).
  const instance = render(buildShellNode(layout, [], { authState: "checking" }), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(100);

  // Auth resolves — update to "authenticated".
  instance.rerender(buildShellNode(layout, [], { authState: "authenticated" }));
  await sleep(100);

  instance.cleanup();
  await sleep(20);

  assert.equal(
    countLogoInOutput(raw),
    1,
    "intro logo must appear exactly once after auth state transitions during startup",
  );
});

test("cold-start stability: opening and closing model picker does not expand UI", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  // Use a tall terminal so the large ASCII logo is chosen.
  stdout.columns = 120;
  stdout.rows = 40;
  let raw = "";
  stdout.on("data", (chunk) => { raw += chunk.toString(); });

  const layout = createLayoutSnapshot(120, 40);

  // 1. Startup frame
  const instance = render(buildShellNode(layout, []), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await sleep(100);

  // 2. Open model picker
  instance.rerender(buildShellNode(layout, [], { screen: "model-picker" }));
  await sleep(100);

  // 3. Close model picker
  instance.rerender(buildShellNode(layout, []));
  await sleep(100);

  instance.cleanup();
  await sleep(20);

  assert.equal(countLogoInOutput(raw), 1, "Logo should appear exactly once");

  // Verify the layout didn't expand to fill the full 40 rows.
  // In real mode, cumulative lines should be low.
  const lines = stripAnsi(raw).split("\n").filter(l => l.trim().length > 0);
  assert.ok(lines.length < 25, "Output should remain bounded on cold start");
});

test("cold-start stability: system events do not break the startup frame", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 120;
  stdout.rows = 40;
  let raw = "";
  stdout.on("data", (chunk) => { raw += chunk.toString(); });

  const layout = createLayoutSnapshot(120, 40);
  const systemEvent: TimelineEvent = { 
    id: 100, 
    type: "system", 
    title: "Model updated", 
    content: "Switching to gpt-4",
    createdAt: Date.now() 
  };

  const instance = render(buildShellNode(layout, [systemEvent]), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(100);
  instance.cleanup();
  await sleep(20);

  const output = stripAnsi(raw);
  // Large logo should still render because there is no user prompt yet.
  assert.match(output, /██████/);
  assert.match(output, /Model updated/);

  const lines = output.split("\n").filter(l => l.trim().length > 0);
  assert.ok(lines.length < 25, "Output should remain capped even with system events");
});

test("cold-start stability: panel height is bounded on cold start", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 120;
  stdout.rows = 40;
  let raw = "";
  stdout.on("data", (chunk) => { raw += chunk.toString(); });

  const layout = createLayoutSnapshot(120, 40);

  const instance = render(
    <ThemeProvider theme="purple">
      <AppShell
        layout={layout}
        screen="model-picker"
        authState="authenticated"
        workspaceLabel="C:\Test"
        staticEvents={[]}
        activeEvents={[]}
        uiState={{ kind: "IDLE" }}
        panel={<Text>Transient Picker</Text>}
        mainPanel={null}
        composer={null}
        composerRows={0}
      />
    </ThemeProvider>,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      debug: false,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  await sleep(100);
  instance.cleanup();
  await sleep(20);

  const output = stripAnsi(raw);
  assert.match(output, /Transient Picker/);

  // Count actual lines in output.
  // If height was nativePanelBodyRows (around 25+), we'd have many trailing newlines or spaces.
  const lines = output.split("\n");
  assert.ok(lines.length < 25, "Panel height should be bounded on cold start");
});
