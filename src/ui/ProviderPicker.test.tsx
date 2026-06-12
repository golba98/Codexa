import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import React from "react";
import { Box, Text, render } from "ink";
import { buildProviderRegistry } from "../core/providerLauncher/registry.js";
import type { ProviderConfig, ProviderId, ProviderPickerAction } from "../core/providerLauncher/types.js";
import fs from "fs";
import path from "path";
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
    assert.match(output, /Enter = select, U = use, S = set default, Esc = cancel/);
    assert.match(output, /OpenAI/);
    assert.match(output, /Anthropic/);
    assert.match(output, /Google/);
    assert.match(output, /Local/);
    assert.match(output, /Antigravity/);
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
    assert.match(output, /Enter select/);
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

test('pressing U fires use-in-codexa for the selected provider', async () => {
  const harness = createInkHarness(<ProviderPickerHarness />);

  try {
    await sleep(80);
    harness.stdin.write('u');
    await sleep(80);

    assert.match(harness.getOutput(), /action:openai:use-in-codexa/);
  } finally {
    await harness.cleanup();
  }
});

test('pressing U after navigating down fires use-in-codexa for the selected provider', async () => {
  const harness = createInkHarness(<ProviderPickerHarness />);

  try {
    await sleep(80);
    harness.stdin.write('j'); // down to Anthropic
    await sleep(40);
    harness.stdin.write('u');
    await sleep(80);

    assert.match(harness.getOutput(), /action:anthropic:use-in-codexa/);
  } finally {
    await harness.cleanup();
  }
});



// ─── Table Rendering Layout Tests ────────────────────────────────────────────

function buildMockProvider(override: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: "openai",
    displayName: "OpenAI",
    currentModel: "gpt-5.4-mini",
    backendType: "openai-api-key",
    routeMode: "in-codexa",
    enabled: true,
    statusLabel: "Enabled",
    launchCommand: null,
    isDefault: false,
    isActiveRoute: false,
    routeUnavailableReason: null,
    ...override,
  };
}

test("provider picker table rendering - normal width", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "OpenAI", currentModel: "gpt-5.4-mini" }),
    buildMockProvider({ id: "anthropic", displayName: "Anthropic", currentModel: "claude-3-opus" }),
  ];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(80, 24)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    // Headers and rows should not contain merged text
    assert.match(output, /Provider/);
    assert.match(output, /Model/);
    assert.match(output, /Status/);
    assert.match(output, /OpenAI/);
    assert.match(output, /gpt-5.4-mini/);
    assert.doesNotMatch(output, /OpenAIer Model/);
    assert.doesNotMatch(output, /Strm Status inside a data row/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker table rendering - max width and centering", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "OpenAI" }),
  ];
  // Width 150 > maxTableWidth (100)
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(150, 24)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    // Verify that the table is centered (starts with leading spaces in the rendered buffer)
    // The panelWidth should be 100, which is centered in 150 cols, so there should be around 25 leading spaces.
    assert.match(output, /^\s{10,}/); 
    assert.match(output, /OpenAI/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker table rendering - narrow width (dropped columns)", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "OpenAI" }),
  ];
  // Width 60: drops stream & tool, keeps context
  const harness60 = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(60, 24)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output60 = harness60.getOutput();
    assert.match(output60, /Context/);
    assert.doesNotMatch(output60, /Tool/);
    assert.doesNotMatch(output60, /Strm/);
  } finally {
    await harness60.cleanup();
  }

  // Width 40: drops all optional columns
  const harness40 = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(40, 24)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output40 = harness40.getOutput();
    assert.doesNotMatch(output40, /Context/);
    assert.doesNotMatch(output40, /Tool/);
    assert.doesNotMatch(output40, /Strm/);
  } finally {
    await harness40.cleanup();
  }
});

test("provider picker table rendering - long names and truncation", async () => {
  const providers = [
    buildMockProvider({
      id: "openai",
      displayName: "VeryLongProviderNameThatWillTruncate",
      currentModel: "very-long-model-name-that-exceeds-bounds",
      statusLabel: "ExtremelyLongStatusLabelHere",
    }),
  ];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(80, 24)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    // Long provider name is truncated in its column (width 14) -> "VeryLongProvi…"
    assert.match(output, /VeryLongProvi…/);
    // Long model name is truncated
    assert.match(output, /…/);
    // Long status label is truncated
    assert.match(output, /Extreme…/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker table rendering - individual markers", async () => {
  const providers = [
    buildMockProvider({
      id: "openai",
      displayName: "OpenAI",
      isDefault: true,
      isActiveRoute: true,
    }),
  ];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(80, 24)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    // Should have selected marker (isHighlighted), default marker '*', and active marker '@'
    // in separate columns: "> * @ OpenAI"
    assert.match(output, /> \* @ OpenAI/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker table rendering - debug logging mode", async () => {
  const logPath = "/home/k9-vortex/Development/1-JavaScript_TypeScript/13-Custom-CLI-Normal/codexa_table_debug.log";
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
  }

  process.env.CODEXA_TABLE_DEBUG = "1";

  const providers = [buildMockProvider({ id: "openai", displayName: "OpenAI" })];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(80, 24)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    assert.strictEqual(fs.existsSync(logPath), true, "Debug log file should be created");
    const logContent = fs.readFileSync(logPath, "utf8");
    assert.match(logContent, /DEBUG/);
    assert.match(logContent, /Terminal Cols:/);
    assert.match(logContent, /Panel Width:/);
    assert.match(logContent, /Columns:/);
  } finally {
    delete process.env.CODEXA_TABLE_DEBUG;
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
    }
    await harness.cleanup();
  }
});

test("provider picker table rendering - scroll vertical clipping", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "OpenAI" }),
    buildMockProvider({ id: "anthropic", displayName: "Anthropic" }),
    buildMockProvider({ id: "google", displayName: "Google" }),
    buildMockProvider({ id: "local", displayName: "Local" }),
    buildMockProvider({ id: "antigravity", displayName: "Antigravity" }),
  ];
  // Height 13 -> maxBodyHeight = Math.max(3, 13 - 11) = 3 -> shows scroll indicator
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(80, 13)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    assert.match(output, /providers shown/);
  } finally {
    await harness.cleanup();
  }
});
