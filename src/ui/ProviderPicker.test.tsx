import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import React from "react";
import { Box, Text, render } from "ink";
import { buildProviderRegistry } from "../core/providerLauncher/registry.js";
import type { ProviderConfig, ProviderId, ProviderPickerAction } from "../core/providerLauncher/types.js";
import { createLayoutSnapshot } from "./layout.js";
import { ProviderPicker, getTableLayout } from "./ProviderPicker.js";
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

function captureConsoleMessages() {
  const messages: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = ((...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  }) as typeof console.error;
  console.warn = ((...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  }) as typeof console.warn;

  return {
    messages,
    restore() {
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
}

function assertNoAvailableRowsFragmentWarning(messages: readonly string[]) {
  assert.equal(
    messages.some((message) => message.includes("Invalid prop `availableRows` supplied to `React.Fragment`")),
    false,
  );
}

function getLatestBoxFrame(output: string): string {
  const frameStart = output.lastIndexOf("╭");
  return frameStart >= 0 ? output.slice(frameStart) : output;
}

function assertProviderOrder(frame: string, providerNames: readonly string[]) {
  let previousIndex = -1;
  for (const providerName of providerNames) {
    const nextIndex = frame.indexOf(providerName);
    assert.ok(nextIndex >= 0, `expected ${providerName} to render`);
    assert.ok(nextIndex > previousIndex, `expected ${providerName} to render after the previous provider`);
    previousIndex = nextIndex;
  }
}

function assertProviderRowsAreAdjacent(frame: string, providerNames: readonly string[]) {
  const lines = frame.split("\n");
  const providerLineIndexes = providerNames.map((providerName) => {
    const index = lines.findIndex((line) => line.includes(providerName));
    assert.ok(index >= 0, `expected ${providerName} row to render`);
    return index;
  });

  for (let i = 1; i < providerLineIndexes.length; i += 1) {
    assert.equal(
      providerLineIndexes[i],
      providerLineIndexes[i - 1]! + 1,
      `expected no blank row between ${providerNames[i - 1]} and ${providerNames[i]}`,
    );
  }
}

function assertSelectedProviderLine(frame: string, providerName: string) {
  const selectedLine = frame.split("\n").find((line) => line.includes(providerName));
  assert.ok(selectedLine, `expected ${providerName} row to render`);
  assert.match(selectedLine, />/, `expected ${providerName} row to contain the selected marker`);
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

async function renderProviderPickerAtIndex({
  providers,
  selectedIndex,
  layout = createLayoutSnapshot(100, 21),
}: {
  providers: readonly ProviderConfig[];
  selectedIndex: number;
  layout?: ReturnType<typeof createLayoutSnapshot>;
}): Promise<string> {
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={layout}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>,
  );

  try {
    await sleep(80);
    for (let i = 0; i < selectedIndex; i += 1) {
      harness.stdin.write("j");
      await sleep(40);
    }

    return getLatestBoxFrame(harness.getOutput());
  } finally {
    await harness.cleanup();
  }
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
          layout={createLayoutSnapshot(100, 22)}
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
    const frame = getLatestBoxFrame(output);
    const providerNames = ["OpenAI", "Anthropic", "Mistral Vibe", "Local", "Antigravity"];

    assert.match(frame, /Providers/);
    assert.match(frame, /Enter select \| U use \| S default \| Esc close/);
    for (const providerName of providerNames) {
      assert.match(frame, new RegExp(providerName));
    }
    assertProviderOrder(frame, providerNames);
    assertProviderRowsAreAdjacent(frame, providerNames);
    assert.doesNotMatch(frame, /Context/);
    assert.doesNotMatch(frame, /Tool/);
    assert.doesNotMatch(frame, /Strm/);
    assert.match(frame, /Off/);
    assert.doesNotMatch(frame, /0\/unknown/);
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
    assert.doesNotMatch(output, /Gemini CLIEnabled/);
    assert.match(output, /OpenAI/);
    assert.match(output, /Anthrop/);
    assert.doesNotMatch(output, /Google/);
    assert.match(output, /Local/);
    assert.match(output, /Antigra/);
    assert.match(output, /Off/);
    assert.doesNotMatch(output, /undefined/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker small layout renders without availableRows fragment warnings", async () => {
  const consoleCapture = captureConsoleMessages();
  const providers = buildProviderRegistry({ activeModel: "gpt-5.4-mini" });
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(70, 15)}
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
    assert.match(output, /Anthropic/);
    assertNoAvailableRowsFragmentWarning(consoleCapture.messages);
  } finally {
    await harness.cleanup();
    consoleCapture.restore();
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

test("provider picker reports Mistral Vibe in-Codexa route actions without launching", async () => {
  const harness = createInkHarness(<ProviderPickerHarness />);

  try {
    await sleep(80);
    harness.stdin.write("[B");
    await sleep(40);
    harness.stdin.write("[B");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(40);
    assert.match(harness.getOutput(), /Provider action: Mistral Vibe CLI/);
    assert.doesNotMatch(harness.getOutput(), /Use in Codexa unavailable/);
    harness.stdin.write("\r");
    await sleep(80);

    assert.match(harness.getOutput(), /action:mistral:use-in-codexa/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker exposes Local diagnostics action", async () => {
  const harness = createInkHarness(<ProviderPickerHarness />);

  try {
    await sleep(80);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(40);
    assert.match(harness.getOutput(), /Provider action: Local/);
    assert.match(harness.getOutput(), /Run Local diagnostics/);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\u001b[B");
    await sleep(40);
    harness.stdin.write("\r");
    await sleep(80);

    assert.match(harness.getOutput(), /action:local:run-diagnostics/);
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
        layout={createLayoutSnapshot(110, 32)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    assert.match(output, /Provider/);
    assert.match(output, /Model/);
    assert.match(output, /Status/);
    assert.match(output, /OpenAI/);
    assert.match(output, /gpt-5.4-mini/);
    assert.doesNotMatch(output, /OpenAIer Model/);
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
        layout={createLayoutSnapshot(60, 28)}
        panelLayout={{ mode: "regular", availableRows: 15, availableCols: 56 }}
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
        layout={createLayoutSnapshot(40, 28)}
        panelLayout={{ mode: "regular", availableRows: 15, availableCols: 36 }}
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

test("provider picker table rendering - maximized width uses more than 100 columns and caps model gaps", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "OpenAI", currentModel: "gpt-5.4-mini" }),
  ];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(150, 30)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    const borderLine = output.split("\n").find(line => line.includes("╭"));
    assert(borderLine, "Should find top border line");
    assert(borderLine.length > 100, `Border line length should be > 100, got ${borderLine.length}`);
    assert.doesNotMatch(output, /gpt-5\.4-mini {65,}/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker table rendering - selected/default/current markers stay separate", async () => {
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
    assert.match(output, /> \* @OpenAI/);
  } finally {
    await harness.cleanup();
  }
});

test("provider picker table rendering - Down/j moves one provider, not two", async () => {
  const harness = createInkHarness(<ProviderPickerHarness />);

  try {
    await sleep(80);
    harness.stdin.write("j");
    await sleep(80);
    const output = harness.getOutput();
    const frames = output.split(/╭─+/);
    const latestFrame = "╭──" + (frames[frames.length - 1] ?? "");
    assert.match(latestFrame, />\s+Anthropic/);
    assert.doesNotMatch(latestFrame, />\s+\* @ OpenAI/);
  } finally {
    await harness.cleanup();
  }
});

test("getTableLayout calculations for wide/maximized terminals", () => {
  const cols = getTableLayout(146); // innerWidth for 180+ cols terminal
  assert(cols.model > 30, `Model column should be > 30, got ${cols.model}`);
  assert(cols.status <= 22, `Status column should be <= 22, got ${cols.status}`);
  assert(cols.status >= 16, `Status column should be >= 16, got ${cols.status}`);
  assert(cols.provider <= 22, `Provider column should be <= 22, got ${cols.provider}`);
  assert(cols.trailingPadding >= 0, `Should have trailingPadding >= 0, got ${cols.trailingPadding}`);
});

test("provider picker table rendering - wide layout status column is not huge and model is wide", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "OpenAI", currentModel: "gpt-5.4-mini" }),
  ];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(180, 24)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    
    // Panel width > 100
    const borderLine = output.split("\n").find(line => line.includes("╭"));
    assert(borderLine, "Should find top border line");
    assert(borderLine.length > 100, `Border line length should be > 100, got ${borderLine.length}`);

    // Data line containing OpenAI and gpt-5.4-mini
    const dataLine = output.split("\n").find(line => line.includes("OpenAI") && line.includes("gpt-5.4-mini"));
    assert(dataLine, "Should find data line");

    // Status column should not absorb huge whitespace
    // Status text is "Enabled" which has 7 chars. Capped status <= 22 means <= 15 trailing spaces.
    // So there should not be 30 or more spaces after "Enabled".
    assert.doesNotMatch(dataLine, /Enabled {30,}/);
  } finally {
    await harness.cleanup();
  }
});

test("ProviderPicker width at contentWidth 171 is >150", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "OpenAI" }),
  ];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(180, 24)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    const borderLine = output.split("\n").find(line => line.includes("╭"));
    assert(borderLine, "Should find top border line");
    assert(borderLine.length > 150, `Border line length should be > 150, got ${borderLine.length}`);
  } finally {
    await harness.cleanup();
  }
});

test("ProviderPicker width at contentWidth 207 is >190", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "OpenAI" }),
  ];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(220, 24)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    const borderLine = output.split("\n").find(line => line.includes("╭"));
    assert(borderLine, "Should find top border line");
    assert(borderLine.length > 190, `Border line length should be > 190, got ${borderLine.length}`);
  } finally {
    await harness.cleanup();
  }
});

test("ProviderPicker with 5 providers shows all providers when rows are sufficient", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "ProviderOne" }),
    buildMockProvider({ id: "anthropic", displayName: "ProviderTwo" }),
    buildMockProvider({ id: "google", displayName: "ProviderThree" }),
    buildMockProvider({ id: "local", displayName: "ProviderFour" }),
    buildMockProvider({ id: "antigravity", displayName: "ProviderFive" }),
  ];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(120, 40)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    assert.match(output, /ProviderOne/);
    assert.match(output, /ProviderTwo/);
    assert.match(output, /ProviderThree/);
    assert.match(output, /ProviderFour/);
    assert.match(output, /ProviderFive/);
  } finally {
    await harness.cleanup();
  }
});

test("ProviderPicker does not reserve excessive empty vertical rows", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "ProviderOne" }),
    buildMockProvider({ id: "anthropic", displayName: "ProviderTwo" }),
    buildMockProvider({ id: "google", displayName: "ProviderThree" }),
    buildMockProvider({ id: "local", displayName: "ProviderFour" }),
    buildMockProvider({ id: "antigravity", displayName: "ProviderFive" }),
  ];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(120, 40)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    const latestFrame = getLatestBoxFrame(output);
    const lines = latestFrame.split("\n").map(l => l.trim()).filter(Boolean);
    const emptyPanelLines = lines.filter(line => line.startsWith("│") && line.endsWith("│") && line.slice(1, -1).trim() === "");
    assert.equal(emptyPanelLines.length, 0, "Compact mode should not render empty interior panel rows");
  } finally {
    await harness.cleanup();
  }
});

test("ProviderPicker at 100x21 uses compact mode and shows all selectable providers", async () => {
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4-mini",
    workspaceConfig: { workspaceDefaultProviderId: "openai" },
  });
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(100, 21)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    const frame = getLatestBoxFrame(output);
    const providerNames = ["OpenAI", "Anthropic", "Mistral Vibe", "Local", "Antigravity"];

    for (const providerName of providerNames) {
      assert.match(frame, new RegExp(providerName));
    }
    assertProviderOrder(frame, providerNames);
    assertProviderRowsAreAdjacent(frame, providerNames);
    assert.doesNotMatch(frame, /Showing \d+-\d+ of 5/);
    assert.doesNotMatch(frame, /↓ \d+ more|↑ \d+ more/);
    assert.doesNotMatch(frame, /Current:\s*Local/);

    const hasOpenAI = frame.includes("OpenAI");
    const hasAnthropic = frame.includes("Anthropic");
    const hasAntigravity = frame.includes("Antigravity");
    const hasLocal = frame.includes("Local");
    assert.equal(hasOpenAI && hasAnthropic && hasAntigravity && hasLocal, true);
    assert.doesNotMatch(frame, /Google/);
  } finally {
    await harness.cleanup();
  }
});

test("ProviderPicker keeps each selected provider visible at normal size", async () => {
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4-mini",
    workspaceConfig: { workspaceDefaultProviderId: "openai" },
  });
  const providerNames = ["OpenAI", "Anthropic", "Mistral Vibe", "Local", "Antigravity"];

  for (let i = 0; i < providerNames.length; i += 1) {
    const frame = await renderProviderPickerAtIndex({
      providers,
      selectedIndex: i,
    });

    assert.match(frame, new RegExp(providerNames[i]!));
    assertProviderOrder(frame, providerNames);
    assertSelectedProviderLine(frame, providerNames[i]!);
    assert.doesNotMatch(frame, /Showing \d+-\d+ of 5/);
  }
});

test("ProviderPicker cursor remains visible on Local and Antigravity", async () => {
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4-mini",
    workspaceConfig: { workspaceDefaultProviderId: "openai" },
  });

  const localFrame = await renderProviderPickerAtIndex({
    providers,
    selectedIndex: 3,
  });
  assertSelectedProviderLine(localFrame, "Local");

  const antigravityFrame = await renderProviderPickerAtIndex({
    providers,
    selectedIndex: 4,
  });
  assertSelectedProviderLine(antigravityFrame, "Antigravity");
});

test("ProviderPicker at wide standard size keeps selectable providers compact and contiguous", async () => {
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4-mini",
    workspaceConfig: { workspaceDefaultProviderId: "openai" },
  });
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(150, 30)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    const frame = getLatestBoxFrame(output);
    const providerNames = ["OpenAI", "Anthropic", "Mistral Vibe", "Local", "Antigravity"];

    for (const providerName of providerNames) {
      assert.match(frame, new RegExp(providerName));
    }
    assertProviderOrder(frame, providerNames);
    assertProviderRowsAreAdjacent(frame, providerNames);
    assert.doesNotMatch(frame, /Showing \d+-\d+ of 5/);
    assert.doesNotMatch(frame, /Google/);
    assert.doesNotMatch(frame, /↓ \d+ more|↑ \d+ more/);
    assert.doesNotMatch(frame, /Context/);
    assert.doesNotMatch(frame, /Tool/);
    assert.doesNotMatch(frame, /Strm/);
  } finally {
    await harness.cleanup();
  }
});

test("tiny ProviderPicker with many providers shows window range and overflow", async () => {
  const providers = Array.from({ length: 10 }, (_, index) => buildMockProvider({
    id: (index === 0 ? "openai" : `p${index + 1}`) as any,
    displayName: `Provider${index + 1}`,
  }));
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(120, 11)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    assert.match(output, /Showing \d+-\d+ of 10/);
    assert.match(output, /↓ (?:more|\d+ more)/);
    assert.match(output, /Provider1/);
    assert.ok(!output.includes("Provider10"));
  } finally {
    await harness.cleanup();
  }
});

test("tiny ProviderPicker windows around the selected provider and shows indicators", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "OpenAI" }),
    buildMockProvider({ id: "anthropic", displayName: "Anthropic" }),
    buildMockProvider({ id: "google", displayName: "Google" }),
    buildMockProvider({ id: "local", displayName: "Local" }),
    buildMockProvider({ id: "antigravity", displayName: "Antigravity" }),
  ];

  const frame = await renderProviderPickerAtIndex({
    providers,
    selectedIndex: 3,
    layout: createLayoutSnapshot(120, 11),
  });

  assert.match(frame, /Local/);
  assertSelectedProviderLine(frame, "Local");
  assert.match(frame, /Showing \d+-\d+ of 5/);
  assert.match(frame, /↑ (?:more|\d+ more)|↓ (?:more|\d+ more)/);
});

test("sliced provider order is contiguous and does not skip Anthropic", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "OpenAI" }),
    buildMockProvider({ id: "anthropic", displayName: "Anthropic" }),
    buildMockProvider({ id: "google", displayName: "Google" }),
    buildMockProvider({ id: "local", displayName: "ProviderFour" }),
    buildMockProvider({ id: "antigravity", displayName: "ProviderFive" }),
    buildMockProvider({ id: "p6" as any, displayName: "ProviderSix" }),
    buildMockProvider({ id: "p7" as any, displayName: "ProviderSeven" }),
    buildMockProvider({ id: "p8" as any, displayName: "ProviderEight" }),
    buildMockProvider({ id: "p9" as any, displayName: "ProviderNine" }),
    buildMockProvider({ id: "p10" as any, displayName: "ProviderTen" }),
  ];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(120, 40)}
        availableRows={7}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    const latestFrame = getLatestBoxFrame(output);

    assert.match(latestFrame, /OpenAI/);
    assert.match(latestFrame, /Anthropic/);
    assert.ok(latestFrame.indexOf("OpenAI") < latestFrame.indexOf("Anthropic"));
  } finally {
    await harness.cleanup();
  }
});

test("active provider is shown in a Current line when outside the visible slice", async () => {
  const providers = [
    buildMockProvider({ id: "openai", displayName: "ProviderOne" }),
    buildMockProvider({ id: "anthropic", displayName: "ProviderTwo" }),
    buildMockProvider({ id: "google", displayName: "ProviderThree" }),
    buildMockProvider({ id: "local", displayName: "ProviderFour" }),
    buildMockProvider({ id: "antigravity", displayName: "ProviderFive" }),
    buildMockProvider({ id: "p6" as any, displayName: "ProviderSix" }),
    buildMockProvider({ id: "p7" as any, displayName: "ProviderSeven" }),
    buildMockProvider({ id: "p8" as any, displayName: "ProviderEight" }),
    buildMockProvider({ id: "p9" as any, displayName: "ProviderNine" }),
    buildMockProvider({ id: "p10" as any, displayName: "ProviderTen", isActiveRoute: true }),
  ];
  const harness = createInkHarness(
    <ThemeProvider theme="purple">
      <ProviderPicker
        layout={createLayoutSnapshot(120, 13)}
        providers={providers}
        onAction={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>
  );

  try {
    await sleep(80);
    const output = harness.getOutput();
    assert.match(output, /Current: ProviderTen \/ gpt-5.4-mini/);
  } finally {
    await harness.cleanup();
  }
});
