import assert from "node:assert/strict";
import test from "node:test";
import { createFakeExecutable, FAKE_STDIO_READER } from "../../test/fakeExecutable.js";
import {
  buildClaudeUsageSnapshot,
  CLAUDE_USAGE_ARGS,
  claudeCodeUsageAdapter,
  parseClaudeAuthIdentity,
  parseClaudeGetUsage,
} from "./claudeCodeUsage.js";
import type { UsageRequestContext } from "./types.js";

const NOW = Date.parse("2026-10-09T12:00:00Z");

function ctx(overrides: Partial<UsageRequestContext> = {}): UsageRequestContext {
  return {
    route: { providerId: "anthropic", modelId: "sonnet", backendKind: "claude-code-auth" },
    workspaceRoot: process.cwd(),
    scopeKey: "anthropic|claude-code-auth||",
    signal: new AbortController().signal,
    now: () => NOW,
    ...overrides,
  };
}

// Shape matches a live `get_usage` reply from Claude Code 2.1.295; values are synthetic.
function usageReply(
  rateLimits: Record<string, unknown> | null,
  extra: Record<string, unknown> = {},
) {
  return {
    session: { total_cost_usd: 0, total_api_duration_ms: 0, model_usage: {} },
    subscription_type: "max",
    rate_limits_available: rateLimits !== null,
    rate_limits: rateLimits,
    behaviors: null,
    ...extra,
  };
}

const WINDOWS = {
  five_hour: { utilization: 62, resets_at: "2026-10-09T14:15:00+00:00" },
  seven_day: { utilization: 35, resets_at: "2026-10-11T14:00:00+00:00" },
  seven_day_opus: null,
  seven_day_sonnet: { utilization: 100, resets_at: "2026-10-11T14:00:00+00:00" },
  model_scoped: [{ display_name: "Fable", utilization: 18, resets_at: "2026-10-12T09:00:00Z" }],
  extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 120, utilization: 2.4 },
  iguana_necktie: { utilization: 0, limit_dollars: 100 },
};

test("CLI args run a hook-free, tool-free host that never persists a session", () => {
  assert.ok(CLAUDE_USAGE_ARGS.includes("--no-session-persistence"));
  assert.ok(CLAUDE_USAGE_ARGS.includes("--strict-mcp-config"));
  const tools = CLAUDE_USAGE_ARGS.indexOf("--tools");
  assert.equal(CLAUDE_USAGE_ARGS[tools + 1], "");
  const settings = CLAUDE_USAGE_ARGS.indexOf("--settings");
  assert.deepEqual(JSON.parse(CLAUDE_USAGE_ARGS[settings + 1]!), { disableAllHooks: true });
});

test("parses documented windows, model-specific buckets and extra usage", () => {
  const parsed = parseClaudeGetUsage(usageReply(WINDOWS), NOW);
  assert.ok(parsed);
  assert.deepEqual(
    parsed.limits.map((limit) => [limit.label, limit.group, limit.usedPercent, limit.state]),
    [
      ["Session limit (5-hour)", undefined, 62, "ok"],
      ["Weekly limit (all models)", undefined, 35, "ok"],
      ["Weekly limit (Sonnet)", undefined, 100, "exhausted"],
      ["Weekly limit (Fable)", "Model-specific limits", 18, "ok"],
    ],
  );
  assert.equal(parsed.limits[0]?.resetsAt, Date.parse("2026-10-09T14:15:00Z"));
  // Currency amounts are never shown because their unit is not documented.
  assert.deepEqual(parsed.facts, [
    {
      id: "claude.extra_usage",
      label: "Extra usage",
      value: "On · 2% of monthly limit used",
      tone: undefined,
    },
  ]);
  assert.ok(!JSON.stringify(parsed).includes("iguana"));
});

test("unknown utilisation stays unknown and invalid resets are dropped", () => {
  const parsed = parseClaudeGetUsage(
    usageReply({ five_hour: { utilization: null, resets_at: "soon" } }),
    NOW,
  );
  assert.ok(parsed);
  assert.equal(parsed.limits[0]?.usedPercent, undefined);
  assert.equal(parsed.limits[0]?.resetsAt, undefined);
  assert.equal(parsed.limits[0]?.note, "Utilisation unavailable.");
});

test("subscription usage is available and reports the plan", () => {
  const snapshot = buildClaudeUsageSnapshot(
    ctx(),
    { loggedIn: true, authMethod: "claude.ai", email: "dev@example.com", subscriptionType: "max" },
    { ok: true, response: usageReply(WINDOWS) },
  );
  assert.equal(snapshot.status, "available");
  assert.equal(snapshot.billingMode, "subscription");
  assert.deepEqual(snapshot.account, {
    label: "dev@example.com",
    plan: "Max",
    authMethod: "claude.ai",
  });
});

test("API-key logins report plan limits as not applicable to that billing mode", () => {
  const snapshot = buildClaudeUsageSnapshot(
    ctx(),
    { loggedIn: true, authMethod: "apiKey" },
    { ok: true, response: usageReply(null, { subscription_type: null }) },
  );
  assert.equal(snapshot.status, "unsupported");
  assert.equal(snapshot.billingMode, "api");
  assert.equal(snapshot.limits.length, 0);
});

test("schema drift degrades instead of guessing", () => {
  const drift = buildClaudeUsageSnapshot(
    ctx(),
    { loggedIn: true },
    { ok: true, response: usageReply({ renamed_window: { pct: 40 } }) },
  );
  assert.equal(drift.status, "temporarily_unavailable");
  assert.match(drift.message ?? "", /experimental/);

  const unknownShape = buildClaudeUsageSnapshot(
    ctx(),
    { loggedIn: true },
    {
      ok: true,
      response: { something: "else" },
    },
  );
  assert.equal(unknownShape.status, "temporarily_unavailable");
});

test("signed-out Claude Code asks for authentication", () => {
  const snapshot = buildClaudeUsageSnapshot(ctx(), { loggedIn: false }, { ok: false, error: "x" });
  assert.equal(snapshot.status, "authentication_required");
});

test("auth identity parsing tolerates extra fields and rejects non-JSON", () => {
  assert.deepEqual(
    parseClaudeAuthIdentity(
      JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "a@b.c", orgId: "x" }),
    ),
    { loggedIn: true, authMethod: "claude.ai", email: "a@b.c", subscriptionType: undefined },
  );
  assert.equal(parseClaudeAuthIdentity("Not logged in"), null);
});

const FAKE_CLAUDE = `${FAKE_STDIO_READER}
const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify(scenario.auth));
  process.exit(scenario.auth.loggedIn ? 0 : 1);
}
log({ args });
if (scenario.stall) setInterval(() => {}, 1000);
send({ type: "system", subtype: "init", session_id: "s" });
onLine((message) => {
  log({ stdin: message });
  if (scenario.stall) return;
  if (message.type !== "control_request") return;
  const reply = (body) => send({ type: "control_response", response: { request_id: message.request_id, ...body } });
  if (message.request.subtype === "initialize") reply({ subtype: "success", response: {} });
  else if (message.request.subtype === "get_usage") {
    if (scenario.usageError) reply({ subtype: "error", error: scenario.usageError });
    else reply({ subtype: "success", response: scenario.usage });
  }
});
process.stdin.on("end", () => process.exit(0));
`;

function stdinMessages(log: unknown[]) {
  return log
    .map((entry) => (entry as { stdin?: { type: string; request?: { subtype: string } } }).stdin)
    .filter((entry) => entry !== undefined);
}

test("adapter retrieves usage via control requests only — no user message, no tools, no hooks", async () => {
  const fake = createFakeExecutable("claude", FAKE_CLAUDE, {
    auth: {
      loggedIn: true,
      authMethod: "claude.ai",
      email: "dev@example.com",
      subscriptionType: "pro",
    },
    usage: usageReply(WINDOWS, { subscription_type: "pro" }),
  });
  try {
    const snapshot = await claudeCodeUsageAdapter.fetch(
      ctx({ providerConfig: { claudeCommandPath: fake.path } }),
    );
    assert.equal(snapshot.status, "available");
    assert.equal(snapshot.account?.plan, "Pro");
    const log = fake.readLog();
    const sent = stdinMessages(log);
    assert.deepEqual(
      sent.map((message) => [message.type, message.request?.subtype]),
      [
        ["control_request", "initialize"],
        ["control_request", "get_usage"],
      ],
    );
    assert.ok(sent.every((message) => message.type !== "user"));
    const args = (log[0] as { args: string[] }).args;
    assert.deepEqual(args, [...CLAUDE_USAGE_ARGS]);
  } finally {
    fake.cleanup();
  }
});

test("adapter does not start a usage host when Claude Code is signed out", async () => {
  const fake = createFakeExecutable("claude", FAKE_CLAUDE, { auth: { loggedIn: false } });
  try {
    const snapshot = await claudeCodeUsageAdapter.fetch(
      ctx({ providerConfig: { claudeCommandPath: fake.path } }),
    );
    assert.equal(snapshot.status, "authentication_required");
    assert.equal(fake.readLog().length, 0);
  } finally {
    fake.cleanup();
  }
});

test("older Claude Code without get_usage is reported as unsupported", async () => {
  const fake = createFakeExecutable("claude", FAKE_CLAUDE, {
    auth: { loggedIn: true, authMethod: "claude.ai" },
    usageError: "get_usage is not supported in this context",
  });
  try {
    const snapshot = await claudeCodeUsageAdapter.fetch(
      ctx({ providerConfig: { claudeCommandPath: fake.path } }),
    );
    assert.equal(snapshot.status, "unsupported");
    assert.match(snapshot.message ?? "", /does not support usage requests/);
  } finally {
    fake.cleanup();
  }
});

test("adapter reports a failed usage request as temporarily unavailable", async () => {
  const fake = createFakeExecutable("claude", FAKE_CLAUDE, {
    auth: { loggedIn: true, authMethod: "claude.ai" },
    usageError: "usage endpoint returned 429",
  });
  try {
    const snapshot = await claudeCodeUsageAdapter.fetch(
      ctx({ providerConfig: { claudeCommandPath: fake.path } }),
    );
    assert.equal(snapshot.status, "temporarily_unavailable");
    assert.match(snapshot.message ?? "", /429/);
  } finally {
    fake.cleanup();
  }
});

test("adapter aborts a stalled Claude Code host", async () => {
  const fake = createFakeExecutable("claude", FAKE_CLAUDE, {
    auth: { loggedIn: true, authMethod: "claude.ai" },
    stall: true,
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  const started = Date.now();
  try {
    const snapshot = await claudeCodeUsageAdapter.fetch(
      ctx({ signal: controller.signal, providerConfig: { claudeCommandPath: fake.path } }),
    );
    assert.equal(snapshot.status, "temporarily_unavailable");
    assert.ok(Date.now() - started < 5000);
  } finally {
    fake.cleanup();
  }
});
