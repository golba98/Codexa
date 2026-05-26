import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import React from "react";
import { Box, Text, render } from "ink";
import { createLayoutSnapshot } from "./layout.js";
import { BottomComposer } from "./BottomComposer.js";
import { ThemeProvider } from "./theme.js";

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode = () => this;
  ref = () => this;
  unref = () => this;
}

class TestOutput extends PassThrough {
  readonly isTTY = true;
  columns = 120;
  rows = 40;
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("Ctrl+Alt+P raw escape sequence opens provider picker", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let providerPickerOpened = false;

  render(
    <ThemeProvider theme="purple">
      <BottomComposer
        layout={createLayoutSnapshot(120, 40)}
        uiState={{ kind: "IDLE" }}
        mode="auto"
        model="gpt-4"
        themeName="purple"
        reasoningLevel="low"
        planMode={false}
        showBusyLoader={false}
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
        onOpenProviderPicker={() => {
          providerPickerOpened = true;
        }}
        onOpenModelPicker={() => {}}
        onOpenModePicker={() => {}}
        onOpenThemePicker={() => {}}
        onOpenAuthPanel={() => {}}
        onTogglePlanMode={() => {}}
        onClear={() => {}}
        onCycleMode={() => {}}
        onQuit={() => {}}
      />
    </ThemeProvider>,
    {
      stdin: stdin as any,
      stdout: stdout as any,
      debug: true,
      exitOnCtrlC: false,
    }
  );

  // Wait for effect setup
  await sleep(100);

  // Send raw Ctrl+Alt+P sequence (ESC ^P)
  stdin.write("\x1b\x10");
  
  // useInput is triggered on the next tick in Ink
  await sleep(100);

  assert.strictEqual(providerPickerOpened, true, "Provider picker should be opened by raw Ctrl+Alt+P sequence");
});

test("Ctrl+Alt+P CSI u sequence opens provider picker", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let providerPickerOpened = false;

  render(
    <ThemeProvider theme="purple">
      <BottomComposer
        layout={createLayoutSnapshot(120, 40)}
        uiState={{ kind: "IDLE" }}
        mode="auto"
        model="gpt-4"
        themeName="purple"
        reasoningLevel="low"
        planMode={false}
        showBusyLoader={false}
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
        onOpenProviderPicker={() => {
          providerPickerOpened = true;
        }}
        onOpenModelPicker={() => {}}
        onOpenModePicker={() => {}}
        onOpenThemePicker={() => {}}
        onOpenAuthPanel={() => {}}
        onTogglePlanMode={() => {}}
        onClear={() => {}}
        onCycleMode={() => {}}
        onQuit={() => {}}
      />
    </ThemeProvider>,
    {
      stdin: stdin as any,
      stdout: stdout as any,
      debug: true,
      exitOnCtrlC: false,
    }
  );

  await sleep(100);

  // Send CSI u sequence for Ctrl+Alt+P
  stdin.write("\x1b[112;7u");
  
  await sleep(100);

  assert.strictEqual(providerPickerOpened, true, "Provider picker should be opened by CSI u Ctrl+Alt+P sequence");
});
