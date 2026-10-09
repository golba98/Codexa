import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { render } from "ink";
import type React from "react";
import { getTextWidth } from "../../core/shared/text.js";
import type { ProviderUsageSnapshot } from "../../core/usage/types.js";
import type { UsageViewState } from "../../core/usage/usageService.js";
import { computeAppLayoutBudget, type PanelLayout, PanelLayoutContext } from "../layout.js";
import { ThemeProvider } from "../theme.js";
import { UsagePanel } from "./UsagePanel.js";

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
  constructor(
    public columns = 120,
    public rows = 40,
  ) {
    super();
  }
}

const NOW = Date.parse("2026-10-09T12:00:00Z");

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function sleep(ms = 40): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function snapshot(overrides: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot {
  return {
    providerId: "anthropic",
    providerLabel: "Claude Code",
    scopeKey: "claude",
    account: { label: "dev@example.com", plan: "Pro", authMethod: "claude.ai" },
    billingMode: "subscription",
    status: "available",
    retrievedAt: NOW - 1000,
    freshness: "live",
    source: "Claude Code SDK control request get_usage (experimental)",
    limits: [
      {
        id: "five",
        label: "Session limit (5-hour)",
        unit: "percent",
        usedPercent: 62,
        remainingPercent: 38,
        resetsAt: NOW + 2 * 3_600_000 + 15 * 60_000,
        state: "ok",
      },
      {
        id: "week",
        label: "Weekly limit (all models)",
        unit: "percent",
        usedPercent: 35,
        remainingPercent: 65,
        resetsAt: NOW + 2 * 86_400_000,
        state: "ok",
      },
    ],
    facts: [{ id: "extra", label: "Extra usage", value: "Off", tone: "muted" }],
    links: [{ label: "Usage", url: "https://claude.ai/settings/usage" }],
    ...overrides,
  };
}

function view(overrides: Partial<UsageViewState> = {}): UsageViewState {
  return {
    scopeKey: "claude",
    snapshot: snapshot(),
    origin: "live",
    inFlight: false,
    nextRefreshAt: 0,
    ...overrides,
  };
}

function harness(
  element: (handlers: { onRefresh: () => void; onClose: () => void }) => React.ReactElement,
  layout: PanelLayout = { mode: "regular", availableRows: 36, availableCols: 100 },
) {
  const stdin = new TestInput();
  const stdout = new TestOutput(layout.availableCols + 2, layout.availableRows + 4);
  let output = "";
  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  const calls = { refresh: 0, close: 0 };
  const instance = render(
    <ThemeProvider theme="purple">
      <PanelLayoutContext.Provider value={layout}>
        {element({
          onRefresh: () => {
            calls.refresh += 1;
          },
          onClose: () => {
            calls.close += 1;
          },
        })}
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
  return {
    stdin,
    calls,
    instance,
    lastFrame(): string {
      const frames = stripAnsi(output).split("\n");
      return frames.join("\n");
    },
    reset() {
      output = "";
    },
    async cleanup() {
      instance.unmount();
      instance.cleanup();
      await sleep(20);
    },
  };
}

test("renders the active provider's limits, account and controls", async () => {
  const h = harness((handlers) => (
    <UsagePanel
      focusId="usage-panel"
      view={view()}
      refreshAvailableAt={0}
      now={() => NOW}
      timeZone="UTC"
      {...handlers}
    />
  ));
  try {
    await sleep();
    const frame = h.lastFrame();
    assert.match(frame, /Usage · Claude Code/);
    assert.match(frame, /Account: dev@example\.com · Pro · claude\.ai · Subscription/);
    assert.match(frame, /Session limit \(5-hour\)/);
    assert.match(frame, /Session limit \(5-hour\) +█+░+ 62% used · resets in 2h 15m \(14:15\)/);
    assert.match(frame, /R refresh · Esc close/);
  } finally {
    await h.cleanup();
  }
});

test("R refreshes, Esc and q close", async () => {
  const h = harness((handlers) => (
    <UsagePanel
      focusId="usage-panel"
      view={view()}
      refreshAvailableAt={0}
      now={() => NOW}
      {...handlers}
    />
  ));
  try {
    await sleep();
    h.stdin.write("r");
    await sleep();
    assert.equal(h.calls.refresh, 1);
    h.stdin.write("q");
    await sleep();
    h.stdin.write("\u001b");
    await sleep(80);
    assert.equal(h.calls.close, 2);
  } finally {
    await h.cleanup();
  }
});

test("refresh is ignored while a request is in flight", async () => {
  const h = harness((handlers) => (
    <UsagePanel
      focusId="usage-panel"
      view={view({ inFlight: true })}
      refreshAvailableAt={0}
      now={() => NOW}
      {...handlers}
    />
  ));
  try {
    await sleep();
    h.stdin.write("r");
    h.stdin.write("R");
    await sleep();
    assert.equal(h.calls.refresh, 0);
    assert.match(h.lastFrame(), /Usage · Claude Code · refreshing…/);
    assert.match(h.lastFrame(), /Checking…/);
  } finally {
    await h.cleanup();
  }
});

test("refresh within the cooldown shows a countdown instead of contacting the provider", async () => {
  const h = harness((handlers) => (
    <UsagePanel
      focusId="usage-panel"
      view={view({ origin: "cached" })}
      refreshAvailableAt={NOW + 12_000}
      now={() => NOW}
      {...handlers}
    />
  ));
  try {
    await sleep();
    h.stdin.write("r");
    await sleep();
    assert.equal(h.calls.refresh, 0);
    assert.match(h.lastFrame(), /R in 12s/);
    assert.match(h.lastFrame(), /cached/);
  } finally {
    await h.cleanup();
  }
});

test("short terminals scroll with the arrow keys instead of overflowing", async () => {
  const layout: PanelLayout = { mode: "compact", availableRows: 8, availableCols: 60 };
  const groups = ["Gemini Models", "Claude and GPT models", "Image models", "Agent models"];
  const many = snapshot({
    limits: groups.flatMap((group, index) => [
      {
        id: `${index}w`,
        label: "Weekly Limit",
        group,
        unit: "percent" as const,
        usedPercent: 10,
        remainingPercent: 90,
      },
      {
        id: `${index}h`,
        label: "Five Hour Limit",
        group,
        unit: "percent" as const,
        usedPercent: 0,
        remainingPercent: 100,
      },
    ]),
  });
  const h = harness(
    (handlers) => (
      <UsagePanel
        focusId="usage-panel"
        view={view({ snapshot: many })}
        refreshAvailableAt={0}
        now={() => NOW}
        {...handlers}
      />
    ),
    layout,
  );
  try {
    await sleep();
    assert.match(h.lastFrame(), /↑\/↓ scroll/);
    assert.ok(!h.lastFrame().split("╭").at(-1)!.includes("Extra usage"));
    // The footer is pinned, so freshness stays visible while the body scrolls.
    assert.match(h.lastFrame(), /Checked just now/);
    for (let i = 0; i < 30; i += 1) h.stdin.write("\u001b[B");
    await sleep(80);
    assert.match(h.lastFrame().split("╭").at(-1)!, /Extra usage: Off/);
  } finally {
    await h.cleanup();
  }
});

test("narrow panels keep every line inside the border", async () => {
  const layout: PanelLayout = { mode: "compact", availableRows: 40, availableCols: 34 };
  const h = harness(
    (handlers) => (
      <UsagePanel
        focusId="usage-panel"
        view={view()}
        refreshAvailableAt={0}
        now={() => NOW}
        {...handlers}
      />
    ),
    layout,
  );
  try {
    await sleep();
    const lines = h
      .lastFrame()
      .split("\n")
      .filter((line) => line.includes("│"));
    assert.ok(lines.length > 5);
    for (const line of lines) assert.ok(getTextWidth(line) <= 36, line);
  } finally {
    await h.cleanup();
  }
});

function realLayout(cols: number, rows: number): PanelLayout {
  const budget = computeAppLayoutBudget({ cols, rows, headerRows: 1 });
  return {
    mode: budget.mode,
    availableRows: budget.activePanelRows,
    availableCols: budget.activePanelCols,
  };
}

for (const [cols, rows] of [
  [99, 22],
  [80, 24],
] as const) {
  test(`every Codex and Claude limit is visible without scrolling at ${cols}x${rows}`, async () => {
    const layout = realLayout(cols, rows);
    const claude = snapshot({
      limits: [
        {
          id: "a",
          label: "Session limit (5-hour)",
          unit: "percent",
          usedPercent: 62,
          remainingPercent: 38,
          resetsAt: NOW + 3_600_000,
        },
        {
          id: "b",
          label: "Weekly limit (all models)",
          unit: "percent",
          usedPercent: 35,
          remainingPercent: 65,
          resetsAt: NOW + 86_400_000,
        },
        {
          id: "c",
          label: "Weekly limit (Opus)",
          unit: "percent",
          usedPercent: 12,
          remainingPercent: 88,
          resetsAt: NOW + 86_400_000,
        },
        {
          id: "d",
          label: "Weekly limit (Sonnet)",
          unit: "percent",
          usedPercent: 100,
          remainingPercent: 0,
          resetsAt: NOW + 86_400_000,
          state: "exhausted",
        },
        {
          id: "e",
          label: "Weekly limit (Fable)",
          group: "Model-specific limits",
          unit: "percent",
          usedPercent: 18,
          remainingPercent: 82,
          resetsAt: NOW + 86_400_000,
        },
      ],
    });
    const h = harness(
      (handlers) => (
        <UsagePanel
          focusId="usage-panel"
          view={view({ snapshot: claude })}
          refreshAvailableAt={NOW + 20_000}
          now={() => NOW}
          timeZone="UTC"
          {...handlers}
        />
      ),
      layout,
    );
    try {
      await sleep();
      const frame = h.lastFrame().split("╭").at(-1) ?? "";
      for (const percent of ["62% used", "35% used", "12% used", "100% used", "18% used"]) {
        assert.match(
          frame,
          new RegExp(percent),
          `${percent} missing at ${cols}x${rows}:\n${frame}`,
        );
      }
      assert.ok(!frame.includes("scroll"), frame);
      assert.match(frame, /Checked just now/);
      assert.match(frame, /R in 20s · Esc close/);
    } finally {
      await h.cleanup();
    }
  });
}
