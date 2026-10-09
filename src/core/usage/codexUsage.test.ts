import assert from "node:assert/strict";
import test from "node:test";
import { createFakeExecutable, FAKE_STDIO_READER } from "../../test/fakeExecutable.js";
import { withCodexAppServer } from "../codex/codexAppServerClient.js";
import { buildCodexUsageSnapshot, codexUsageAdapter, parseCodexRateLimits } from "./codexUsage.js";
import type { UsageRequestContext } from "./types.js";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const IN_2H = NOW / 1000 + 2 * 3600;
const IN_5D = NOW / 1000 + 5 * 86400;

function ctx(overrides: Partial<UsageRequestContext> = {}): UsageRequestContext {
  return {
    route: { providerId: "openai", modelId: "gpt", backendKind: "codex-cli-auth" },
    workspaceRoot: process.cwd(),
    scopeKey: "openai|codex-cli-auth|",
    signal: new AbortController().signal,
    now: () => NOW,
    ...overrides,
  };
}

// Shapes match a live `account/rateLimits/read` reply from codex-cli 0.162.0; values are synthetic.
function rateLimitSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    limitId: "codex",
    limitName: null,
    primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: IN_2H },
    secondary: { usedPercent: 48, windowDurationMins: 10080, resetsAt: IN_5D },
    credits: { hasCredits: false, unlimited: false, balance: "0" },
    planType: "plus",
    rateLimitReachedType: null,
    spendControlReached: false,
    ...overrides,
  };
}

const CHATGPT_ACCOUNT = {
  account: { type: "chatgpt", email: "dev@example.com", planType: "plus" },
  requiresOpenaiAuth: true,
  workspaceRouting: { chatgptAccountId: "acct-should-not-surface" },
};

test("parses primary and secondary windows with reset timestamps", () => {
  const parsed = parseCodexRateLimits(
    { ordinaryUsageAllowed: true, rateLimits: rateLimitSnapshot(), rateLimitsByLimitId: null },
    NOW,
  );
  assert.ok(parsed);
  assert.deepEqual(
    parsed.limits.map((limit) => [limit.label, limit.usedPercent, limit.remainingPercent]),
    [
      ["5-hour limit", 12, 88],
      ["Weekly limit", 48, 52],
    ],
  );
  assert.equal(parsed.limits[0]?.resetsAt, IN_2H * 1000);
  assert.equal(parsed.plan, "Plus");
  assert.deepEqual(parsed.facts, [{ id: "codex.credits", label: "Credits balance", value: "0" }]);
});

test("keeps multiple metered buckets separate and grouped", () => {
  const parsed = parseCodexRateLimits(
    {
      rateLimits: rateLimitSnapshot(),
      rateLimitsByLimitId: {
        codex: rateLimitSnapshot(),
        codex_other: rateLimitSnapshot({
          limitId: "codex_other",
          limitName: "GPT-5 Pro",
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: IN_2H },
          secondary: null,
        }),
      },
    },
    NOW,
  );
  assert.ok(parsed);
  assert.deepEqual(
    parsed.limits.map((limit) => [limit.group, limit.label, limit.state]),
    [
      ["codex", "5-hour limit", "ok"],
      ["codex", "Weekly limit", "ok"],
      ["GPT-5 Pro", "5-hour limit", "exhausted"],
    ],
  );
});

test("missing usage, invalid resets and reached limits are reported, not guessed", () => {
  const parsed = parseCodexRateLimits(
    {
      ordinaryUsageAllowed: false,
      rateLimits: rateLimitSnapshot({
        primary: { usedPercent: null, windowDurationMins: 300, resetsAt: "garbage" },
        secondary: null,
        rateLimitReachedType: "rate_limit_reached",
        credits: null,
      }),
    },
    NOW,
  );
  assert.ok(parsed);
  assert.equal(parsed.limits.length, 1);
  assert.equal(parsed.limits[0]?.usedPercent, undefined);
  assert.equal(parsed.limits[0]?.remainingPercent, undefined);
  assert.equal(parsed.limits[0]?.resetsAt, undefined);
  assert.match(parsed.notes.join(" "), /blocked/);
  assert.match(parsed.notes.join(" "), /limit has been reached/);
  assert.deepEqual(parsed.facts, []);
});

test("unrecognised rate-limit payloads are rejected", () => {
  assert.equal(parseCodexRateLimits(null, NOW), null);
  assert.equal(parseCodexRateLimits({ unexpected: true }, NOW), null);
});

test("subscription accounts show plan and email but never workspace routing ids", () => {
  const snapshot = buildCodexUsageSnapshot(ctx(), CHATGPT_ACCOUNT, {
    ok: true,
    result: { rateLimits: rateLimitSnapshot() },
  });
  assert.equal(snapshot.status, "available");
  assert.equal(snapshot.billingMode, "subscription");
  assert.deepEqual(snapshot.account, {
    label: "dev@example.com",
    plan: "Plus",
    authMethod: "ChatGPT",
  });
  assert.ok(!JSON.stringify(snapshot).includes("acct-should-not-surface"));
});

test("API-key and signed-out accounts are distinguished from subscription usage", () => {
  const apiKey = buildCodexUsageSnapshot(
    ctx(),
    { account: { type: "apiKey" }, requiresOpenaiAuth: true },
    { ok: false, error: "not available" },
  );
  assert.equal(apiKey.status, "unsupported");
  assert.equal(apiKey.billingMode, "api");
  assert.equal(apiKey.limits.length, 0);

  const signedOut = buildCodexUsageSnapshot(
    ctx(),
    { account: null, requiresOpenaiAuth: true },
    { ok: false, error: "unauthorized" },
  );
  assert.equal(signedOut.status, "authentication_required");
});

test("a failed rate-limit read keeps the account but reports the failure", () => {
  const snapshot = buildCodexUsageSnapshot(ctx(), CHATGPT_ACCOUNT, {
    ok: false,
    error: "Codex app-server request failed: 429 Too Many Requests",
  });
  assert.equal(snapshot.status, "temporarily_unavailable");
  assert.equal(snapshot.account?.plan, "Plus");
  assert.match(snapshot.message ?? "", /429/);
});

const FAKE_APP_SERVER = `${FAKE_STDIO_READER}
if (process.argv[2] !== "app-server") { process.exit(3); }
if (scenario.stall) { setInterval(() => {}, 1000); }
onLine((message) => {
  log({ method: message.method });
  if (scenario.stall) return;
  if (scenario.garbage && message.method !== "initialize") { process.stdout.write("not json\\n"); return; }
  send({ method: "configWarning", params: {} });
  // A server-initiated request whose id collides with ours must not be taken as a response.
  send({ id: message.id, method: "item/commandExecution/requestApproval", params: {} });
  if (message.method === "initialize") send({ id: message.id, result: { userAgent: "fake" } });
  else if (message.method === "account/read") send({ id: message.id, result: scenario.account });
  else if (message.method === "account/rateLimits/read") {
    if (scenario.rateLimitError) send({ id: message.id, error: { code: -32000, message: scenario.rateLimitError } });
    else send({ id: message.id, result: scenario.rateLimits });
  } else if (message.method === "model/list") {
    const page = message.params.cursor ? 2 : 1;
    send({ id: message.id, result: { data: [{ id: "m" + page }], nextCursor: page === 1 ? "next" : null } });
  } else send({ id: message.id, error: { message: "unexpected " + message.method } });
});
`;

test("adapter reads account and rate limits from a Codex app-server without starting a thread", async () => {
  const fake = createFakeExecutable("codex", FAKE_APP_SERVER, {
    account: CHATGPT_ACCOUNT,
    rateLimits: { ordinaryUsageAllowed: true, rateLimits: rateLimitSnapshot() },
  });
  try {
    const snapshot = await codexUsageAdapter.fetch(
      ctx({ providerConfig: { codexCommandPath: fake.path } }),
    );
    assert.equal(snapshot.status, "available");
    assert.equal(snapshot.limits.length, 2);
    const methods = fake.readLog().map((entry) => (entry as { method: string }).method);
    assert.deepEqual(methods, ["initialize", "account/read", "account/rateLimits/read"]);
  } finally {
    fake.cleanup();
  }
});

test("adapter reports a rate-limited usage read as temporarily unavailable", async () => {
  const fake = createFakeExecutable("codex", FAKE_APP_SERVER, {
    account: CHATGPT_ACCOUNT,
    rateLimitError: "usage endpoint returned 429",
  });
  try {
    const snapshot = await codexUsageAdapter.fetch(
      ctx({ providerConfig: { codexCommandPath: fake.path } }),
    );
    assert.equal(snapshot.status, "temporarily_unavailable");
    assert.match(snapshot.message ?? "", /429/);
  } finally {
    fake.cleanup();
  }
});

test("adapter reports invalid app-server output instead of crashing", async () => {
  const fake = createFakeExecutable("codex", FAKE_APP_SERVER, { garbage: true });
  try {
    const snapshot = await codexUsageAdapter.fetch(
      ctx({ providerConfig: { codexCommandPath: fake.path } }),
    );
    assert.equal(snapshot.status, "temporarily_unavailable");
    assert.match(snapshot.message ?? "", /Unable to parse/);
  } finally {
    fake.cleanup();
  }
});

test("adapter reports a missing executable as unavailable", async () => {
  const snapshot = await codexUsageAdapter.fetch(
    ctx({ providerConfig: { codexCommandPath: "/nonexistent/ubume-test/codex" } }),
  );
  assert.equal(snapshot.status, "temporarily_unavailable");
  assert.ok(snapshot.message);
});

test("app-server client times out and kills a stalled server", async () => {
  const fake = createFakeExecutable("codex", FAKE_APP_SERVER, { stall: true });
  const started = Date.now();
  try {
    await assert.rejects(
      withCodexAppServer(
        fake.path,
        { timeoutMs: 200, operation: "Codex usage check" },
        async () => 1,
      ),
      /Timed out waiting for Codex usage check after 200ms/,
    );
    assert.ok(Date.now() - started < 2000);
  } finally {
    fake.cleanup();
  }
});

test("app-server client honours abort signals", async () => {
  const fake = createFakeExecutable("codex", FAKE_APP_SERVER, { stall: true });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(
      withCodexAppServer(
        fake.path,
        { timeoutMs: 5000, signal: controller.signal, operation: "Codex usage check" },
        async () => 1,
      ),
      /canceled/,
    );
  } finally {
    fake.cleanup();
  }
});

test("app-server client correlates sequential requests and ignores notifications", async () => {
  const fake = createFakeExecutable("codex", FAKE_APP_SERVER, {});
  try {
    const pages = await withCodexAppServer(
      fake.path,
      { timeoutMs: 5000, operation: "Codex model discovery" },
      async (client) => {
        const first = (await client.request("model/list", { cursor: null })) as { data: unknown };
        const second = (await client.request("model/list", { cursor: "next" })) as {
          data: unknown;
        };
        return [first.data, second.data];
      },
    );
    assert.deepEqual(pages, [[{ id: "m1" }], [{ id: "m2" }]]);
  } finally {
    fake.cleanup();
  }
});

test("app-server client reports an early exit with stderr context", async () => {
  const fake = createFakeExecutable(
    "codex",
    'process.stderr.write("not logged in"); process.exit(1);',
  );
  try {
    await assert.rejects(
      withCodexAppServer(
        fake.path,
        { timeoutMs: 5000, operation: "Codex usage check" },
        async () => 1,
      ),
      /exited before Codex usage check completed \(code 1\)\. stderr: not logged in/,
    );
  } finally {
    fake.cleanup();
  }
});
