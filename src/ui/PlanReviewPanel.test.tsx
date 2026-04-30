import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { Box, Text, render, useFocusManager } from "ink";
import { FOCUS_IDS } from "./focus.js";
import { PlanActionPicker } from "./PlanActionPicker.js";
import {
  buildPlanReviewDisplayRows,
  buildPlanReviewRows,
  clampPlanReviewScrollOffset,
  normalizePlanReviewMarkdown,
  PlanReviewPanel,
  selectPlanReviewViewport,
} from "./PlanReviewPanel.js";
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
  columns = 80;
  rows = 24;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderPlanPanel(planText: string, cols = 60): Promise<string> {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = cols;
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const instance = render(
    <ThemeProvider theme="purple">
      <PlanReviewPanel
        planText={planText}
        cols={cols}
        workspaceRoot="C:\\Development\\Project"
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

  await sleep(80);
  instance.cleanup();
  await sleep(20);
  return stripAnsi(output);
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
    getOutput() {
      return stripAnsi(output);
    },
    async cleanup() {
      instance.cleanup();
      await sleep(20);
    },
  };
}

function makeLongPlan(itemCount = 18): string {
  return [
    "Files:",
    ...Array.from({ length: itemCount }, (_, index) =>
      `- src/file-${index + 1}.ts Description for item ${index + 1}.`,
    ),
    "",
    "Steps:",
    ...Array.from({ length: itemCount }, (_, index) =>
      `${index + 1}. Complete implementation step ${index + 1}.`,
    ),
  ].join("\n");
}

function PlanReviewInteractionHarness({ initialFocus = "plan" }: { initialFocus?: "plan" | "actions" }) {
  const focusManager = useFocusManager();
  const didFocusInitial = React.useRef(false);
  const [selection, setSelection] = React.useState("none");
  const [cancelCount, setCancelCount] = React.useState(0);

  React.useEffect(() => {
    if (didFocusInitial.current) return;
    didFocusInitial.current = true;
    focusManager.focus(initialFocus === "plan" ? FOCUS_IDS.planReviewPanel : FOCUS_IDS.composer);
  }, [focusManager, initialFocus]);

  return (
    <ThemeProvider theme="purple">
      <Box flexDirection="column">
        <PlanReviewPanel
          planText={makeLongPlan()}
          cols={80}
          height={8}
          focusId={FOCUS_IDS.planReviewPanel}
          workspaceRoot="C:\\Development\\Project"
          onCancel={() => setCancelCount((count) => count + 1)}
          onFocusActions={() => focusManager.focus(FOCUS_IDS.composer)}
        />
        <PlanActionPicker
          hasPlanFile
          scrollablePlan
          onFocusPlan={() => focusManager.focus(FOCUS_IDS.planReviewPanel)}
          onSelect={(value) => setSelection(value)}
          onCancel={() => setCancelCount((count) => count + 1)}
        />
        <Text>{`selection:${selection}`}</Text>
        <Text>{`cancel:${cancelCount}`}</Text>
      </Box>
    </ThemeProvider>
  );
}

test("plan review markdown normalization converts bold section labels into headings", () => {
  const normalized = normalizePlanReviewMarkdown("**Files**\n- src/app.tsx\n\n**Steps**\n1. Wire the panel");

  assert.match(normalized, /## Files/);
  assert.match(normalized, /## Steps/);
  assert.doesNotMatch(normalized, /\*\*Files\*\*/);
  assert.doesNotMatch(normalized, /\*\*Steps\*\*/);
});

test("plan review rows hide workspace-root filesystem details", () => {
  const rows = buildPlanReviewRows(
    "**Files**\n- C:\\Development\\Project\\src\\app.tsx\n\nSteps:\n1. Keep the saved plan internal.",
    "C:\\Development\\Project",
  );
  const joined = JSON.stringify(rows);

  assert.match(joined, /src\/app\.tsx/);
  assert.doesNotMatch(joined, /C:\\\\Development/);
  assert.doesNotMatch(joined, /Path:/);
});

test("plan review panel wraps long lines inside the bordered panel", async () => {
  const longText = "This line should wrap cleanly inside the review panel instead of clipping horizontally past the right border where it would become unreadable.";
  const output = await renderPlanPanel(`Files:\n- src/core/board.py ${longText}`, 54);
  const lines = output.split("\n").filter((line) => line.includes("│"));

  assert.match(output, /Review Plan/);
  assert.match(output, /This line should wrap/);
  assert.match(output, /cleanly inside the review panel/);
  assert.doesNotMatch(output, new RegExp(longText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(lines.every((line) => line.length <= 58), "panel rows should stay close to the requested terminal width");
});

test("plan review viewport slices and clamps long plans", () => {
  const semanticRows = buildPlanReviewRows(makeLongPlan(10), "C:\\Development\\Project");
  const displayRows = buildPlanReviewDisplayRows(semanticRows, 60);
  const first = selectPlanReviewViewport(displayRows, 8, 0);
  const middle = selectPlanReviewViewport(displayRows, 8, 5);
  const last = selectPlanReviewViewport(displayRows, 8, 999);

  assert.equal(first.startRow, 1);
  assert.equal(first.visibleRows.length, 5);
  assert.equal(middle.startRow, 6);
  assert.equal(last.endRow, displayRows.length);
  assert.equal(last.scrollOffset, last.maxScrollOffset);
  assert.equal(clampPlanReviewScrollOffset(999, displayRows.length, 5), last.maxScrollOffset);
  assert.equal(clampPlanReviewScrollOffset(-10, displayRows.length, 5), 0);
});

test("plan review panel focuses reading first and scrolls before menu selection", async () => {
  const harness = createInkHarness(<PlanReviewInteractionHarness />);

  try {
    await sleep(80);
    harness.stdin.write("\r");
    await sleep(80);
    harness.stdin.write("\u001b[B");
    await sleep(80);
    harness.stdin.write("\u001b[6~");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /selection:none/);
    assert.match(output, /Plan 1–5 of/);
    assert.match(output, /Plan 2–6 of/);
    assert.match(output, /Plan 7–11 of/);
    assert.match(output, /↓ more/);
  } finally {
    await harness.cleanup();
  }
});

test("plan review menu focus keeps page keys on the plan and enter on the menu", async () => {
  const harness = createInkHarness(<PlanReviewInteractionHarness initialFocus="actions" />);

  try {
    await sleep(80);
    harness.stdin.write("\u001b[6~");
    await sleep(80);
    harness.stdin.write("\u001b[B");
    await sleep(80);
    harness.stdin.write("\r");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /Tab switches focus\. PageUp\/PageDown scroll plan\. Enter confirms\./);
    assert.match(output, /Plan 6–10 of/);
    assert.match(output, /selection:revise/);
  } finally {
    await harness.cleanup();
  }
});

test("plan review escape cancels from panel focus", async () => {
  const harness = createInkHarness(<PlanReviewInteractionHarness />);

  try {
    await sleep(80);
    harness.stdin.write("\u001b");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /cancel:1/);
  } finally {
    await harness.cleanup();
  }
});

test("plan review escape cancels from menu focus", async () => {
  const harness = createInkHarness(<PlanReviewInteractionHarness initialFocus="actions" />);

  try {
    await sleep(80);
    harness.stdin.write("\u001b");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /cancel:1/);
  } finally {
    await harness.cleanup();
  }
});
