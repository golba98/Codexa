import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { createLayoutSnapshot } from "./layout.js";
import { ThemeProvider } from "./theme.js";
import { TopHeader } from "./TopHeader.js";
import { APP_VERSION } from "../config/settings.js";

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

async function renderHeader(cols: number, authState: CodexAuthState): Promise<string> {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = cols;
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const instance = render(
    <ThemeProvider theme="purple">
      <TopHeader
        authState={authState}
        workspaceRoot={"C:\\Development\\1-JavaScript\\13-Custom CLI"}
        layout={createLayoutSnapshot(cols, 40)}
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

  await sleep(60);
  instance.cleanup();
  await sleep(20);

  return stripAnsi(output);
}

test("full mode renders wordmark at wide terminal", async () => {
  const output = await renderHeader(130, "authenticated");

  assert.match(output, /[█╔╗╚╝═║]/);
  assert.match(output, new RegExp(`Codexa v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /Authenticated/);
});

test("compact mode renders version and auth", async () => {
  const output = await renderHeader(80, "authenticated");

  assert.match(output, new RegExp(`Codexa v${APP_VERSION.replace(/\./g, "\\.")}`));
  assert.match(output, /Authenticated/);
  assert.doesNotMatch(output, /[█╔╗╚╝═║]/);
});

test("micro mode renders version and auth", async () => {
  const output = await renderHeader(50, "authenticated");

  assert.match(output, /Codexa/);
  assert.match(output, /Authenticat/);
  assert.doesNotMatch(output, /[█╔╗╚╝═║]/);
});

test("full mode always shows wordmark regardless of activity", async () => {
  const output = await renderHeader(130, "authenticated");

  assert.match(output, /[█╔╗╚╝═║]/);
  assert.match(output, new RegExp(`Codexa v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /Authenticated/);
});
