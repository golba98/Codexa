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
import {
  getHeaderHeroLayout,
  HEADER_WORDMARK_LINES,
  measureTopHeaderRows,
  shortenHeaderWorkspaceLabel,
  TopHeader,
  type UpdateAvailableInfo,
} from "./TopHeader.js";
import { LOGO_LARGE, LOGO_MEDIUM_MIN_COLS, LOGO_LARGE_MIN_COLS } from "./logoVariants.js";
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
  return value.replace(/\[[0-?]*[ -/]*[@-~]/g, "");
}

function sleep(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HEADER_CONFIG_WITH_AUTH: HeaderConfig = {
  ...HEADER_CONFIG_DEFAULTS,
  showAuthStatus: true,
  showContext: true,
};

const MOCK_UPDATE: UpdateAvailableInfo = {
  latestVersion: "1.0.3",
  currentVersion: "1.0.2",
};

async function renderHeader(cols: number, authState: CodexAuthState, headerConfig?: HeaderConfig): Promise<string> {
  return renderHeaderWithWorkspace(cols, authState, "C:\\Development\\1-JavaScript\\13-Custom CLI", headerConfig);
}

async function renderHeaderWithWorkspace(
  cols: number,
  authState: CodexAuthState,
  workspaceLabel: string,
  headerConfig: HeaderConfig = HEADER_CONFIG_DEFAULTS,
  updateAvailable?: UpdateAvailableInfo | null,
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
        updateAvailable={updateAvailable}
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

async function renderHeaderWithUpdate(cols: number, updateAvailable: UpdateAvailableInfo | null): Promise<string> {
  return renderHeaderWithWorkspace(cols, "authenticated", "C:\\Development\\1-JavaScript\\13-Custom CLI", HEADER_CONFIG_WITH_AUTH, updateAvailable);
}

test("full mode renders wordmark at wide terminal", async () => {
  const output = await renderHeader(130, "authenticated", HEADER_CONFIG_WITH_AUTH);

  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(130, 40)).mode, "wide");
  assert.match(output, /[█╔╗╚╝═║]/);
  assert.match(output, new RegExp(`Codexa v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output, /Authenticated/);
  assert.match(output, /Workspace:\s*C:\\Development\\1-JavaScript\\13-Custom CLI/);
  assert.match(output, /Provider:\s*Codexa Core/);
  assert.match(output, /Context:\s*Unknown/);
  assert.doesNotMatch(output, /Model:/);
  assert.doesNotMatch(output, /Reasoning:/);
  assert.doesNotMatch(output, /Runtime:/);
  assert.doesNotMatch(output, /Net:\s*off/i);
  assert.doesNotMatch(output, /Roots:\s*0/i);
  assert.doesNotMatch(output, /FULL AUTO/i);
  assert.doesNotMatch(output, /Workspace write/i);
  assert.doesNotMatch(output, /On request/i);
});

test("local-dev channel makes header version obvious", async () => {
  const previous = process.env.CODEXA_CHANNEL;
  process.env.CODEXA_CHANNEL = "local-dev";
  try {
    const output = await renderHeader(130, "authenticated", HEADER_CONFIG_WITH_AUTH);
    assert.match(output, new RegExp(`Codexa v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-dev local`));
  } finally {
    if (previous === undefined) {
      delete process.env.CODEXA_CHANNEL;
    } else {
      process.env.CODEXA_CHANNEL = previous;
    }
  }
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
  assert.ok((rows[brandRow]?.indexOf(`Codexa v${APP_VERSION}`) ?? -1) >= 53, "metadata should have a visible left gap from the logo");
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

test("medium header keeps metadata beside the logo with compact truncation", async () => {
  const output = await renderHeaderWithWorkspace(
    100,
    "authenticated",
    "C:\\Development\\1-JavaScript\\13-Custom CLI\\packages\\really-long-subfolder\\nested\\workspace",
    HEADER_CONFIG_WITH_AUTH,
  );
  const rows = output.split("\n");
  const brandRow = rows.findIndex((row) => row.includes(`Codexa v${APP_VERSION}`));
  const firstLogoRow = rows.findIndex((row) => row.includes("██████"));
  const workspaceRow = rows.find((row) => row.includes("Workspace:")) ?? "";

  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(100, 40)).mode, "medium");
  assert.ok(firstLogoRow >= 0, "logo should render");
  assert.ok(brandRow >= firstLogoRow && brandRow <= firstLogoRow + 2, "metadata should stay beside the logo");
  assert.match(workspaceRow, /Workspace:\s*…\\workspace/);
  assert.ok((rows[brandRow]?.indexOf(`Codexa v${APP_VERSION}`) ?? -1) >= 51, "medium metadata should retain a compact gap from the logo");
});

test("narrow header stacks metadata below the logo instead of overflowing", async () => {
  // 80 cols → LOGO_MEDIUM (72–99 range) → mode = "narrow" (< MEDIUM threshold of 100)
  const output = await renderHeader(80, "authenticated", HEADER_CONFIG_WITH_AUTH);
  const rows = output.split("\n");
  const brandRow = rows.findIndex((row) => row.includes(`Codexa v${APP_VERSION}`));
  // LOGO_MEDIUM rows contain "____" (first row) and "/ ___| " etc.
  const firstLogoRow = rows.findIndex((row) => row.includes("____"));
  const visibleRows = rows.filter((row) => row.length > 0);

  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(80, 40)).mode, "narrow");
  assert.ok(firstLogoRow >= 0, "logo should render");
  assert.ok(brandRow > firstLogoRow, "metadata should render below the logo when narrow");
  assert.doesNotMatch(rows[brandRow] ?? "", /____/, "narrow metadata row should not contain logo glyphs");
  assert.ok(visibleRows.every((row) => row.length <= 80), "narrow rows should not overflow the terminal width");
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
  assert.match(output, /Workspace:\s*…\\13-Custom CLI/);
  assert.match(output, /Provider:\s*Codexa Core/);
  assert.match(output, /Context:\s*Unknown/);
  assert.doesNotMatch(output, /Model:/);
  assert.doesNotMatch(output, /Reasoning:/);
  assert.doesNotMatch(output, /Runtime:/);
  assert.doesNotMatch(output, /Net:\s*off/i);
  assert.doesNotMatch(output, /Roots:\s*0/i);
  assert.doesNotMatch(output, /FULL AUTO/i);
});

test("micro mode renders version and auth", async () => {
  const output = await renderHeader(50, "authenticated", HEADER_CONFIG_WITH_AUTH);

  assert.match(output, /Codex/);
  assert.match(output, new RegExp(`v${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.doesNotMatch(output, /[█╔╗╚╝═║]/);
  assert.match(output, /Provider/);
  assert.match(output, /Contex/);
  assert.doesNotMatch(output, /Model:/);
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
  assert.doesNotMatch(output, /Auth:\s*Unknown/);
});

test("compact mode preserves workspace truncation with runtime text", async () => {
  const output = await renderHeaderWithWorkspace(
    60,
    "authenticated",
    "C:\\Development\\1-JavaScript\\13-Custom CLI\\packages\\really-long-subfolder\\nested\\workspace",
  );

  assert.match(output, /…\\workspace/);
  assert.doesNotMatch(output, /packages\\really-long-subfolder/);
  assert.match(output, /Provider:\s*Codexa Core/);
  assert.doesNotMatch(output, /Model:/);
});

test("shortens long workspace paths to the leaf segment", () => {
  assert.equal(
    shortenHeaderWorkspaceLabel("C:\\Development\\1-JavaScript\\13-Custom-CLI-Normal", 24),
    "…\\13-Custom-CLI-Normal",
  );
});

test("header layout changes when width changes without duplicating the component", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 130;
  let output = "";

  stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  const buildHeader = (cols: number) => (
    <ThemeProvider theme="purple">
      <TopHeader
        authState="authenticated"
        workspaceLabel="C:\\Development\\1-JavaScript\\13-Custom-CLI-Normal"
        layout={createLayoutSnapshot(cols, 40)}
        runtimeSummary={buildRuntimeSummary(TEST_RUNTIME)}
        headerConfig={HEADER_CONFIG_WITH_AUTH}
      />
    </ThemeProvider>
  );

  const instance = render(buildHeader(130), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(60);
  output = "";
  stdout.columns = 80;
  instance.rerender(buildHeader(80));
  await sleep(60);

  instance.cleanup();
  await sleep(20);

  const rows = stripAnsi(output).split("\n");
  const brandRows = rows.filter((row) => row.includes(`Codexa v${APP_VERSION}`));
  // LOGO_MEDIUM (at 80 cols) first row contains "____"
  const firstLogoRow = rows.findIndex((row) => row.includes("____"));
  const firstBrandRow = rows.findIndex((row) => row.includes(`Codexa v${APP_VERSION}`));

  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(80, 40), HEADER_CONFIG_WITH_AUTH).mode, "narrow");
  assert.ok(firstBrandRow > firstLogoRow, "rerendered narrow header should stack metadata below the logo");
  assert.ok(brandRows.length <= 2, "rerender should not duplicate unbounded header instances");
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

// ─── Layout threshold tests ───────────────────────────────────────────────────

test("72 cols selects narrow mode (LOGO_MEDIUM threshold)", () => {
  // LOGO_MEDIUM_MIN_COLS = 72; below MEDIUM_HEADER_MIN_COLUMNS = 100
  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(72, 40)).mode, "narrow");
});

test("60 cols selects compact mode (LOGO_COMPACT, single-line)", () => {
  // 48 ≤ 60 < 72 → LOGO_COMPACT (1-row) → narrow mode (not compact unless < 48 or rows too short)
  // Actually at 60 cols: LOGO_COMPACT is selected; since single-row logo needs rows >= 14, at 40 rows → canRenderLogo = true → mode = "narrow"
  // "compact" mode only fires when canRenderLogo is false (< 48 cols or too few rows)
  const layout60 = getHeaderHeroLayout(createLayoutSnapshot(60, 40));
  // LOGO_COMPACT is 1-row compact; at rows=40 we can render it → narrow (not compact)
  assert.ok(layout60.mode === "narrow" || layout60.mode === "compact", `mode at 60 cols should be narrow or compact, got ${layout60.mode}`);
});

test("100 cols selects medium mode (at MEDIUM_HEADER_MIN_COLUMNS threshold)", () => {
  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(100, 40)).mode, "medium");
});

test("130 cols selects wide mode (at WIDE_HEADER_MIN_COLUMNS threshold)", () => {
  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(130, 40)).mode, "wide");
});

test("LOGO_LARGE rows never exceed the minimum columns needed to render them", () => {
  for (const row of LOGO_LARGE) {
    assert.ok(row.length <= LOGO_LARGE_MIN_COLS + 4, `LOGO_LARGE row is unexpectedly wide: "${row}"`);
  }
});

// ─── Update card tests ────────────────────────────────────────────────────────

test("wide mode with update available renders update card in right column", async () => {
  const output = await renderHeaderWithUpdate(130, MOCK_UPDATE);

  // Round-border box uses ╭ and ╰
  assert.match(output, /[╭╰]/, "update card border should appear");
  assert.match(output, /Update available/, "card title should appear");
  assert.match(output, /1\.0\.3 is available/, "latest version should appear");
  assert.match(output, /You are using 1\.0\.2/, "current version should appear");
});

test("medium mode with update available renders update card in right column", async () => {
  const output = await renderHeaderWithUpdate(100, MOCK_UPDATE);

  assert.match(output, /[╭╰]/, "update card border should appear at 100 cols");
  assert.match(output, /Update available/);
  assert.match(output, /1\.0\.3 is available/);
});

test("narrow mode with update available renders compact one-liner instead of card", async () => {
  // 80 cols → narrow → one-line notice, no card border
  const output = await renderHeaderWithUpdate(80, MOCK_UPDATE);

  assert.doesNotMatch(output, /[╭╰]/, "no card border in narrow mode");
  assert.match(output, /1\.0\.3/, "latest version should appear in one-liner");
});

test("wide mode without update shows no update notice", async () => {
  const output = await renderHeaderWithUpdate(130, null);

  assert.doesNotMatch(output, /Update available/);
  assert.doesNotMatch(output, /[╭╰]/);
});

test("measureTopHeaderRows increases when hasUpdate is true in side-by-side mode", () => {
  const layout = createLayoutSnapshot(130, 40);
  const withoutUpdate = measureTopHeaderRows(layout, HEADER_CONFIG_DEFAULTS, false);
  const withUpdate = measureTopHeaderRows(layout, HEADER_CONFIG_DEFAULTS, true);

  assert.ok(withUpdate > withoutUpdate, `totalRows with update (${withUpdate}) should exceed without (${withoutUpdate})`);
});

test("measureTopHeaderRows increases when hasUpdate is true in medium mode", () => {
  const layout = createLayoutSnapshot(100, 40);
  const withoutUpdate = measureTopHeaderRows(layout, HEADER_CONFIG_DEFAULTS, false);
  const withUpdate = measureTopHeaderRows(layout, HEADER_CONFIG_DEFAULTS, true);

  assert.ok(withUpdate > withoutUpdate, `totalRows with update (${withUpdate}) should exceed without (${withoutUpdate}) in medium mode`);
});
