import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { Box, Text, render } from "ink";
import type { SettingDefinition } from "../config/settings.js";
import { SettingsPanel } from "./SettingsPanel.js";
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

type TestSettingKey = "directory" | "density";

const TEST_SETTINGS: readonly SettingDefinition<TestSettingKey, string>[] = [
  {
    key: "directory",
    label: "Directory",
    description: "Controls the displayed workspace label.",
    options: [
      { value: "normal", label: "Normal" },
      { value: "simple", label: "Simple" },
    ],
  },
  {
    key: "density",
    label: "Density",
    description: "Controls how dense the rows feel.",
    options: [
      { value: "cozy", label: "Cozy" },
      { value: "compact", label: "Compact" },
      { value: "dense", label: "Dense" },
    ],
  },
] as const;

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

function SettingsPanelHarness() {
  const [saved, setSaved] = React.useState<Record<TestSettingKey, string>>({
    directory: "normal",
    density: "cozy",
  });
  const [cancelCount, setCancelCount] = React.useState(0);

  return (
    <ThemeProvider theme="purple">
      <Box flexDirection="column">
        <SettingsPanel
          focusId="settings-panel"
          settings={TEST_SETTINGS}
          values={saved}
          onSave={(nextValues) => setSaved(nextValues)}
          onCancel={() => setCancelCount((count) => count + 1)}
        />
        <Text>{`saved:${JSON.stringify(saved)}`}</Text>
        <Text>{`cancel:${cancelCount}`}</Text>
      </Box>
    </ThemeProvider>
  );
}

test("up and down move between settings rows before changing values", async () => {
  const harness = createInkHarness(<SettingsPanelHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[C");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /saved:\{"directory":"normal","density":"compact"\}/);
  } finally {
    await harness.cleanup();
  }
});

test("left and right cycle the active option and wrap across the list", async () => {
  const harness = createInkHarness(<SettingsPanelHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b[D");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /saved:\{"directory":"simple","density":"cozy"\}/);
  } finally {
    await harness.cleanup();
  }
});

test("escape cancels the panel without saving the draft values", async () => {
  const harness = createInkHarness(<SettingsPanelHarness />);

  try {
    await sleep();
    harness.stdin.write("\u001b[C");
    await sleep(40);
    harness.stdin.write("\u001b");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /saved:\{"directory":"normal","density":"cozy"\}/);
    assert.match(output, /cancel:1/);
  } finally {
    await harness.cleanup();
  }
});

test("printable input is ignored while the settings panel is focused", async () => {
  const harness = createInkHarness(<SettingsPanelHarness />);

  try {
    await sleep();
    harness.stdin.write("abc");
    await sleep(40);
    harness.stdin.write("\u001b[C");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(80);

    const output = harness.getOutput();
    assert.doesNotMatch(output, /abc/);
    assert.match(output, /saved:\{"directory":"simple","density":"cozy"\}/);
  } finally {
    await harness.cleanup();
  }
});
