import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { normalizeCodexModelListResponses, type CodexModelCapability } from "../core/codexModelCapabilities.js";
import { ThemeProvider } from "./theme.js";
import { ModelReasoningPicker } from "./ModelReasoningPicker.js";
import { ReasoningPicker } from "./ReasoningPicker.js";

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
    getOutput(): string {
      return stripAnsi(output);
    },
    async cleanup() {
      instance.cleanup();
      await sleep(20);
    },
  };
}

function testModels(): readonly CodexModelCapability[] {
  return normalizeCodexModelListResponses([
    {
      data: [
        {
          id: "model-four",
          model: "model-four",
          displayName: "Model Four",
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Low" },
            { reasoningEffort: "medium", description: "Medium" },
            { reasoningEffort: "high", description: "High" },
            { reasoningEffort: "xhigh", description: "Extra" },
          ],
        },
        {
          id: "model-two",
          model: "model-two",
          displayName: "Model Two",
          hidden: false,
          isDefault: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Medium" },
            { reasoningEffort: "high", description: "High" },
          ],
        },
      ],
    },
  ]).models;
}

test("model picker renders dynamic models and the highlighted model's reasoning bar count", async () => {
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ModelReasoningPicker
        models={testModels()}
        currentModel="model-four"
        currentReasoning="medium"
        onSelect={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>,
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    assert.match(output, /Model Four \(model-four\)/);
    assert.match(output, /Model Two \(model-two\)/);
    const lastFrame = output.slice(output.lastIndexOf("Select model"));
    assert.equal((lastFrame.match(/■/g) ?? []).length, 4);
  } finally {
    await harness.cleanup();
  }
});

test("model picker uses each selected model's own reasoning level count", async () => {
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ModelReasoningPicker
        models={testModels()}
        currentModel="model-four"
        currentReasoning="medium"
        onSelect={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>,
  );

  try {
    await sleep(80);
    harness.stdin.write("\u001b[B");
    await sleep(80);
    const output = harness.getOutput();
    const lastFrame = output.slice(output.lastIndexOf("Select model"));
    assert.equal((lastFrame.match(/■/g) ?? []).length, 2);
  } finally {
    await harness.cleanup();
  }
});

test("reasoning picker renders only detected levels for the selected model", async () => {
  const modelTwo = testModels()[1]!;
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ReasoningPicker
        currentModel={modelTwo.model}
        currentReasoning="medium"
        reasoningLevels={modelTwo.supportedReasoningLevels ?? []}
        defaultReasoning={modelTwo.defaultReasoningLevel}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>,
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    assert.match(output, /Medium/);
    assert.match(output, /High/);
    assert.doesNotMatch(output, /Extra high/);
    assert.doesNotMatch(output, /\bLow\b/);
  } finally {
    await harness.cleanup();
  }
});
