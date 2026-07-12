import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import React from "react";
import { render } from "ink";
import { ThemeProvider } from "../theme.js";
import { ModelPickerScreen } from "./ModelPickerScreen.js";
import { createLayoutSnapshot } from "../layout.js";

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
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("model picker displays grammar-correct selection message for OpenAI", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });

  const { cleanup } = render(
    <ThemeProvider theme="purple">
      <ModelPickerScreen
        layout={createLayoutSnapshot(120, 40)}
        models={[]}
        currentModel="gpt-4o"
        currentReasoning="medium"
        activeProviderLabel="OpenAI"
        onSelect={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>,
    { stdin: stdin as any, stdout: stdout as any, debug: true }
  );

  try {
    await sleep(100);
    const stripped = stripAnsi(output);
    assert.match(stripped, /Choose an OpenAI model to use inside Codexa/);
  } finally {
    cleanup();
  }
});

test("model picker displays grammar-correct selection message for Google", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });

  const { cleanup } = render(
    <ThemeProvider theme="purple">
      <ModelPickerScreen
        layout={createLayoutSnapshot(120, 40)}
        models={[]}
        currentModel="gpt-4o"
        currentReasoning="medium"
        activeProviderLabel="Google"
        onSelect={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>,
    { stdin: stdin as any, stdout: stdout as any, debug: true }
  );

  try {
    await sleep(100);
    const stripped = stripAnsi(output);
    assert.match(stripped, /Choose a Google model to use inside Codexa/);
  } finally {
    cleanup();
  }
});

test("model picker displays reasoning: current/default when models are empty", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });

  const { cleanup } = render(
    <ThemeProvider theme="purple">
      <ModelPickerScreen
        layout={createLayoutSnapshot(120, 40)}
        models={[]}
        currentModel="gpt-4o"
        currentReasoning="medium"
        onSelect={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>,
    { stdin: stdin as any, stdout: stdout as any, debug: true }
  );

  try {
    await sleep(100);
    const stripped = stripAnsi(output);
    assert.match(stripped, /Reasoning: current\/default/);
    assert.match(stripped, /No models available/);
  } finally {
    cleanup();
  }
});

test("model picker displays emptyMessage when provided", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });

  const { cleanup } = render(
    <ThemeProvider theme="purple">
      <ModelPickerScreen
        layout={createLayoutSnapshot(120, 40)}
        models={[]}
        currentModel="gpt-4o"
        currentReasoning="medium"
        emptyMessage="Custom empty message"
        onSelect={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>,
    { stdin: stdin as any, stdout: stdout as any, debug: true }
  );

  try {
    await sleep(100);
    const stripped = stripAnsi(output);
    assert.match(stripped, /Custom empty message/);
  } finally {
    cleanup();
  }
});
