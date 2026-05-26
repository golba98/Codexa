import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import React from "react";
import { render } from "ink";
import { createLayoutSnapshot } from "./layout.js";
import { ModelPickerScreen } from "./ModelPickerScreen.js";
import { ThemeProvider } from "./theme.js";

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
  columns = 120;
  rows = 40;
}

function stripAnsi(value: string): string {
  return value.replace(/\[[0-?]*[ -/]*[@-~]/g, "");
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderModelPicker(props: Partial<Parameters<typeof ModelPickerScreen>[0]> = {}): Promise<string> {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });

  const instance = render(
    <ThemeProvider theme="purple">
      <ModelPickerScreen
        layout={createLayoutSnapshot(120, 40)}
        models={[]}
        currentModel="gpt-5.4"
        currentReasoning="medium"
        activeProviderLabel="OpenAI"
        onSelect={() => {}}
        onCancel={() => {}}
        {...props}
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

  await sleep(60);
  instance.cleanup();
  await sleep(20);
  return stripAnsi(output);
}

test("model picker shows default routeText when no override provided", async () => {
  const output = await renderModelPicker({ activeProviderLabel: "Google" });
  assert.match(output, /Choose a Google model to use inside Codexa\./);
});

test("model picker shows routeTextOverride when provided", async () => {
  const override = "Model selection is managed by the active provider route.";
  const output = await renderModelPicker({
    activeProviderLabel: "Google",
    routeTextOverride: override,
  });
  assert.match(output, /Model selection is managed by the active provider route\./);
});

test("routeTextOverride suppresses the default Choose copy", async () => {
  const override = "Model selection is managed by the active provider route.";
  const output = await renderModelPicker({
    activeProviderLabel: "Google",
    routeTextOverride: override,
  });
  assert.doesNotMatch(output, /Choose a Google model/);
});

test("default routeText uses 'a' for non-vowel provider labels", async () => {
  const output = await renderModelPicker({ activeProviderLabel: "Google" });
  assert.match(output, /Choose a Google model to use inside Codexa\./);
});

test("default routeText uses 'an' for vowel-starting provider labels", async () => {
  const output = await renderModelPicker({ activeProviderLabel: "OpenAI" });
  assert.match(output, /Choose an OpenAI/);
});
