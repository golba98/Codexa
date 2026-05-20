import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import type { CodexAuthState } from "../core/auth/codexAuth.js";
import { buildRuntimeSummary } from "../config/runtimeConfig.js";
import { TEST_RUNTIME } from "../test/runtimeTestUtils.js";
import { createLayoutSnapshot } from "./layout.js";
import { ThemeProvider } from "./theme.js";
import { TopHeader } from "./TopHeader.js";
import { APP_VERSION, formatWorkspaceDisplayPath, HEADER_CONFIG_DEFAULTS } from "../config/settings.js";
import type { HeaderConfig } from "../config/settings.js";

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

const HEADER_CONFIG_WITH_AUTH: HeaderConfig = { ...HEADER_CONFIG_DEFAULTS, showAuthStatus: true };

async function renderHeader(cols: number, authState: CodexAuthState, headerConfig?: HeaderConfig): Promise<string> {
  return renderHeaderWithWorkspace(cols, authState, "C:\\Development\\1-JavaScript\\13-Custom CLI", headerConfig);
}

async function renderHeaderWithWorkspace(
  cols: number,
  authState: CodexAuthState,
  workspaceLabel: string,
  headerConfig: HeaderConfig = HEADER_CONFIG_DEFAULTS,
): Promise<string> {
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
        workspaceLabel={workspaceLabel}
        layout={createLayoutSnapshot(cols, 40)}
        runtimeSummary={buildRuntimeSummary(TEST_RUNTIME)}
        headerConfig={headerConfig}
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
  const output = await renderHeader(130, "authenticated", HEADER_CONFIG_WITH_AUTH);

  assert.match(output, /[█╔╗╚╝═║]/);
  assert.match(output, new RegExp(`Codexa v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /Authenticated/);
  assert.match(output, /Workspace:\s*C:\\Development\\1-JavaScript\\13-Custom CLI/);
  assert.doesNotMatch(output, /Runtime:/);
  assert.doesNotMatch(output, /gpt-5\.4/i);
  assert.doesNotMatch(output, /Net:\s*off/i);
  assert.doesNotMatch(output, /Roots:\s*0/i);
  assert.doesNotMatch(output, /FULL AUTO/i);
  assert.doesNotMatch(output, /Workspace write/i);
  assert.doesNotMatch(output, /On request/i);
});

test("compact mode renders version and auth", async () => {
  const output = await renderHeader(105, "authenticated", HEADER_CONFIG_WITH_AUTH);

  assert.match(output, new RegExp(`v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /Authenticated/);
  assert.match(output, /C:\\Development\\1-JavaScript\\13-Custom CLI/);
  assert.doesNotMatch(output, /Runtime:/);
  assert.doesNotMatch(output, /gpt-5\.4/i);
  assert.doesNotMatch(output, /Net:\s*off/i);
  assert.doesNotMatch(output, /Roots:\s*0/i);
  assert.doesNotMatch(output, /FULL AUTO/i);
  assert.doesNotMatch(output, /[█╔╗╚╝═║]/);
});

test("micro mode renders version and auth", async () => {
  const output = await renderHeader(50, "authenticated");

  assert.match(output, /Codex/);
  assert.match(output, new RegExp(`v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.doesNotMatch(output, /[█╔╗╚╝═║]/);
  assert.doesNotMatch(output, /gpt-5\.4/i);
});

test("full mode always shows wordmark regardless of activity", async () => {
  const output = await renderHeader(180, "authenticated", HEADER_CONFIG_WITH_AUTH);

  assert.match(output, /[█╔╗╚╝═║]/);
  assert.match(output, new RegExp(`Codexa v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /Authenticated/);
  assert.match(output, /Workspace:\s*C:\\Development\\1-JavaScript\\13-Custom CLI/);
  assert.doesNotMatch(output, /Runtime:/);
});

test("full mode renders Checking for checking auth state", async () => {
  const output = await renderHeader(130, "checking", HEADER_CONFIG_WITH_AUTH);
  assert.match(output, /Checking/);
  assert.doesNotMatch(output, /Unknown/);
});

test("compact mode preserves workspace truncation without runtime text", async () => {
  const output = await renderHeaderWithWorkspace(
    60,
    "authenticated",
    "C:\\Development\\1-JavaScript\\13-Custom CLI\\packages\\really-long-subfolder\\nested\\workspace",
  );

  assert.match(output, /\.\.\. /);
  assert.match(output, /nested\\workspace/);
  assert.doesNotMatch(output, /packages\\really-long-subfolder/);
  assert.doesNotMatch(output, /gpt-5\.4/i);
});

test("renders configured workspace display labels", async () => {
  const workspaceRoot = "C:\\Development\\1-JavaScript\\13-Custom-CLI-Normal";

  const dirOutput = await renderHeaderWithWorkspace(
    130,
    "authenticated",
    formatWorkspaceDisplayPath(workspaceRoot, "dir"),
  );
  assert.match(dirOutput, /Workspace:\s*13-Custom-CLI-Normal/);

  const nameOutput = await renderHeaderWithWorkspace(
    130,
    "authenticated",
    formatWorkspaceDisplayPath(workspaceRoot, "name"),
  );
  assert.match(nameOutput, /Workspace:\s*Codexa/);

  const simpleOutput = await renderHeaderWithWorkspace(
    130,
    "authenticated",
    formatWorkspaceDisplayPath(workspaceRoot, "simple"),
  );
  assert.match(simpleOutput, /Workspace:\s*13-Custom-CLI-Normal/);
});
