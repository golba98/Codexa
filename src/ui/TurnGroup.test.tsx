import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import type { AssistantEvent, RunEvent, UIState, UserPromptEvent } from "../session/types.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";
import { ThemeProvider } from "./theme.js";
import { TurnGroup, resolveTurnRunPhase } from "./TurnGroup.js";

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

function makeRunningRun(turnId: number): RunEvent {
  return {
    id: 2,
    type: "run",
    createdAt: 2,
    startedAt: 2,
    durationMs: null,
    backendId: "codex-subprocess",
    backendLabel: "Codexa",
    runtime: TEST_RUNTIME,
    prompt: "Do work",
    thinkingLines: [],
    status: "running",
    summary: "Running",
    truncatedOutput: false,
    toolActivities: [],
    activity: [],
    touchedFileCount: 0,
    errorMessage: null,
    turnId,
  };
}

function makeUser(turnId: number): UserPromptEvent {
  return {
    id: 1,
    type: "user",
    createdAt: 1,
    prompt: "Do work",
    turnId,
  };
}

function makeAssistant(turnId: number, content: string): AssistantEvent {
  return {
    id: 3,
    type: "assistant",
    createdAt: 3,
    content,
    turnId,
  };
}

function renderTurnGroup(node: React.ReactElement) {
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
  });

  return {
    instance,
    readOutput: () => stripAnsi(output),
    resetOutput: () => {
      output = "";
    },
  };
}

test("unmounts thinking view before streaming view appears for the same turn", async () => {
  const turnId = 10;
  const user = makeUser(turnId);
  const run = makeRunningRun(turnId);
  const assistant = makeAssistant(turnId, "Streaming line");

  const harness = renderTurnGroup(
    <ThemeProvider theme="purple">
      <TurnGroup
        cols={120}
        turnIndex={1}
        user={user}
        run={run}
        assistant={null}
        opacity="active"
        question={null}
        runPhase="thinking"
        streamPreviewRows={8}
        streamMode="assistant-first"
      />
    </ThemeProvider>,
  );

  await sleep();
  let frame = harness.readOutput();
  assert.match(frame, /processing/i);

  harness.resetOutput();
  harness.instance.rerender(
    <ThemeProvider theme="purple">
      <TurnGroup
        cols={120}
        turnIndex={1}
        user={user}
        run={run}
        assistant={assistant}
        opacity="active"
        question={null}
        runPhase="streaming"
        streamPreviewRows={8}
        streamMode="assistant-first"
      />
    </ThemeProvider>,
  );

  await sleep();
  frame = harness.readOutput();
  assert.match(frame, /streaming/i);

  harness.instance.unmount();
});

test("renders progressive content updates during streaming", async () => {
  const turnId = 12;
  const user = makeUser(turnId);
  const run = makeRunningRun(turnId);

  const harness = renderTurnGroup(
    <ThemeProvider theme="purple">
      <TurnGroup
        cols={120}
        turnIndex={1}
        user={user}
        run={run}
        assistant={makeAssistant(turnId, "First chunk")}
        opacity="active"
        question={null}
        runPhase="streaming"
        streamPreviewRows={8}
        streamMode="assistant-first"
      />
    </ThemeProvider>,
  );

  await sleep();
  let frame = harness.readOutput();
  assert.match(frame, /first chunk/i);

  // Update with more content — should render incrementally
  harness.resetOutput();
  harness.instance.rerender(
    <ThemeProvider theme="purple">
      <TurnGroup
        cols={120}
        turnIndex={1}
        user={user}
        run={run}
        assistant={makeAssistant(turnId, "First chunk\nSecond chunk")}
        opacity="active"
        question={null}
        runPhase="streaming"
        streamPreviewRows={8}
        streamMode="assistant-first"
      />
    </ThemeProvider>,
  );

  await sleep();
  frame = harness.readOutput();
  assert.match(frame, /second chunk/i);

  harness.instance.unmount();
});

test("finalization with same content does not cause visual flash", async () => {
  const turnId = 13;
  const user = makeUser(turnId);
  const run = makeRunningRun(turnId);
  const content = "The response content stays the same";
  const assistant = makeAssistant(turnId, content);

  const harness = renderTurnGroup(
    <ThemeProvider theme="purple">
      <TurnGroup
        cols={120}
        turnIndex={1}
        user={user}
        run={run}
        assistant={assistant}
        opacity="active"
        question={null}
        runPhase="streaming"
        streamPreviewRows={8}
        streamMode="assistant-first"
      />
    </ThemeProvider>,
  );

  await sleep();
  let streamingFrame = harness.readOutput();
  assert.match(streamingFrame, /response content stays/i);

  // Transition to final with same content
  harness.resetOutput();
  harness.instance.rerender(
    <ThemeProvider theme="purple">
      <TurnGroup
        cols={120}
        turnIndex={1}
        user={user}
        run={{ ...run, status: "completed", durationMs: 800 }}
        assistant={assistant}
        opacity="active"
        question={null}
        runPhase="final"
        streamPreviewRows={8}
        streamMode="assistant-first"
      />
    </ThemeProvider>,
  );

  await sleep();
  let finalFrame = harness.readOutput();
  // Content should still be present — no flash/disappearance
  assert.match(finalFrame, /response content stays/i);
  assert.match(finalFrame, /complete/i);

  harness.instance.unmount();
});

test("resolves turn phases consistently across thinking, streaming, and final states", () => {
  const turnId = 5;
  const run = makeRunningRun(turnId);
  const assistant = makeAssistant(turnId, "Done");

  assert.equal(resolveTurnRunPhase(run, null, { kind: "THINKING", turnId }, turnId), "thinking");
  assert.equal(resolveTurnRunPhase(run, assistant, { kind: "RESPONDING", turnId }, turnId), "streaming");
  assert.equal(resolveTurnRunPhase({ ...run, status: "completed", durationMs: 100 }, assistant, { kind: "IDLE" }, turnId), "final");
});

test("snaps cleanly from streaming cursor view to completion view", async () => {
  const turnId = 11;
  const user = makeUser(turnId);
  const running = makeRunningRun(turnId);
  const assistant = makeAssistant(turnId, "Final response text");

  const harness = renderTurnGroup(
    <ThemeProvider theme="purple">
      <TurnGroup
        cols={120}
        turnIndex={2}
        user={user}
        run={running}
        assistant={assistant}
        opacity="active"
        question={null}
        runPhase="streaming"
        streamPreviewRows={6}
        streamMode="assistant-first"
      />
    </ThemeProvider>,
  );

  await sleep();
  let frame = harness.readOutput();
  assert.match(frame, /streaming/i);

  harness.resetOutput();
  harness.instance.rerender(
    <ThemeProvider theme="purple">
      <TurnGroup
        cols={120}
        turnIndex={2}
        user={user}
        run={{ ...running, status: "completed", durationMs: 1200 }}
        assistant={assistant}
        opacity="active"
        question={null}
        runPhase="final"
        streamPreviewRows={6}
        streamMode="assistant-first"
      />
    </ThemeProvider>,
  );

  await sleep();
  frame = harness.readOutput();
  assert.match(frame, /complete/i);
  assert.match(frame, /final response text/i);
  assert.doesNotMatch(frame, /streaming/i);

  harness.instance.unmount();
});
