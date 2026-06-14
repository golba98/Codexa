import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import React from "react";
import { render } from "ink";
import type { TimelineEvent } from "../session/types.js";
import { createLayoutSnapshot } from "./layout.js";
import { ThemeProvider } from "./theme.js";
import { Timeline } from "./Timeline.js";

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
  columns = 100;
  rows = 30;
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function makeLongTranscript(): TimelineEvent[] {
  const content = Array.from({ length: 36 }, (_, index) => `line-${String(index).padStart(2, "0")}`).join("\n");
  return [
    { id: 1, type: "user", createdAt: 1, prompt: "print many lines", turnId: 1 },
    { id: 2, type: "assistant", createdAt: 2, content, contentChunks: [], turnId: 1 },
  ];
}

test("wheel mode: SGR wheel-up shows JumpToBottomBar with wheel hint", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });

  const instance = render(
    <ThemeProvider theme="purple">
      <Timeline
        staticEvents={makeLongTranscript()}
        activeEvents={[]}
        layout={createLayoutSnapshot(100, 30)}
        uiState={{ kind: "IDLE" }}
        viewportRows={8}
        verboseMode={false}
        mouseCapture={true}
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

  try {
    await sleep(100);
    const beforeWheel = output.length;

    // Send SGR mouse wheel-up event
    stdin.write("[<64;12;9M");
    await sleep(100);

    const frame = stripAnsi(output.slice(beforeWheel));
    assert.match(frame, /History \d+%/);
    assert.match(frame, /wheel↓\/End to bottom/);
  } finally {
    instance.unmount();
  }
});

test("wheel mode: End key after wheel-up hides JumpToBottomBar", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });

  const instance = render(
    <ThemeProvider theme="purple">
      <Timeline
        staticEvents={makeLongTranscript()}
        activeEvents={[]}
        layout={createLayoutSnapshot(100, 30)}
        uiState={{ kind: "IDLE" }}
        viewportRows={8}
        verboseMode={false}
        mouseCapture={true}
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

  try {
    await sleep(100);
    stdin.write("[<64;12;9M");
    await sleep(100);

    const beforeEnd = output.length;
    stdin.write("[F");
    await sleep(100);

    const endFrame = stripAnsi(output.slice(beforeEnd));
    assert.doesNotMatch(endFrame, /History \d+%/);
  } finally {
    instance.unmount();
  }
});

test("PageUp, End, and SGR wheel packets navigate the timeline through Ink input", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const instance = render(
    <ThemeProvider theme="purple">
      <Timeline
        staticEvents={makeLongTranscript()}
        activeEvents={[]}
        layout={createLayoutSnapshot(100, 30)}
        uiState={{ kind: "IDLE" }}
        viewportRows={8}
        verboseMode={false}
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

  try {
    await sleep(100);
    const beforePageUpLength = output.length;

    stdin.write("\u001b[5~");
    await sleep(100);

    const pageUpFrame = stripAnsi(output.slice(beforePageUpLength));
    assert.match(pageUpFrame, /History \d+%/);
    assert.match(pageUpFrame, /PageUp\/PageDown \| End: latest/);

    const beforeEndLength = output.length;
    stdin.write("\u001b[F");
    await sleep(100);

    const endFrame = stripAnsi(output.slice(beforeEndLength));
    assert.doesNotMatch(endFrame, /History \d+%/);

    const beforeWheelLength = output.length;
    stdin.write("\u001b[<64;12;9M");
    await sleep(100);

    const wheelFrame = stripAnsi(output.slice(beforeWheelLength));
    assert.match(wheelFrame, /History \d+%/);
  } finally {
    instance.unmount();
  }
});
