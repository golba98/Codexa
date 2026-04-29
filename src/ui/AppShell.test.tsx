import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { render, Text } from "ink";
import type { TimelineEvent, UIState } from "../session/types.js";
import { buildRuntimeSummary } from "../config/runtimeConfig.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";
import { BottomComposer, measureBottomComposerRows } from "./BottomComposer.js";
import { AppShell } from "./AppShell.js";
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
  screen: "main" | "theme-picker" = "main",
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

  assert.match(output, /Codex is thinking/i);
  assert.doesNotMatch(output, /CODEXA\s+\|\s+gpt-5\.4/i);
  assert.doesNotMatch(output, /CODEXA AGENT/);
});

test("cramped streaming state avoids response-labelled footer text", async () => {
  const output = await renderShell(80, 24, { kind: "RESPONDING", turnId: 1 });

  assert.match(output, /Codex is thinking/i);
  assert.doesNotMatch(output, /Codex is streaming/i);
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
  const frame = stripAnsi(output);
  instance.cleanup();
  await sleep(20);

  assert.match(frame, /Review plan/);
  assert.match(frame, /Reproduce the resize flicker and fix it\./);
  assert.match(frame, /Implement plan/);
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
