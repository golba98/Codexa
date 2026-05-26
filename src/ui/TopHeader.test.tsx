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
import { getHeaderHeroLayout, HEADER_WORDMARK_LINES, TopHeader } from "./TopHeader.js";
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

  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(130, 40)).mode, "wide");
  assert.match(output, /[█╔╗╚╝═║]/);
  assert.match(output, new RegExp(`Codexa v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /Authenticated/);
  assert.match(output, /Workspace:\s*C:\\Development\\1-JavaScript\\13-Custom CLI/);
  assert.match(output, /Provider:\s*Codexa Core/);
  assert.match(output, /Model:\s*gpt-5\.4/);
  assert.doesNotMatch(output, /Runtime:/);
  assert.doesNotMatch(output, /Net:\s*off/i);
  assert.doesNotMatch(output, /Roots:\s*0/i);
  assert.doesNotMatch(output, /FULL AUTO/i);
  assert.doesNotMatch(output, /Workspace write/i);
  assert.doesNotMatch(output, /On request/i);
});

test("wide header centers metadata beside the logo with a clear column gap", async () => {
  const output = await renderHeader(130, "authenticated", HEADER_CONFIG_WITH_AUTH);
  const rows = output.split("\n");
  const firstLogoRow = rows.findIndex((row) => row.includes("██████"));
  const brandRow = rows.findIndex((row) => row.includes(`Codexa v${APP_VERSION}`));
  const workspaceRow = rows.findIndex((row) => row.includes("Workspace:"));

  assert.ok(firstLogoRow >= 0, "logo should render");
  assert.ok(brandRow >= firstLogoRow && brandRow <= firstLogoRow + 2, "metadata should be vertically centered within the logo block");
  assert.equal(workspaceRow, brandRow + 2, "workspace should sit below auth in the metadata block");
  assert.ok((rows[brandRow]?.indexOf(`Codexa v${APP_VERSION}`) ?? -1) >= 55, "metadata should have a visible left gap from the logo");
});

test("version and workspace metadata rows have a visible gap between them", async () => {
  const output = await renderHeader(130, "authenticated", {
    ...HEADER_CONFIG_DEFAULTS,
    showProvider: false,
    showModel: false,
  });
  const rows = output.split("\n");
  const brandRow = rows.findIndex((row) => row.includes(`Codexa v${APP_VERSION}`));
  const workspaceRow = rows.findIndex((row) => row.includes("Workspace:"));

  assert.ok(brandRow >= 0, "brand line should render");
  assert.ok(workspaceRow > brandRow + 1, "workspace should not be immediately adjacent to version");
  assert.equal(workspaceRow, brandRow + 2, "workspace is exactly 2 rows below brand — 1 blank gap row separates them");
});

test("narrow full header stacks metadata below the logo instead of squeezing columns", async () => {
  const output = await renderHeader(110, "authenticated", HEADER_CONFIG_WITH_AUTH);
  const rows = output.split("\n");
  const brandRow = rows.findIndex((row) => row.includes(`Codexa v${APP_VERSION}`));
  const lastLogoRow = rows.findIndex((row) => row.includes("╚═════"));

  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(110, 40)).mode, "stacked");
  assert.ok(lastLogoRow >= 0, "logo should render");
  assert.ok(brandRow > lastLogoRow, "metadata should render below the logo when stacked");
  assert.doesNotMatch(rows[brandRow] ?? "", /[█╔╗╚╝═║]/, "stacked metadata row should not contain logo glyphs");
});

test("header wordmark lines never contain metadata text", () => {
  const wordmarkText = HEADER_WORDMARK_LINES.join("\n");

  assert.doesNotMatch(wordmarkText, /Codexa v/);
  assert.doesNotMatch(wordmarkText, /Workspace:/);
  assert.doesNotMatch(wordmarkText, /Auth:/);
});

test("compact mode renders version and auth", async () => {
  const output = await renderHeader(105, "authenticated", HEADER_CONFIG_WITH_AUTH);

  assert.match(output, /[█╔╗╚╝═║]/);
  assert.match(output, new RegExp(`v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /Authenticated/);
  assert.match(output, /C:\\Development\\1-JavaScript\\13-Custom CLI/);
  assert.match(output, /Provider:\s*Codexa Core/);
  assert.match(output, /Model:\s*gpt-5\.4/);
  assert.doesNotMatch(output, /Runtime:/);
  assert.doesNotMatch(output, /Net:\s*off/i);
  assert.doesNotMatch(output, /Roots:\s*0/i);
  assert.doesNotMatch(output, /FULL AUTO/i);
});

test("micro mode renders version and auth", async () => {
  const output = await renderHeader(50, "authenticated");

  assert.match(output, /Codex/);
  assert.match(output, new RegExp(`v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.doesNotMatch(output, /[█╔╗╚╝═║]/);
  assert.match(output, /gpt-5/i);
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

test("compact mode preserves workspace truncation with runtime text", async () => {
  const output = await renderHeaderWithWorkspace(
    60,
    "authenticated",
    "C:\\Development\\1-JavaScript\\13-Custom CLI\\packages\\really-long-subfolder\\nested\\workspace",
  );

  assert.match(output, /\.\.\. /);
  assert.match(output, /nested\\workspace/);
  assert.doesNotMatch(output, /packages\\really-long-subfolder/);
  assert.match(output, /gpt-5\.4/i);
});

test("renders configured workspace display labels", async () => {
  const workspaceRoot = "C:\\Development\\1-JavaScript\\13-Custom-CLI-Normal";

  const dirOutput = await renderHeaderWithWorkspace(
    130,
    "authenticated",
    formatWorkspaceDisplayPath(workspaceRoot, "dir"),
  );
  assert.match(dirOutput, /Workspace:\s*(?:.*\\)?13-Custom-CLI-Normal/);

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
  assert.match(simpleOutput, /Workspace:\s*(?:.*\\)?13-Custom-CLI-Normal/);
});
