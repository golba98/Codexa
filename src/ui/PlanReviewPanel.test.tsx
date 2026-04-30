import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { Box, Text, render } from "ink";
import { PlanActionPicker } from "./PlanActionPicker.js";
import { normalizePlanReviewMarkdown } from "../core/planStorage.js";
import {
  buildPlanReviewDisplayRows,
  buildPlanReviewRows,
  PlanReviewPanel,
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

async function renderPlanPanel(planText: string, cols = 80): Promise<string> {
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

function makeLongPlan(itemCount = 40): string {
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

function PlanActionHarness({ hasPlanFile = true }: { hasPlanFile?: boolean }) {
  const [selection, setSelection] = React.useState("none");
  const [cancelCount, setCancelCount] = React.useState(0);

  return (
    <ThemeProvider theme="purple">
      <Box flexDirection="column">
        <PlanActionPicker
          hasPlanFile={hasPlanFile}
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

test("plan review display rows wrap long lines inside the panel width", () => {
  const longText = "This line should wrap cleanly inside the review panel instead of clipping horizontally past the right border where it would become unreadable.";
  const semanticRows = buildPlanReviewRows(`Files:\n- src/core/board.py ${longText}`);
  const displayRows = buildPlanReviewDisplayRows(semanticRows, 34);
  const joined = displayRows.map((row) => row.text).join("\n");

  assert.match(joined, /This line/);
  assert.match(joined, /should wrap cleanly/);
  assert.match(joined, /instead of clipping/);
  assert.ok(
    displayRows.every((row) => row.text.length <= 34),
    "wrapped rows should stay within the requested content width",
  );
});

test("plan review panel renders the full long plan instead of a clipped row range", async () => {
  const output = await renderPlanPanel(makeLongPlan(40), 100);

  assert.match(output, /Review Plan/);
  assert.match(output, /src\/file-1\.ts/);
  assert.match(output, /src\/file-20\.ts/);
  assert.match(output, /src\/file-40\.ts/);
  assert.match(output, /40\. Complete implementation step 40\./);
  assert.doesNotMatch(output, /Plan \d+[-–]\d+ of \d+/);
  assert.doesNotMatch(output, /PageUp\/PageDown scroll plan/);
  assert.doesNotMatch(output, /C:\\Development/);
});

test("plan action picker keeps simple menu navigation and enter selection", async () => {
  const harness = createInkHarness(<PlanActionHarness />);

  try {
    await sleep(80);
    harness.stdin.write("\u001b[B");
    await sleep(80);
    harness.stdin.write("\r");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /Plan review/);
    assert.match(output, /Enter confirm\s+Up\/Down move\s+Esc cancel/);
    assert.match(output, /selection:revise/);
  } finally {
    await harness.cleanup();
  }
});

test("plan action picker supports focused hotkeys and escape cancellation", async () => {
  const harness = createInkHarness(<PlanActionHarness />);

  try {
    await sleep(80);
    harness.stdin.write("v");
    await sleep(80);
    harness.stdin.write("\u001b");
    await sleep(80);

    const output = harness.getOutput();
    assert.match(output, /selection:view_plan_file/);
    assert.match(output, /cancel:1/);
  } finally {
    await harness.cleanup();
  }
});
