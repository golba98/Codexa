import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { Box, Text, render, useFocus, useFocusManager } from "ink";
import { normalizeReasoningForModel, type AvailableModel, type ReasoningLevel } from "../config/settings.js";
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

function createInkHarness(node: React.ReactElement) {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

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
          onChangeValue={setValue}
          onChangeCursor={setCursor}
          onHistoryUp={() => {}}
          onHistoryDown={() => {}}
          onOpenBackendPicker={() => {}}
          onOpenModelPicker={() => {}}
          onOpenModePicker={() => {}}
          onOpenThemePicker={() => {}}
          onOpenAuthPanel={() => {}}
          onClear={() => {}}
          onCycleMode={() => {}}
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
          onChangeValue={setValue}
          onChangeCursor={setCursor}
          onHistoryUp={() => {}}
          onHistoryDown={() => {}}
          onOpenBackendPicker={() => {}}
          onOpenModelPicker={() => {}}
          onOpenModePicker={() => {}}
          onOpenThemePicker={() => {}}
          onOpenAuthPanel={() => {}}
          onClear={() => {}}
          onCycleMode={() => {}}
          onQuit={() => {}}
        />
        <Text>{`submit:${submitCount}`}</Text>
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
