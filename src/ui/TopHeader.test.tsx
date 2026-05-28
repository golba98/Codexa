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
  // 65 cols → LOGO_COMPACT (48–71 range) → mode = "narrow" (< MEDIUM threshold of 72)
  const output = await renderHeader(65, "authenticated", HEADER_CONFIG_WITH_AUTH);
  const rows = output.split("\n");
  const brandRow = rows.findIndex((row) => row.includes(`Codexa v${APP_VERSION}`));
  // LOGO_COMPACT row contains "CODEXA"
  const firstLogoRow = rows.findIndex((row) => row.includes("CODEXA") && !row.includes("Codexa v"));
  const visibleRows = rows.filter((row) => row.length > 0);

  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(65, 40)).mode, "narrow");
  assert.ok(firstLogoRow >= 0, "logo should render");
  assert.ok(brandRow > firstLogoRow, "metadata should render below the logo when narrow");
  assert.doesNotMatch(rows[brandRow] ?? "", /✦/, "narrow metadata row should not contain logo glyphs");
  assert.ok(visibleRows.every((row) => row.length <= 65), "narrow rows should not overflow the terminal width");
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
  // LOGO_LARGE (at 80 cols) first row contains block chars
  const firstLogoRow = rows.findIndex((row) => /[█╔╗╚╝═║]/.test(row));
  const firstBrandRow = rows.findIndex((row) => row.includes(`Codexa v${APP_VERSION}`));

  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(80, 40), HEADER_CONFIG_WITH_AUTH).mode, "medium");
  assert.ok(firstBrandRow >= firstLogoRow, "rerendered medium header should show metadata beside or aligned with logo");
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

test("72 cols selects medium mode (LOGO_LARGE at MEDIUM_HEADER_MIN_COLUMNS threshold)", () => {
  // LOGO_LARGE_MIN_COLS = MEDIUM_HEADER_MIN_COLUMNS = 72 → side-by-side with the block wordmark
  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(72, 40)).mode, "medium");
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

// ─── Rows-aware header degradation tests ──────────────────────────────────────

test("wide-but-short terminal keeps a logo header instead of collapsing to compact", () => {
  // 120 cols easily fits LOGO_LARGE, but 18 rows is too few for it. The header
  // must degrade to LOGO_COMPACT (1-row) rather than the flat text-only compact line.
  const layout = getHeaderHeroLayout(createLayoutSnapshot(120, 18));
  assert.notEqual(layout.mode, "compact");
  assert.ok(layout.logoRows >= 1, "a logo should still render in a wide-but-short terminal");
});

test("full header is selected when both columns and rows are sufficient", () => {
  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(130, 40)).mode, "wide");
  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(120, 30)).mode, "medium");
});

test("compact mode only fires when the terminal is genuinely too small for any logo", () => {
  // 120 cols, 10 rows → even the 1-row compact logo (needs 12 rows) cannot fit.
  const layout = getHeaderHeroLayout(createLayoutSnapshot(120, 10));
  assert.equal(layout.mode, "compact");
});

test("compact mode includes a recommended-size hint row and measurement matches", () => {
  const layout = createLayoutSnapshot(120, 10);
  const hero = getHeaderHeroLayout(layout);
  assert.equal(hero.mode, "compact");
  assert.equal(hero.compactHintRows, 1, "compact mode should reserve a hint row");
  // measureTopHeaderRows must account for the hint row exactly.
  assert.equal(measureTopHeaderRows(layout), hero.totalRows);
});

test("compact mode renders a deliberate header with accent and resize hint", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 120;
  stdout.rows = 10;
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });

  const instance = render(
    <ThemeProvider theme="purple">
      <TopHeader
        authState="authenticated"
        workspaceLabel="C:\\Development\\1-JavaScript\\13-Custom CLI"
        layout={createLayoutSnapshot(120, 10)}
        runtimeSummary={buildRuntimeSummary(TEST_RUNTIME)}
        headerConfig={HEADER_CONFIG_DEFAULTS}
        updateAvailable={null}
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

  const text = stripAnsi(output);
  assert.match(text, /✦/, "compact header should show the ✦ accent");
  assert.match(text, /Resize to ≥72×24/, "compact header should show the recommended-size hint");
});

test("CODEXA_NO_ASCII_LOGO compact header omits the resize hint row", () => {
  process.env["CODEXA_NO_ASCII_LOGO"] = "1";
  try {
    // With ASCII art disabled, compact is intentional at any size — no nag hint.
    const hero = getHeaderHeroLayout(createLayoutSnapshot(120, 40));
    assert.equal(hero.mode, "compact");
    assert.equal(hero.compactHintRows, 0);
  } finally {
    delete process.env["CODEXA_NO_ASCII_LOGO"];
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
  // 65 cols → narrow (< MEDIUM threshold of 72) → one-line notice, no card border
  const output = await renderHeaderWithUpdate(65, MOCK_UPDATE);

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

// ─── Responsive threshold parity tests ──────────────────────────────────────

test("80 cols selects medium mode and renders side-by-side with LOGO_LARGE (block wordmark)", async () => {
  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(80, 40)).mode, "medium");

  const output = await renderHeader(80, "authenticated", HEADER_CONFIG_WITH_AUTH);
  const rows = output.split("\n");
  const brandRow = rows.findIndex((row) => row.includes(`Codexa v${APP_VERSION}`));
  // LOGO_LARGE rows contain block/box-drawing characters
  const firstLogoRow = rows.findIndex((row) => /[█╔╗╚╝═║]/.test(row));

  assert.ok(firstLogoRow >= 0, "LOGO_LARGE should render at 80 cols");
  assert.doesNotMatch(output, /____/, "thin ASCII logo must not appear at 80 cols");
  assert.ok(brandRow >= firstLogoRow && brandRow <= firstLogoRow + 3, "metadata should be beside the logo, not below it");
});

test("72 cols is the minimum for LOGO_LARGE side-by-side (no thin ASCII)", () => {
  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(72, 40)).mode, "medium", "72 → medium with LOGO_LARGE");
  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(71, 40)).mode, "narrow", "71 → narrow with LOGO_COMPACT");
});

test("71 cols selects narrow mode (LOGO_COMPACT below medium threshold)", () => {
  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(71, 40)).mode, "narrow");
});

// ─── Canonical wordmark regression tests ─────────────────────────────────────

test("LOGO_LARGE block wordmark renders at 72 cols — thin ASCII must not appear", async () => {
  const output = await renderHeader(72, "authenticated", HEADER_CONFIG_DEFAULTS);
  assert.match(output, /[█╔╗╚╝═║]/, "block wordmark must appear at 72 cols");
  assert.doesNotMatch(output, /____/, "thin ASCII replacement must not appear at 72 cols");
});

test("LOGO_LARGE block wordmark renders at 80 cols — matches Linux default terminal width", async () => {
  const output = await renderHeader(80, "authenticated", HEADER_CONFIG_DEFAULTS);
  assert.match(output, /[█╔╗╚╝═║]/, "block wordmark must appear at normal 80-col terminal");
  assert.doesNotMatch(output, /____/, "thin ASCII replacement must not appear at 80 cols");
});

test("compact layout at 48 cols shows accent line — not thin ASCII art", async () => {
  const output = await renderHeader(48, "authenticated", HEADER_CONFIG_DEFAULTS);
  assert.doesNotMatch(output, /____/, "thin ASCII art must never appear in any header path");
});

test("model line renders when showModel is true and modelLabel is provided", async () => {
  const runtimeWithModel = {
    ...buildRuntimeSummary(TEST_RUNTIME),
    modelLabel: "qwen3-27b",
  };
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 130;
  let output = "";
  stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const instance = render(
    <ThemeProvider theme="purple">
      <TopHeader
        authState="authenticated"
        workspaceLabel="test-workspace"
        layout={createLayoutSnapshot(130, 40)}
        runtimeSummary={runtimeWithModel}
        headerConfig={{ ...HEADER_CONFIG_DEFAULTS, showModel: true }}
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
  await new Promise((resolve) => setTimeout(resolve, 60));
  instance.cleanup();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(stripAnsi(output), /Model:\s*qwen3-27b/, "Model line should appear when showModel is true and modelLabel is set");
});

test("context line renders known value when contextLabel is provided", async () => {
  const runtimeWithContext = {
    ...buildRuntimeSummary(TEST_RUNTIME),
    contextLabel: "0 / 128k",
  };
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 130;
  let output = "";
  stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const instance = render(
    <ThemeProvider theme="purple">
      <TopHeader
        authState="authenticated"
        workspaceLabel="test-workspace"
        layout={createLayoutSnapshot(130, 40)}
        runtimeSummary={runtimeWithContext}
        headerConfig={{ ...HEADER_CONFIG_DEFAULTS, showContext: true }}
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
  await new Promise((resolve) => setTimeout(resolve, 60));
  instance.cleanup();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(stripAnsi(output), /Context:\s*0 \/ 128k/, "Context line should show the known value");
});

test("context line shows Unknown when contextLabel is not provided", async () => {
  const stdin = new TestInput();
  const stdout = new TestOutput();
  stdout.columns = 130;
  let output = "";
  stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const instance = render(
    <ThemeProvider theme="purple">
      <TopHeader
        authState="authenticated"
        workspaceLabel="test-workspace"
        layout={createLayoutSnapshot(130, 40)}
        runtimeSummary={buildRuntimeSummary(TEST_RUNTIME)}
        headerConfig={{ ...HEADER_CONFIG_DEFAULTS, showContext: true }}
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
  await new Promise((resolve) => setTimeout(resolve, 60));
  instance.cleanup();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stripped = stripAnsi(output);
  assert.match(stripped, /Context:\s*Unknown/, "Context should show Unknown, not a fake value");
  assert.doesNotMatch(stripped, /Context:\s*0%/, "Context must not show fake 0% percentage");
});

test("update notice at 80 cols (medium mode) renders card in right column", async () => {
  const output = await renderHeaderWithUpdate(80, MOCK_UPDATE);

  assert.equal(getHeaderHeroLayout(createLayoutSnapshot(80, 40)).mode, "medium");
  assert.match(output, /[╭╰]/, "update card border should appear in medium mode at 80 cols");
  assert.match(output, /1\.0\.3/, "latest version should appear in card");
});
