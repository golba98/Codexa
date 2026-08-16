import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { PanelLayoutContext } from "../layout.js";
import { ThemeProvider } from "../theme.js";
import { ResumePicker } from "./ResumePicker.js";

class TestInput extends PassThrough {
  readonly isTTY = true;
  setRawMode(): this { return this; }
  override resume(): this { return this; }
  override pause(): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }
}

class TestOutput extends PassThrough {
  readonly isTTY = true;
  columns = 100;
  rows = 22;
}

function sleep(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("ResumePicker lists metadata and resumes the selected conversation", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });
  let selected: string | null = null;
  const instance = render(
    <ThemeProvider theme="purple">
      <PanelLayoutContext.Provider value={{ mode: "compact", availableRows: 12, availableCols: 96 }}>
        <ResumePicker
          conversations={[{
            version: 1,
            id: "chat_one",
            title: "Fix provider picker",
            createdAt: "2026-08-16T10:00:00.000Z",
            updatedAt: "2026-08-16T10:00:00.000Z",
            providerId: "local",
            modelId: "qwen",
            backendKind: "local-openai-compatible",
            messageCount: 4,
          }]}
          onSelect={(id) => { selected = id; }}
          onCancel={() => {}}
        />
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
  try {
    await sleep();
    const text = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
    assert.match(text, /Fix provider picker/);
    assert.match(text, /qwen/);
    stdin.write("\r");
    await sleep();
    assert.equal(selected, "chat_one");
  } finally {
    instance.cleanup();
    await sleep(20);
  }
});
