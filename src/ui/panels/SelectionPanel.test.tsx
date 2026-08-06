import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { AVAILABLE_THEMES } from "../../config/settings.js";
import { PanelLayoutContext } from "../layout.js";
import { ThemeProvider } from "../theme.js";
import { SelectionPanel } from "./SelectionPanel.js";

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode(): this { return this; }
  override resume(): this { return this; }
  override pause(): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }
}

class TestOutput extends PassThrough {
  readonly isTTY = true;
  columns = 100;
  rows = 22;
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("100x22 selection panel shows every registered theme and previews movement", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  const highlighted: string[] = [];
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });

  const instance = render(
    <ThemeProvider theme="purple">
      <PanelLayoutContext.Provider value={{ mode: "compact", availableRows: 12, availableCols: 96 }}>
        <SelectionPanel
          focusId="theme-picker-test"
          title="Select visual theme"
          subtitle="Use arrows"
          initialValue="ocean"
          items={AVAILABLE_THEMES.map((theme) => ({ label: theme.label, value: theme.id }))}
          onSelect={() => {}}
          onHighlight={(value) => highlighted.push(value)}
          onCancel={() => {}}
        />
      </PanelLayoutContext.Provider>
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
    const text = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
    for (const theme of AVAILABLE_THEMES) assert.match(text, new RegExp(theme.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /> Deep Oceanic/);

    stdin.write("\u001b[A");
    await sleep(80);
    assert.equal(highlighted.at(-1), "gruvbox");
  } finally {
    instance.cleanup();
    await sleep(20);
  }
});
