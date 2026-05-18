import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { ActivityIndicator } from "./ActivityIndicator.js";

class TestOutput extends PassThrough {
  readonly isTTY = true;
  columns = 120;
  rows = 40;
}

function renderIndicator(props: any): Promise<string> {
  const stdout = new TestOutput();
  let output = "";
  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  const instance = render(<ActivityIndicator {...props} />, { stdout });
  instance.unmount();
  return Promise.resolve(output);
}

test("idle state renders static subtle indicator", async () => {
  const output = await renderIndicator({ uiState: { kind: "IDLE" }, externalCliStatus: "idle" });
  assert.ok(output.includes("?"));
});

test("error state renders error indicator", async () => {
  const output = await renderIndicator({ uiState: { kind: "ERROR", turnId: 1, message: "err" } });
  assert.ok(output.includes("×"));
});

test("tool/action state renders action indicator", async () => {
  const output = await renderIndicator({ uiState: { kind: "SHELL_RUNNING", shellId: 1 } });
  assert.ok(output.includes("?"));
});

test("waiting/thinking state renders animated indicator frame", async () => {
  const output = await renderIndicator({ uiState: { kind: "THINKING", turnId: 1 } });
  assert.ok(output.includes("?"));
});

test("streaming state renders streaming indicator frame", async () => {
  const output = await renderIndicator({ uiState: { kind: "RESPONDING", turnId: 1 } });
  assert.ok(output.includes("?")); // first frame
});

test("provider loading renders animated indicator frame", async () => {
  const output = await renderIndicator({ uiState: { kind: "IDLE" }, externalCliStatus: "starting" });
  assert.ok(output.includes("?"));
});

test("provider failed renders error indicator", async () => {
  const output = await renderIndicator({ uiState: { kind: "IDLE" }, externalCliStatus: "failed" });
  assert.ok(output.includes("×"));
});
