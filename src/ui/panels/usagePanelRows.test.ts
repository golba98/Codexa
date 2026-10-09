import assert from "node:assert/strict";
import test from "node:test";
import { getTextWidth } from "../../core/shared/text.js";
import type { ProviderUsageSnapshot } from "../../core/usage/types.js";
import type { UsageViewState } from "../../core/usage/usageService.js";
import {
  buildUsageFooterRows,
  buildUsagePanelRows,
  formatCheckedAgo,
  formatPercent,
  formatResetTime,
  renderUsageBar,
} from "./usagePanelRows.js";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const TZ = "UTC";

function snapshot(overrides: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot {
  return {
    providerId: "google",
    providerLabel: "Google (Antigravity)",
    scopeKey: "google",
    account: { authMethod: "Antigravity CLI sign-in" },
    billingMode: "subscription",
    status: "available",
    retrievedAt: NOW - 2_000,
    freshness: "live",
    source: "Antigravity CLI print-mode /usage and /credits",
    limits: [
      {
        id: "a",
        label: "Weekly Limit",
        group: "Gemini Models",
        unit: "percent",
        usedPercent: 10.8,
        remainingPercent: 89.2,
        resetsAt: NOW + 6 * 86_400_000 + 3_600_000,
        state: "ok",
      },
      {
        id: "b",
        label: "Five Hour Limit",
        group: "Gemini Models",
        unit: "percent",
        usedPercent: 100,
        remainingPercent: 0,
        resetsAt: NOW + 2 * 3_600_000 + 15 * 60_000,
        state: "exhausted",
      },
      {
        id: "c",
        label: "Weekly Limit",
        group: "Claude and GPT models",
        unit: "percent",
        note: "Quota unavailable.",
      },
    ],
    facts: [{ id: "credits", label: "G1 credits remaining", value: "0" }],
    links: [{ label: "G1 credits", url: "https://antigravity.google/g1-upgrade" }],
    ...overrides,
  };
}

function view(overrides: Partial<UsageViewState> = {}): UsageViewState {
  return {
    scopeKey: "google",
    snapshot: snapshot(),
    origin: "live",
    inFlight: false,
    nextRefreshAt: 0,
    ...overrides,
  };
}

const text = (rows: { text: string }[]) => rows.map((row) => row.text).join("\n");
const footerText = (v: UsageViewState, now = NOW, refreshAvailableAt = 0) =>
  text(
    buildUsageFooterRows(v, {
      width: 80,
      now,
      timeZone: TZ,
      refreshAvailableAt,
      scrollable: false,
    }),
  );

test("percentages avoid false precision at the extremes", () => {
  assert.equal(formatPercent(undefined), "Unavailable");
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(0.04), "<1%");
  assert.equal(formatPercent(89.156), "89%");
  assert.equal(formatPercent(99.96), ">99%");
  assert.equal(formatPercent(100), "100%");
});

test("bars fill proportionally and keep their width", () => {
  assert.equal(renderUsageBar(0, 10), "░░░░░░░░░░");
  assert.equal(renderUsageBar(60, 10), "██████░░░░");
  assert.equal(renderUsageBar(100, 10), "██████████");
});

test("reset and freshness times are relative plus absolute in the given zone", () => {
  assert.equal(
    formatResetTime(NOW + 2 * 3_600_000 + 15 * 60_000, NOW, TZ),
    "Resets in 2h 15m (14:15)",
  );
  assert.equal(formatResetTime(NOW + 3 * 86_400_000, NOW, TZ), "Resets in 3d 0h (Mon 12:00)");
  assert.equal(formatResetTime(NOW + 10 * 86_400_000, NOW, TZ), "Resets in 10d 0h (Oct 19 12:00)");
  assert.equal(formatResetTime(NOW - 1, NOW, TZ), "Reset due now");
  assert.equal(formatResetTime(undefined, NOW, TZ), undefined);
  assert.equal(formatCheckedAgo(NOW - 2_000, NOW), "just now");
  assert.equal(formatCheckedAgo(NOW - 42_000, NOW), "42s ago");
  assert.equal(formatCheckedAgo(NOW - 5 * 60_000, NOW), "5m ago");
});

test("absolute times follow the configured time zone", () => {
  const reset = Date.parse("2026-10-09T23:30:00Z");
  assert.equal(formatResetTime(reset, NOW, "UTC"), "Resets in 11h 30m (23:30)");
  // 12:00Z is already 10 Oct 01:00 in Auckland, so the reset falls on the same local day.
  assert.equal(formatResetTime(reset, NOW, "Pacific/Auckland"), "Resets in 11h 30m (12:30)");
  assert.equal(formatResetTime(reset, NOW, "America/New_York"), "Resets in 11h 30m (19:30)");
});

test("wide panels show one row per limit with bar, usage and reset", () => {
  const rows = buildUsagePanelRows(view(), { width: 95, now: NOW, timeZone: TZ }).map(
    (row) => row.text,
  );
  assert.equal(rows[0], "Gemini Models");
  assert.match(rows[1]!, /^ {2}Weekly Limit {5}█+░+ 11% used · resets in 6d 1h \(Oct 15 13:00\)$/);
  assert.match(
    rows[2]!,
    /^ {2}Five Hour Limit {2}█+ 100% used · limit reached · resets in 2h 15m \(14:15\)$/,
  );
  assert.equal(rows[3], "");
  assert.equal(rows[4], "Claude and GPT models");
  // Unknown buckets never get a bar.
  assert.equal(rows[5], "  Weekly Limit     Unavailable");
  assert.equal(rows[6], "    Quota unavailable.");
});

test("narrow panels split each limit over two rows", () => {
  const rows = buildUsagePanelRows(view(), { width: 40, now: NOW, timeZone: TZ }).map(
    (row) => row.text,
  );
  assert.equal(rows[1], "  Weekly Limit  11% used");
  assert.match(rows[2]!, /^ {4}█{1}░{11} resets in 6d 1h$/);
});

test("usage comes before account details", () => {
  const rows = buildUsagePanelRows(view(), { width: 95, now: NOW, timeZone: TZ }).map(
    (row) => row.text,
  );
  const firstLimit = rows.findIndex((row) => row.includes("% used"));
  const account = rows.findIndex((row) => row.startsWith("Account:"));
  assert.ok(firstLimit >= 0 && account > firstLimit);
  assert.equal(rows[account], "Account: Antigravity CLI sign-in · Subscription");
  assert.ok(rows.includes("G1 credits remaining: 0"));
});

test("no row exceeds the panel width, even at narrow sizes", () => {
  for (const width of [12, 24, 40, 60, 80, 120]) {
    const v = view({
      snapshot: snapshot({
        message: "Codex reports included usage is currently blocked for this account.",
        description:
          "Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens.",
      }),
      origin: "stale",
      lastError: "HTTP 429 Too Many Requests from the usage endpoint",
    });
    const rows = [
      ...buildUsagePanelRows(v, { width, now: NOW, timeZone: TZ }),
      ...buildUsageFooterRows(v, {
        width,
        now: NOW,
        timeZone: TZ,
        refreshAvailableAt: NOW + 9_000,
        scrollable: true,
      }),
    ];
    for (const row of rows) {
      assert.ok(getTextWidth(row.text) <= Math.max(12, width), `${width}: ${row.text}`);
    }
  }
});

test("the footer combines freshness and keys on one line when it fits", () => {
  assert.equal(footerText(view()), "Checked just now (11:59) · R refresh · Esc close");
  assert.equal(
    footerText(view({ origin: "cached" }), NOW, NOW + 12_000),
    "Checked just now (11:59) · cached · R in 12s · Esc close",
  );
  assert.equal(
    footerText(view({ inFlight: true })),
    "Checked just now (11:59) · Checking… · Esc close",
  );
  const narrow = buildUsageFooterRows(view(), {
    width: 30,
    now: NOW,
    timeZone: TZ,
    refreshAvailableAt: 0,
    scrollable: true,
  }).map((row) => row.text);
  assert.deepEqual(narrow, ["Checked just now (11:59)", "R refresh · ↑/↓ scroll · Esc …"]);
});

test("stale data is labelled and the failure is shown; cached data is never called live", () => {
  const stale = footerText(view({ origin: "stale", lastError: "HTTP 429" }), NOW + 60_000);
  assert.match(stale, /Checked 1m ago \(11:59\) · stale/);
  assert.match(stale, /Latest attempt failed: HTTP 429/);
  const live = footerText(view());
  assert.ok(!live.includes("cached") && !live.includes("stale"));
  assert.deepEqual(
    buildUsageFooterRows(view({ snapshot: null }), {
      width: 80,
      now: NOW,
      refreshAvailableAt: 0,
      scrollable: false,
    }).map((row) => row.text),
    ["R refresh · Esc close"],
  );
});

test("observed data says observed, not checked", () => {
  const output = footerText(
    view({ snapshot: snapshot({ freshness: "observed" }), origin: "cached" }),
  );
  assert.match(output, /^Observed just now/);
  assert.ok(!output.includes("cached"));
});

test("unsupported providers explain why first and show no fabricated metrics", () => {
  const rows = buildUsagePanelRows(
    view({
      snapshot: snapshot({
        providerLabel: "Mistral Vibe",
        billingMode: "unknown",
        status: "unsupported",
        limits: [],
        facts: [{ id: "f", label: "Vibe subscription budget", value: "Unavailable" }],
        message: "Mistral Vibe does not expose subscription usage.",
        account: undefined,
      }),
    }),
    { width: 80, now: NOW, timeZone: TZ },
  ).map((row) => row.text);
  assert.equal(rows[0], "Usage reporting is not supported for this provider.");
  assert.equal(rows[1], "Mistral Vibe does not expose subscription usage.");
  assert.ok(rows.includes("Account: Unavailable · Billing unknown"));
  assert.ok(!rows.join("\n").includes("%"));
});

test("local quota shows N/A and token-unit limits show counts", () => {
  const output = text(
    buildUsagePanelRows(
      view({
        snapshot: snapshot({
          providerLabel: "Local · LM Studio",
          billingMode: "local",
          freshness: "observed",
          account: undefined,
          limits: [
            {
              id: "ctx",
              label: "Context window (last request)",
              unit: "tokens",
              used: 8192,
              total: 32768,
              usedPercent: 25,
              remainingPercent: 75,
            },
          ],
          facts: [
            { id: "q", label: "Account quota", value: "N/A — local inference", tone: "muted" },
          ],
          links: undefined,
        }),
      }),
      { width: 80, now: NOW, timeZone: TZ },
    ),
  );
  assert.match(output, /█+░+ 8,192 \/ 32,768 tokens/);
  assert.match(output, /Account quota: N\/A — local inference/);
  assert.match(output, /Account: Unavailable · Local inference/);
});

test("an empty view says it is checking or has no data", () => {
  assert.equal(
    text(
      buildUsagePanelRows(view({ snapshot: null, origin: null, inFlight: true }), {
        width: 40,
        now: NOW,
      }),
    ),
    "Checking usage…",
  );
  assert.equal(
    text(buildUsagePanelRows(view({ snapshot: null, origin: null }), { width: 40, now: NOW })),
    "No usage data yet.",
  );
});

test("compact mode keeps only the essentials", () => {
  const output = text(
    buildUsagePanelRows(view({ snapshot: snapshot({ description: "Background." }) }), {
      width: 80,
      now: NOW,
      compact: true,
      timeZone: TZ,
    }),
  );
  assert.ok(!output.includes("https://"));
  assert.ok(!output.includes("Source:"));
  assert.ok(!output.includes("Background."));
});

test("provider descriptions follow the limits", () => {
  const rows = buildUsagePanelRows(
    view({ snapshot: snapshot({ description: "Models in a group share limits." }) }),
    { width: 80, now: NOW, timeZone: TZ },
  ).map((row) => row.text);
  const description = rows.indexOf("Models in a group share limits.");
  const firstLimit = rows.findIndex((row) => row.includes("% used"));
  assert.ok(firstLimit >= 0 && description > firstLimit);
});

test("long limit labels stay whole on wide panels and shrink on narrow ones", () => {
  const long = view({
    snapshot: snapshot({
      limits: [
        {
          id: "a",
          label: "Weekly limit (all models)",
          unit: "percent",
          usedPercent: 35,
          remainingPercent: 65,
        },
      ],
    }),
  });
  const wide = buildUsagePanelRows(long, { width: 95, now: NOW }).map((row) => row.text);
  assert.ok(wide.some((row) => row.startsWith("Weekly limit (all models)  █")));
  const narrow = buildUsagePanelRows(long, { width: 60, now: NOW }).map((row) => row.text);
  assert.ok(narrow.some((row) => row.startsWith("Weekly limit (all mo…  █")));
});

test("bars share one width so the columns line up", () => {
  const rows = buildUsagePanelRows(view(), { width: 76, now: NOW, timeZone: TZ })
    .map((row) => row.text)
    .filter((row) => row.includes("█") || row.includes("░"));
  const widths = new Set(rows.map((row) => (row.match(/[█░]+/)?.[0] ?? "").length));
  assert.equal(widths.size, 1, rows.join("\n"));
  for (const row of rows) assert.ok(getTextWidth(row) <= 76, row);
});
