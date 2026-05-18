import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import React from "react";
import { Box, Text, render } from "ink";
import { buildProviderRegistry } from "../core/providerLauncher/registry.js";
import type { ProviderId, ProviderPickerAction } from "../core/providerLauncher/types.js";
import { createLayoutSnapshot } from "./layout.js";
import { ProviderPicker } from "./ProviderPicker.js";
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

function ProviderPickerHarness() {
  const [action, setAction] = React.useState("none");
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4",
    workspaceConfig: { workspaceDefaultProviderId: "openai" },
  });

  return (
    <ThemeProvider theme="purple">
      <Box flexDirection="column">
        <ProviderPicker
          layout={createLayoutSnapshot(120, 40)}
          providers={providers}
          onAction={(providerId: ProviderId, nextAction: ProviderPickerAction) => {
            setAction(`${providerId}:${nextAction}`);
          }}
          onCancel={() => setAction("cancel")}
        />
        <Text>{`action:${action}`}</Text>
      </Box>
    </ThemeProvider>
  );
}

test("provider picker renders compact aligned provider rows", async () => {
  const harness = createInkHarness(<ProviderPickerHarness />);

  try {
    await sleep(80);
    const output = harness.getOutput();
    assert.match(output, /Providers/);
    assert.match(output, /Enter = select, S = set default, Esc = cancel/);
    assert.match(output, /OpenAI/);
    assert.match(output, /Anthropic/);
    assert.match(output, /Google/);
    assert.match(output, /Local/);
    assert.match(output, /Context/);
    assert.match(output, /Tool/);
    assert.match(output, /Strm/);
    assert.match(output, /Unknown/);
    assert.match(output, /\?/);
    assert.match(output, /Disabled/);
    assert.doesNotMatch(output, /0\/unknown/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker stays readable in a cramped terminal layout", async () => {
  const providers = buildProviderRegistry({ activeModel: "gpt-5.4-mini" });
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(44, 18)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>,
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    assert.match(output, /Providers/);
    assert.match(output, /Enter select\s+S default/);
    assert.doesNotMatch(output, /Gemini CLIEnabled/);
    assert.match(output, /OpenAI/);
    assert.match(output, /Local/);
    assert.match(output, /Disabled/);
    assert.doesNotMatch(output, /undefined/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker supports setting default with S", async () => {
  const harness = createInkHarness(<ProviderPickerHarness />);

  try {
    await sleep(80);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("s");
    await sleep(80);

    assert.match(harness.getOutput(), /action:anthropic:set-default/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker opens action menu and selects launch", async () => {
  const harness = createInkHarness(<ProviderPickerHarness />);

  try {
    await sleep(80);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(40);
    assert.match(harness.getOutput(), /Provider action: Anthropic/);
    assert.match(harness.getOutput(), /Use in Codexa/);
    assert.match(harness.getOutput(), /Launch external CLI/);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(80);

    assert.match(harness.getOutput(), /action:anthropic:launch/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker reports Anthropic in-Codexa route actions without launching", async () => {
  const harness = createInkHarness(<ProviderPickerHarness />);

  try {
    await sleep(80);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(80);

    assert.match(harness.getOutput(), /action:anthropic:use-in-codexa/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker exposes Gemini diagnostics action", async () => {
  const harness = createInkHarness(<ProviderPickerHarness />);

  try {
    await sleep(80);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(40);
    assert.match(harness.getOutput(), /Provider action: Google/);
    assert.match(harness.getOutput(), /Run Gemini diagnostics/);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(80);

    assert.match(harness.getOutput(), /action:google:run-diagnostics/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker cancels from provider list with Esc", async () => {
  const harness = createInkHarness(<ProviderPickerHarness />);

  try {
    await sleep(80);
    harness.stdin.write("\u001b");
    await sleep(80);

    assert.match(harness.getOutput(), /action:cancel/);
  } finally {
    await harness.cleanup();
  }
});
