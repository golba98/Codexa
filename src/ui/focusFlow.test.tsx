import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { Box, Text, render, useFocus, useFocusManager } from "ink";
import { normalizeReasoningForModel, type AvailableModel, type ReasoningLevel } from "../config/settings.js";
import { createMouseInputFilter } from "../core/terminalMouse.js";
import type { UIState } from "../session/types.js";
import { BottomComposer } from "./BottomComposer.js";
import { getFocusTargetForScreen } from "./focus.js";
import { ModelPicker } from "./ModelPicker.js";
import { createLayoutSnapshot } from "./layout.js";
import { ThemeProvider } from "./theme.js";
import { shouldBumpComposerInstance } from "./themeFlow.js";

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

const TEST_LAYOUT = createLayoutSnapshot(120, 40);

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLastComposerValue(output: string): string | null {
  const lines = output.match(/value:[^\n]*/g) ?? [];
  const lastLine = lines[lines.length - 1];
  if (!lastLine) return null;

  try {
    return JSON.parse(lastLine.slice("value:".length)) as string;
  } catch {
    return null;
  }
}

function createInkHarness(node: React.ReactElement) {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  const originalEmit = stdin.emit.bind(stdin);
  const mouseFilter = createMouseInputFilter();
  let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const flushPending = () => {
    if (pendingFlushTimer) {
      clearTimeout(pendingFlushTimer);
      pendingFlushTimer = null;
    }
    const flushed = mouseFilter.flushPending();
    if (flushed) {
      originalEmit("data", Buffer.from(flushed, "utf8"));
    }
  };

  stdin.emit = function (event: string | symbol, ...args: any[]) {
    if (event === "data" && args[0]) {
      if (pendingFlushTimer) {
        clearTimeout(pendingFlushTimer);
        pendingFlushTimer = null;
      }

      const raw = Buffer.isBuffer(args[0]) ? args[0].toString("utf8") : String(args[0]);
      const filtered = mouseFilter.filterChunk(raw);

      for (const mouseEvent of filtered.events) {
        originalEmit(mouseEvent === "scroll-up" ? "codexa-scroll-up" : "codexa-scroll-down");
      }

      if (filtered.hasPending) {
        pendingFlushTimer = setTimeout(() => {
          pendingFlushTimer = null;
          const flushed = mouseFilter.flushPending();
          if (flushed) {
            originalEmit("data", Buffer.from(flushed, "utf8"));
          }
        }, 0);
      }

      if (filtered.output !== raw) {
        if (filtered.output.length === 0) return false;
        args[0] = Buffer.from(filtered.output, "utf8");
      }
    }

    return originalEmit(event, ...args);
  };

  const instance = render(node, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  return {
    stdin,
    stdout,
    instance,
    getOutput(): string {
      return stripAnsi(output);
    },
    async cleanup() {
      flushPending();
      instance.cleanup();
      await sleep(20);
    },
  };
}

function FocusProbe({ id, label }: { id: string; label: string }) {
  const { isFocused } = useFocus({ id, autoFocus: true });
  return <Text>{label}:{isFocused ? "focused" : "blurred"}</Text>;
}

function FocusRoutingHarness({ screen }: { screen: "main" | "model-picker" }) {
  const focusManager = useFocusManager();

  React.useEffect(() => {
    focusManager.focus(getFocusTargetForScreen(screen));
  }, [focusManager, screen]);

  return (
    <Box flexDirection="column">
      {screen === "main" && <FocusProbe id="composer" label="composer" />}
      {screen === "model-picker" && <FocusProbe id="model-picker" label="model" />}
    </Box>
  );
}

function ModelPickerComposerHarness() {
  const focusManager = useFocusManager();
  const [screen, setScreen] = React.useState<"main" | "model-picker">("model-picker");
  const [model, setModel] = React.useState<AvailableModel>("gpt-5.4");
  const [reasoningLevel, setReasoningLevel] = React.useState<ReasoningLevel>("high");
  const [value, setValue] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const [composerInstanceKey, setComposerInstanceKey] = React.useState(0);
  const previousScreenRef = React.useRef<"main" | "model-picker">("model-picker");

  React.useEffect(() => {
    const previousScreen = previousScreenRef.current;
    if (shouldBumpComposerInstance(previousScreen, screen)) {
      setComposerInstanceKey((currentKey) => currentKey + 1);
    }
    previousScreenRef.current = screen;
  }, [screen]);

  React.useEffect(() => {
    focusManager.focus(getFocusTargetForScreen(screen));
  }, [composerInstanceKey, focusManager, screen]);

  return (
    <ThemeProvider theme="purple">
      {screen === "model-picker" ? (
        <ModelPicker
          currentModel={model}
          onSelect={(nextModel) => {
            const resolvedModel = nextModel as AvailableModel;
            setModel(resolvedModel);
            setReasoningLevel((currentReasoning) =>
              normalizeReasoningForModel(resolvedModel, currentReasoning),
            );
            setScreen("main");
          }}
          onCancel={() => setScreen("main")}
        />
      ) : (
        <BottomComposer
          key={composerInstanceKey}
          layout={TEST_LAYOUT}
          uiState={{ kind: "IDLE" }}
          value={value}
          cursor={cursor}
          onChangeInput={(nextValue, nextCursor) => {
            setValue(nextValue);
            setCursor(nextCursor);
          }}
          onSubmit={() => {}}
          onCancel={() => {}}
          onHistoryUp={() => {}}
          onHistoryDown={() => {}}
          onTranscriptUp={() => {}}
          onTranscriptDown={() => {}}
          onQuit={() => {}}
        />
      )}
    </ThemeProvider>
  );
}

function PasteComposerHarness() {
  const [value, setValue] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const [submitCount, setSubmitCount] = React.useState(0);

  return (
    <ThemeProvider theme="purple">
      <Box flexDirection="column">
        <BottomComposer
          layout={TEST_LAYOUT}
          uiState={{ kind: "IDLE" }}
          value={value}
          cursor={cursor}
          onChangeInput={(nextValue, nextCursor) => {
            setValue(nextValue);
            setCursor(nextCursor);
          }}
          onSubmit={() => {
            setSubmitCount((count) => count + 1);
          }}
          onCancel={() => {}}
          onHistoryUp={() => {}}
          onHistoryDown={() => {}}
          onTranscriptUp={() => {}}
          onTranscriptDown={() => {}}
          onQuit={() => {}}
        />
        <Text>{`submit:${submitCount}`}</Text>
        <Text>{`value:${JSON.stringify(value)}`}</Text>
      </Box>
    </ThemeProvider>
  );
}

function CompletionComposerHarness() {
  const focusManager = useFocusManager();
  const [value, setValue] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const [inputEpoch, setInputEpoch] = React.useState(0);
  const [uiState, setUiState] = React.useState<UIState>({ kind: "THINKING", turnId: 1 });

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setUiState({ kind: "IDLE" });
      setInputEpoch(1);
    }, 80);

    return () => clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    focusManager.focus("composer");
  }, [focusManager, inputEpoch]);

  return (
    <ThemeProvider theme="purple">
      <Box flexDirection="column">
        <BottomComposer
          key={`completion-${inputEpoch}`}
          layout={TEST_LAYOUT}
          uiState={uiState}
          inputEpoch={inputEpoch}
          value={value}
          cursor={cursor}
          onChangeInput={(nextValue, nextCursor) => {
            setValue(nextValue);
            setCursor(nextCursor);
          }}
          onSubmit={() => {}}
          onCancel={() => {}}
          onHistoryUp={() => {}}
          onHistoryDown={() => {}}
          onTranscriptUp={() => {}}
          onTranscriptDown={() => {}}
          onQuit={() => {}}
        />
        <Text>{`value:${JSON.stringify(value)}`}</Text>
      </Box>
    </ThemeProvider>
  );
}

test("focus manager targets the active panel and returns to the composer", async () => {
  const harness = createInkHarness(<FocusRoutingHarness screen="model-picker" />);

  try {
    await sleep();
    harness.instance.rerender(<FocusRoutingHarness screen="main" />);
    await sleep();

    const output = harness.getOutput();
    assert.match(output, /model:focused/);
    assert.ok(output.trim().endsWith("composer:focused"));
  } finally {
    await harness.cleanup();
  }
});

test("model picker hands focus back to the composer so typing works immediately", async () => {
  const harness = createInkHarness(<ModelPickerComposerHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b[B");
    await sleep();
    harness.stdin.write("\r");
    await sleep(80);
    harness.stdin.write("x");
    await sleep(20);
    harness.stdin.write("y");
    await sleep(20);
    harness.stdin.write("z");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /gpt-5\.4-mini/);
    assert.match(output, /❯ xyz/);
  } finally {
    await harness.cleanup();
  }
});

test("typing works immediately after a run completes and the composer remounts", async () => {
  const harness = createInkHarness(<CompletionComposerHarness />);

  try {
    await sleep(160);
    harness.stdin.write("o");
    await sleep(20);
    harness.stdin.write("k");
    await sleep(80);

    const output = harness.getOutput();
    assert.equal(getLastComposerValue(output), "ok");
    assert.match(output, /❯ ok/);
  } finally {
    await harness.cleanup();
  }
});

test("bracketed multi-line paste stays in the composer and preserves layout", async () => {
  const harness = createInkHarness(<PasteComposerHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b[200~alpha\nbeta\u001b[201~");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /submit:0/);
    assert.match(output, /value:"alpha\\nbeta"/);
    assert.match(output, /alpha/);
    assert.match(output, /beta/);
  } finally {
    await harness.cleanup();
  }
});

test("ctrl+j inserts a newline without submitting the composer", async () => {
  const harness = createInkHarness(<PasteComposerHarness />);

  try {
    await sleep();
    harness.stdin.write("a");
    await sleep(20);
    harness.stdin.write("\n");
    await sleep(20);
    harness.stdin.write("b");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /submit:0/);
    assert.match(output, /value:"a\\nb"/);
    assert.match(output, /a/);
    assert.match(output, /b/);
  } finally {
    await harness.cleanup();
  }
});

test("treats raw DEL (\\u007f) as backspace in the composer", async () => {
  const harness = createInkHarness(<PasteComposerHarness />);

  try {
    await sleep();
    harness.stdin.write("H");
    await sleep(20);
    harness.stdin.write("=");
    await sleep(20);
    harness.stdin.write("\u007f");
    await sleep(80);

    const output = harness.getOutput();
    assert.equal(getLastComposerValue(output), "H");
  } finally {
    await harness.cleanup();
  }
});

test("keeps ANSI delete (ESC[3~) as forward delete behavior", async () => {
  const harness = createInkHarness(<PasteComposerHarness />);

  try {
    await sleep();
    harness.stdin.write("a");
    await sleep(20);
    harness.stdin.write("b");
    await sleep(20);
    harness.stdin.write("\u001b[D");
    await sleep(20);
    harness.stdin.write("\u001b[3~");
    await sleep(80);

    const output = harness.getOutput();
    assert.equal(getLastComposerValue(output), "a");
  } finally {
    await harness.cleanup();
  }
});

test("ignores split mouse click packets instead of leaking them into the composer", async () => {
  const harness = createInkHarness(<PasteComposerHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b");
    await sleep(5);
    harness.stdin.write("[<0;35;26M");
    await sleep(5);
    harness.stdin.write("\u001b");
    await sleep(5);
    harness.stdin.write("[<0;35;26m");
    await sleep(80);

    const output = harness.getOutput();
    assert.equal(getLastComposerValue(output), "");
    assert.doesNotMatch(output, /\[<0;35;26[mM]/);
    assert.match(output, /submit:0/);
  } finally {
    await harness.cleanup();
  }
});
