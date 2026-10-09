import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LEGACY_GOOGLE_MESSAGE } from "../providerLauncher/providerIdentity.js";
import {
  antigravityUsageAdapter,
  parseAgyCommandOutput,
  parseAgyCreditsData,
  parseAgyUsageData,
} from "./antigravityUsage.js";
import type { UsageRequestContext } from "./types.js";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const fixtureSource = fileURLToPath(
  new URL("../../test/fixtures/antigravityProvider.mjs", import.meta.url),
);

function ctx(overrides: Partial<UsageRequestContext> = {}): UsageRequestContext {
  return {
    route: { providerId: "google", modelId: "gemini-3.1-pro", backendKind: "antigravity-cli-auth" },
    workspaceRoot: process.cwd(),
    scopeKey: "google|antigravity-cli-auth|",
    signal: new AbortController().signal,
    now: () => NOW,
    ...overrides,
  };
}

async function withAgy<T>(mode: string, run: (path: string, logPath: string) => Promise<T>) {
  const root = mkdtempSync(join(tmpdir(), "ubume-agy-usage-"));
  const agy = join(root, "agy");
  const logPath = join(root, "log.jsonl");
  writeFileSync(agy, readFileSync(fixtureSource), { mode: 0o700 });
  writeFileSync(logPath, "");
  const previous = { mode: process.env.UBUME_TEST_AGY_USAGE, log: process.env.UBUME_TEST_AGY_LOG };
  process.env.UBUME_TEST_AGY_USAGE = mode;
  process.env.UBUME_TEST_AGY_LOG = logPath;
  try {
    return await run(agy, logPath);
  } finally {
    if (previous.mode === undefined) delete process.env.UBUME_TEST_AGY_USAGE;
    else process.env.UBUME_TEST_AGY_USAGE = previous.mode;
    if (previous.log === undefined) delete process.env.UBUME_TEST_AGY_LOG;
    else process.env.UBUME_TEST_AGY_LOG = previous.log;
    rmSync(root, { recursive: true, force: true });
  }
}

test("print-mode replies must be the requested local command and must not run a turn", () => {
  const ok = parseAgyCommandOutput(
    JSON.stringify({ status: "SUCCESS", num_turns: 0, command: { name: "usage", data: {} } }),
    "usage",
  );
  assert.equal(ok.ok, true);
  const prompt = parseAgyCommandOutput(
    JSON.stringify({ status: "SUCCESS", num_turns: 1, response: "Sure!" }),
    "usage",
  );
  assert.deepEqual(prompt, {
    ok: false,
    error: "Antigravity CLI treated the usage command as a prompt.",
  });
  assert.equal(parseAgyCommandOutput("nope", "usage").ok, false);
  assert.equal(
    parseAgyCommandOutput(
      JSON.stringify({ status: "SUCCESS", num_turns: 0, command: { name: "help", data: {} } }),
      "usage",
    ).ok,
    false,
  );
});

test("model groups stay separate and fractions become remaining percentages", () => {
  const limits = parseAgyUsageData(
    {
      groups: [
        {
          name: "Gemini Models",
          buckets: [
            {
              id: "g-w",
              name: "Weekly Limit Remaining",
              window: "weekly",
              remaining_fraction: 0.891562,
              reset_time: "2026-10-16T08:03:19Z",
            },
            {
              id: "g-5h",
              name: "Five Hour Limit Remaining",
              window: "5h",
              remaining_fraction: 0,
              reset_time: "2026-10-09T13:00:00Z",
            },
          ],
        },
        {
          name: "Claude and GPT models",
          buckets: [
            { id: "p-w", name: "Weekly Limit Remaining", window: "weekly", reset_time: "bad" },
          ],
        },
      ],
    },
    NOW,
  );
  assert.deepEqual(
    limits.map((limit) => [limit.group, limit.label, limit.windowMinutes, limit.state]),
    [
      ["Gemini Models", "Weekly Limit", 10080, "ok"],
      ["Gemini Models", "Five Hour Limit", 300, "exhausted"],
      ["Claude and GPT models", "Weekly Limit", 10080, undefined],
    ],
  );
  assert.ok(Math.abs((limits[0]?.remainingPercent ?? 0) - 89.1562) < 1e-9);
  assert.equal(limits[1]?.usedPercent, 100);
  assert.equal(limits[2]?.remainingPercent, undefined);
  assert.equal(limits[2]?.usedPercent, undefined);
  assert.equal(limits[2]?.resetsAt, undefined);
  assert.equal(limits[2]?.note, "Quota unavailable.");
});

test("credits keep zero as a real value and reject non-https upgrade links", () => {
  assert.deepEqual(
    parseAgyCreditsData({
      remaining_credits: 0,
      upgrade_uri: "https://antigravity.google/g1-upgrade",
    }),
    {
      fact: { id: "agy.credits", label: "G1 credits remaining", value: "0" },
      link: { label: "G1 credits", url: "https://antigravity.google/g1-upgrade" },
    },
  );
  assert.deepEqual(
    parseAgyCreditsData({ remaining_credits: "lots", upgrade_uri: "javascript:alert(1)" }),
    {
      link: undefined,
    },
  );
});

test("adapter reads quotas and credits through print-mode commands", async () => {
  await withAgy("ok", async (path, logPath) => {
    const snapshot = await antigravityUsageAdapter.fetch(
      ctx({ providerConfig: { antigravityCommandPath: path } }),
    );
    assert.equal(snapshot.status, "partial");
    assert.equal(snapshot.limits.length, 3);
    assert.deepEqual(snapshot.facts, [
      { id: "agy.credits", label: "G1 credits remaining", value: "250" },
    ]);
    assert.equal(snapshot.message, undefined);
    assert.match(snapshot.description ?? "", /models share a weekly limit/);
    const commands = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { args: string[] }).args.join(" "))
      .sort();
    assert.deepEqual(commands, [
      "-p /credits --output-format json",
      "-p /usage --output-format json",
    ]);
  });
});

test("adapter maps sign-in, missing quota and turn-running replies to explicit states", async () => {
  for (const [mode, status] of [
    ["auth", "authentication_required"],
    ["no-quota", "unsupported"],
    ["turns", "temporarily_unavailable"],
    ["garbage", "temporarily_unavailable"],
  ] as const) {
    await withAgy(mode, async (path) => {
      const snapshot = await antigravityUsageAdapter.fetch(
        ctx({ providerConfig: { antigravityCommandPath: path } }),
      );
      assert.equal(snapshot.status, status, mode);
      assert.equal(snapshot.limits.length, 0, mode);
    });
  }
});

test("a failed credits read keeps quota data and marks the snapshot partial", async () => {
  await withAgy("credits-fail", async (path) => {
    const snapshot = await antigravityUsageAdapter.fetch(
      ctx({ providerConfig: { antigravityCommandPath: path } }),
    );
    assert.equal(snapshot.status, "partial");
    assert.equal(snapshot.limits.length, 3);
    assert.deepEqual(snapshot.facts, [
      { id: "agy.credits", label: "G1 credits", value: "Unavailable", tone: "muted" },
    ]);
  });
});

test("legacy Gemini-CLI Google records report the migration instead of running agy", async () => {
  await withAgy("ok", async (path, logPath) => {
    const snapshot = await antigravityUsageAdapter.fetch(
      ctx({ googleMigrationRequired: true, providerConfig: { antigravityCommandPath: path } }),
    );
    assert.equal(snapshot.status, "unsupported");
    assert.equal(snapshot.message, LEGACY_GOOGLE_MESSAGE);
    assert.equal(readFileSync(logPath, "utf8"), "");
  });
});
