import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { Box, Text, render, useFocus, useFocusManager, useInput } from "ink";
import { normalizeReasoningForModel, type AvailableModel, type ReasoningLevel } from "../config/settings.js";
import { BottomComposer } from "./BottomComposer.js";
import { getFocusTargetForScreen } from "./focus.js";
import { ModelPicker } from "./ModelPicker.js";
import { PlanActionPicker } from "./PlanActionPicker.js";
import { createLayoutSnapshot } from "./layout.js";
import { TextEntryPanel } from "./TextEntryPanel.js";
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

function FocusRoutingHarness({ screen }: { screen: "main" | "model-picker" | "permissions-panel" | "settings-panel" }) {
  const focusManager = useFocusManager();

  React.useEffect(() => {
    focusManager.focus(getFocusTargetForScreen(screen));
  }, [focusManager, screen]);

  return (
    <Box flexDirection="column">
      {screen === "main" && <FocusProbe id="composer" label="composer" />}
      {screen === "model-picker" && <FocusProbe id="model-picker" label="model" />}
      {screen === "permissions-panel" && <FocusProbe id="permissions-panel" label="permissions" />}
      {screen === "settings-panel" && <FocusProbe id="settings-panel" label="settings" />}
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
          onTogglePlanMode={() => {}}
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
          onTogglePlanMode={() => {}}
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

function PlanToggleComposerHarness() {
  const [planMode, setPlanMode] = React.useState(false);
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
          planMode={planMode}
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
          onTogglePlanMode={() => setPlanMode((current) => !current)}
          onClear={() => {}}
          onCycleMode={() => {}}
          onQuit={() => {}}
        />
        <Text>{`plan:${planMode ? "on" : "off"}`}</Text>
        <Text>{`submit:${submitCount}`}</Text>
        <Text>{`value:${JSON.stringify(value)}`}</Text>
      </Box>
    </ThemeProvider>
  );
}

function ShortcutModelPickerHarness() {
  const focusManager = useFocusManager();
  const [screen, setScreen] = React.useState<"main" | "model-picker">("main");
  const [model, setModel] = React.useState<AvailableModel>("gpt-5.4");
  const [reasoningLevel, setReasoningLevel] = React.useState<ReasoningLevel>("high");
  const [value, setValue] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const [submitCount, setSubmitCount] = React.useState(0);
  const [composerInstanceKey, setComposerInstanceKey] = React.useState(0);
  const previousScreenRef = React.useRef<"main" | "model-picker">("main");

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
      <Box flexDirection="column">
        <Text>{`screen:${screen}`}</Text>
        <Text>{`submit:${submitCount}`}</Text>
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
            onSubmit={() => setSubmitCount((count) => count + 1)}
            onCancel={() => {}}
            onChangeValue={setValue}
            onChangeCursor={setCursor}
            onHistoryUp={() => {}}
            onHistoryDown={() => {}}
            onOpenBackendPicker={() => {}}
            onOpenModelPicker={() => setScreen("model-picker")}
            onOpenModePicker={() => {}}
            onOpenThemePicker={() => {}}
            onOpenAuthPanel={() => {}}
            onTogglePlanMode={() => {}}
            onClear={() => {}}
            onCycleMode={() => {}}
            onQuit={() => {}}
          />
        )}
      </Box>
    </ThemeProvider>
  );
}

function PlanActionPickerHarness() {
  const [selection, setSelection] = React.useState<string>("none");
  const [cancelCount, setCancelCount] = React.useState(0);

  return (
    <ThemeProvider theme="purple">
      <Box flexDirection="column">
        <PlanActionPicker
          hasPlanFile={true}
          onSelect={(value) => setSelection(value)}
          onCancel={() => setCancelCount((count) => count + 1)}
        />
        <Text>{`selection:${selection}`}</Text>
        <Text>{`cancel:${cancelCount}`}</Text>
      </Box>
    </ThemeProvider>
  );
}

function PlanFeedbackHarness() {
  const [screen, setScreen] = React.useState<"picker" | "feedback">("picker");
  const [submitted, setSubmitted] = React.useState("");

  return (
    <ThemeProvider theme="purple">
      <Box flexDirection="column">
        {screen === "picker" ? (
          <PlanActionPicker
            onSelect={(value) => {
              if (value === "revise") {
                setScreen("feedback");
              }
            }}
            onCancel={() => {}}
          />
        ) : (
          <TextEntryPanel
            focusId="composer"
            title="Revise plan"
            subtitle="Describe the revision."
            inputLabel="Revision"
            footerHint="Enter regenerate  Esc back  Backspace delete"
            onSubmit={(value) => {
              setSubmitted(value);
              setScreen("picker");
            }}
            onCancel={() => setScreen("picker")}
          />
        )}
        <Text>{`screen:${screen}`}</Text>
        <Text>{`submitted:${JSON.stringify(submitted)}`}</Text>
      </Box>
    </ThemeProvider>
  );
}

function KeyEventProbe() {
  const [eventSummary, setEventSummary] = React.useState("none");

  useInput((input, key) => {
    setEventSummary(JSON.stringify({
      input,
      ctrl: key.ctrl,
      return: key.return,
      shift: key.shift,
      meta: key.meta,
      escape: key.escape,
    }));
  });

  return <Text>{`event:${eventSummary}`}</Text>;
}

function TextEntryProtocolHarness() {
  const [submitted, setSubmitted] = React.useState("");

  return (
    <ThemeProvider theme="purple">
      <Box flexDirection="column">
        <TextEntryPanel
          focusId="composer"
          title="Protocol guard"
          subtitle="Only printable input should land in the field."
          inputLabel="Value"
          footerHint="Enter submit  Esc cancel  Backspace delete"
          onSubmit={setSubmitted}
          onCancel={() => {}}
        />
        <Text>{`submitted:${JSON.stringify(submitted)}`}</Text>
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

test("focus manager routes through the permissions panel and back to the composer", async () => {
  const harness = createInkHarness(<FocusRoutingHarness screen="permissions-panel" />);

  try {
    await sleep();
    harness.instance.rerender(<FocusRoutingHarness screen="main" />);
    await sleep();

    const output = harness.getOutput();
    assert.match(output, /permissions:focused/);
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
    assert.match(output, /❯\s+xyz/);
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

test("shift+tab toggles plan mode without submitting or mutating the input", async () => {
  const harness = createInkHarness(<PlanToggleComposerHarness />);

  try {
    await sleep();
    harness.stdin.write("a");
    await sleep(20);
    harness.stdin.write("\u001b[Z");
    await sleep(80);
    harness.stdin.write("\u001b[Z");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /plan:on/);
    assert.match(output, /plan:off/);
    assert.match(output, /submit:0/);
    assert.equal(getLastComposerValue(output), "a");
  } finally {
    await harness.cleanup();
  }
});

test("ctrl+o opens the existing model picker path without submitting", async () => {
  const harness = createInkHarness(<ShortcutModelPickerHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b[111;5u");
    await sleep(120);

    const output = harness.getOutput();
    assert.match(output, /screen:model-picker/);
    assert.match(output, /submit:0/);
    assert.match(output, /Select model/);
  } finally {
    await harness.cleanup();
  }
});

test("ctrl+o also opens the model picker when the terminal reports ctrl+enter as CSI-u", async () => {
  const harness = createInkHarness(<ShortcutModelPickerHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b[13;5u");
    await sleep(120);

    const output = harness.getOutput();
    assert.match(output, /screen:model-picker/);
    assert.match(output, /submit:0/);
    assert.match(output, /Select model/);
  } finally {
    await harness.cleanup();
  }
});

test("ctrl+o also opens the model picker when the terminal reports xterm modifyOtherKeys", async () => {
  const harness = createInkHarness(<ShortcutModelPickerHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b[27;5;111~");
    await sleep(120);

    const output = harness.getOutput();
    assert.match(output, /screen:model-picker/);
    assert.match(output, /submit:0/);
    assert.match(output, /Select model/);
  } finally {
    await harness.cleanup();
  }
});

test("raw carriage return collapses to the plain enter path in this stack", async () => {
  const harness = createInkHarness(<KeyEventProbe />);

  try {
    await sleep();
    harness.stdin.write("\r");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /"input":"\\r"/);
    assert.match(output, /"return":true/);
    assert.match(output, /"ctrl":false/);
  } finally {
    await harness.cleanup();
  }
});

test("kitty ctrl+enter preserves ctrl metadata for ctrl+o disambiguation", async () => {
  const harness = createInkHarness(<KeyEventProbe />);

  try {
    await sleep();
    harness.stdin.write("\u001b[13;5u");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /"input":"\\r"/);
    assert.match(output, /"return":true/);
    assert.match(output, /"ctrl":true/);
  } finally {
    await harness.cleanup();
  }
});

test("kitty ctrl+o letter form arrives as ctrl+o instead of enter", async () => {
  const harness = createInkHarness(<KeyEventProbe />);

  try {
    await sleep();
    harness.stdin.write("\u001b[111;5u");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /"input":"o"/);
    assert.match(output, /"return":false/);
    assert.match(output, /"ctrl":true/);
  } finally {
    await harness.cleanup();
  }
});

test("plain enter still submits once from the focused composer", async () => {
  const harness = createInkHarness(<PasteComposerHarness />);

  try {
    await sleep();
    harness.stdin.write("go");
    await sleep(20);
    harness.stdin.write("\r");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /submit:1/);
    assert.match(output, /value:"go"/);
  } finally {
    await harness.cleanup();
  }
});

test("escape still closes the model picker after ctrl+o opens it", async () => {
  const harness = createInkHarness(<ShortcutModelPickerHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b[111;5u");
    await sleep(120);
    harness.stdin.write("\u001b");
    await sleep(120);

    const output = harness.getOutput();
    assert.match(output, /screen:model-picker/);
    assert.match(output, /screen:main/);
    assert.match(output, /submit:0/);
  } finally {
    await harness.cleanup();
  }
});

test("drops leaked terminal keyboard protocol fragments from the composer", async () => {
  const harness = createInkHarness(<PasteComposerHarness />);

  try {
    await sleep();
    harness.stdin.write("a");
    await sleep(20);
    harness.stdin.write("\u001b[67;46;99;1:0:1u");
    await sleep(80);
    harness.stdin.write("b");
    await sleep(80);

    const output = harness.getOutput();
    assert.equal(getLastComposerValue(output), "ab");
    assert.doesNotMatch(output, /\[67;46;99;1:0:1u/);
  } finally {
    await harness.cleanup();
  }
});

test("swallows mouse and focus protocol events before they can render into the composer", async () => {
  const harness = createInkHarness(<PasteComposerHarness />);

  try {
    await sleep();
    harness.stdin.write("a");
    await sleep(20);
    harness.stdin.write("\u001b[<0;26;24M");
    await sleep(20);
    harness.stdin.write("\u001b[I\u001b[O");
    await sleep(20);
    harness.stdin.write("b");
    await sleep(80);

    const output = harness.getOutput();
    assert.equal(getLastComposerValue(output), "ab");
    assert.doesNotMatch(output, /\[<0;26;24M/);
    assert.doesNotMatch(output, /\[I|\[O/);
  } finally {
    await harness.cleanup();
  }
});
test("focus manager routes through the settings panel and back to the composer", async () => {
  const harness = createInkHarness(<FocusRoutingHarness screen="settings-panel" />);

  try {
    await sleep();
    harness.instance.rerender(<FocusRoutingHarness screen="main" />);
    await sleep();

    const output = harness.getOutput();
    assert.match(output, /settings:focused/);
    assert.ok(output.trim().endsWith("composer:focused"));
  } finally {
    await harness.cleanup();
  }
});

test("plan action picker supports view-plan-file selection and esc cancel", async () => {
  const harness = createInkHarness(<PlanActionPickerHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(80);
    harness.stdin.write("\u001b");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /selection:view_plan_file/);
    assert.match(output, /cancel:1/);
  } finally {
    await harness.cleanup();
  }
});

test("plan feedback entry returns to the picker on esc and submits on enter", async () => {
  const harness = createInkHarness(<PlanFeedbackHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(80);
    harness.stdin.write("\u001b");
    await sleep(80);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(80);
    harness.stdin.write("s");
    await sleep(20);
    harness.stdin.write("c");
    await sleep(20);
    harness.stdin.write("o");
    await sleep(20);
    harness.stdin.write("p");
    await sleep(20);
    harness.stdin.write("e");
    await sleep(20);
    harness.stdin.write("\r");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /screen:feedback/);
    assert.match(output, /screen:picker/);
    assert.match(output, /submitted:"scope"/);
  } finally {
    await harness.cleanup();
  }
});

test("text entry panels also drop leaked control sequences instead of submitting them", async () => {
  const harness = createInkHarness(<TextEntryProtocolHarness />);

  try {
    await sleep();
    harness.stdin.write("a");
    await sleep(20);
    harness.stdin.write("\u001b[67;46;99;1:0:1u");
    await sleep(20);
    harness.stdin.write("\u001b[<0;26;24M");
    await sleep(20);
    harness.stdin.write("b");
    await sleep(20);
    harness.stdin.write("\r");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /submitted:"ab"/);
    assert.doesNotMatch(output, /\[67;46;99;1:0:1u/);
    assert.doesNotMatch(output, /\[<0;26;24M/);
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
