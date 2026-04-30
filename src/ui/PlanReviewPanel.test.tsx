import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { buildPlanReviewRows, normalizePlanReviewMarkdown, PlanReviewPanel } from "./PlanReviewPanel.js";
import { ThemeProvider } from "./theme.js";

class TestInput extends PassThrough {
  readonly isTTY = true;

  setRawMode(): this {
    return this;
  }

  override resume(): this {
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
