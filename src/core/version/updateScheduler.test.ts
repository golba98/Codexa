import assert from "node:assert/strict";
import test from "node:test";
import { createFakeClock, settle } from "../../test/fakeClock.js";
import type { UpdateCheckResult } from "./updateCheck.js";
import {
  computeNextCheckDelay,
  createUpdateCheckScheduler,
  DEFAULT_UPDATE_CHECK_POLICY,
  isEquivalentUpdateResult,
  isVerifiedUpdateResult,
  scheduleUnrefTimer,
  type UpdateCheckSchedulerDeps,
} from "./updateScheduler.js";

const MINUTE = 60_000;

function available(latestVersion = "0.1.11", currentVersion = "0.1.9"): UpdateCheckResult {
  return { status: "update-available", currentVersion, latestVersion, checkedAt: 1, source: "npm" };
}

function upToDate(version = "0.1.9"): UpdateCheckResult {
  return {
    status: "up-to-date",
    currentVersion: version,
    latestVersion: version,
    checkedAt: 1,
    source: "npm",
  };
}

function failed(errorMessage = "fetch failed"): UpdateCheckResult {
  return {
    status: "error",
    currentVersion: "0.1.9",
    latestVersion: null,
    errorMessage,
    checkedAt: 1,
    source: "npm",
  };
}

function queuedCheck(results: Array<UpdateCheckResult | Error>) {
  const calls: AbortSignal[] = [];
  const check = async (signal: AbortSignal) => {
    calls.push(signal);
    const next = results.shift();
    if (!next) throw new Error("unexpected extra check");
    if (next instanceof Error) throw next;
    return next;
  };
  return { check, calls };
}

function deferredCheck() {
  const pending: Array<{ signal: AbortSignal; resolve: (r: UpdateCheckResult) => void }> = [];
  const check = (signal: AbortSignal) =>
    new Promise<UpdateCheckResult>((resolve) => {
      pending.push({ signal, resolve });
    });
  return { check, pending };
}

function makeScheduler(
  clock: ReturnType<typeof createFakeClock>,
  overrides: Partial<UpdateCheckSchedulerDeps> & Pick<UpdateCheckSchedulerDeps, "check">,
) {
  const results: UpdateCheckResult[] = [];
  const scheduler = createUpdateCheckScheduler({
    onResult: (result) => results.push(result),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    random: () => 0,
    trace: () => {},
    ...overrides,
  });
  return { scheduler, results };
}

test("computeNextCheckDelay uses the 15 minute interval after a success", () => {
  assert.equal(DEFAULT_UPDATE_CHECK_POLICY.successIntervalMs, 15 * MINUTE);
  assert.equal(
    computeNextCheckDelay(DEFAULT_UPDATE_CHECK_POLICY, 0, () => 0),
    15 * MINUTE,
  );
});

test("computeNextCheckDelay backs off exponentially up to the maximum delay", () => {
  const delays = [1, 2, 3, 4, 5, 6, 7, 20].map((failures) =>
    computeNextCheckDelay(DEFAULT_UPDATE_CHECK_POLICY, failures, () => 0),
  );
  assert.deepEqual(delays, [
    30_000,
    60_000,
    120_000,
    240_000,
    480_000,
    15 * MINUTE,
    15 * MINUTE,
    15 * MINUTE,
  ]);
});

test("computeNextCheckDelay jitter only shortens the delay, never exceeding the cap", () => {
  const policy = DEFAULT_UPDATE_CHECK_POLICY;
  for (const failures of [0, 1, 3, 10]) {
    const base = computeNextCheckDelay(policy, failures, () => 0);
    const shortest = computeNextCheckDelay(policy, failures, () => 0.999999);
    assert.ok(shortest <= base);
    assert.ok(shortest >= Math.floor(base * (1 - policy.jitterRatio)));
  }
  assert.ok(computeNextCheckDelay(policy, 10, () => 0.5) <= policy.maxRetryDelayMs);
});

test("isVerifiedUpdateResult accepts only successful checks", () => {
  assert.equal(isVerifiedUpdateResult(available()), true);
  assert.equal(isVerifiedUpdateResult(upToDate()), true);
  assert.equal(isVerifiedUpdateResult(failed()), false);
  assert.equal(isVerifiedUpdateResult({ ...upToDate(), status: "unknown" }), false);
  assert.equal(isVerifiedUpdateResult(null), false);
});

test("isEquivalentUpdateResult ignores timestamps and source but not versions", () => {
  assert.equal(
    isEquivalentUpdateResult(available(), { ...available(), checkedAt: 99, source: "cache" }),
    true,
  );
  assert.equal(isEquivalentUpdateResult(available("0.1.11"), available("0.1.12")), false);
  assert.equal(isEquivalentUpdateResult(available(), upToDate()), false);
  assert.equal(isEquivalentUpdateResult(null, available()), false);
});

test("start checks immediately and re-arms the next check 15 minutes later", async () => {
  const clock = createFakeClock();
  const { check, calls } = queuedCheck([upToDate()]);
  const { scheduler, results } = makeScheduler(clock, { check });

  scheduler.start();
  await settle();

  assert.equal(calls.length, 1);
  assert.deepEqual(
    results.map((r) => r.status),
    ["up-to-date"],
  );
  assert.deepEqual(
    clock.pending().map((t) => t.ms),
    [15 * MINUTE],
  );
  assert.equal(scheduler.getSnapshot().nextCheckAt, 15 * MINUTE);
  scheduler.dispose();
});

test("start is idempotent and never creates a second polling loop", async () => {
  const clock = createFakeClock();
  const { check, calls } = queuedCheck([upToDate()]);
  const { scheduler } = makeScheduler(clock, { check });

  scheduler.start();
  scheduler.start();
  await settle();
  scheduler.start();

  assert.equal(calls.length, 1);
  assert.equal(clock.pending().length, 1);
  scheduler.dispose();
});

test("an update published during a running session is found by the periodic check", async () => {
  const clock = createFakeClock();
  const { check, calls } = queuedCheck([upToDate(), upToDate(), available("0.1.10")]);
  const { scheduler, results } = makeScheduler(clock, { check });

  scheduler.start();
  await settle();
  await clock.advance(15 * MINUTE);
  await clock.advance(15 * MINUTE);

  assert.equal(calls.length, 3);
  assert.deepEqual(
    results.map((r) => r.status),
    ["up-to-date", "up-to-date", "update-available"],
  );
  assert.equal(scheduler.getSnapshot().lastVerified?.latestVersion, "0.1.10");
  scheduler.dispose();
});

test("failed checks retry with bounded exponential backoff", async () => {
  const clock = createFakeClock();
  const { check } = queuedCheck(Array.from({ length: 8 }, () => failed()));
  const { scheduler } = makeScheduler(clock, { check });

  scheduler.start();
  await settle();
  const delays: number[] = [];
  for (let i = 0; i < 7; i++) {
    const [timer] = clock.pending();
    assert.ok(timer);
    delays.push(timer.ms);
    await clock.advance(timer.ms);
  }

  assert.deepEqual(delays, [30_000, 60_000, 120_000, 240_000, 480_000, 15 * MINUTE, 15 * MINUTE]);
  assert.equal(scheduler.getSnapshot().consecutiveFailures, 8);
  scheduler.dispose();
});

test("update checking recovers after the registry becomes available again", async () => {
  const clock = createFakeClock();
  const { check } = queuedCheck([failed("timeout"), failed("ENOTFOUND"), available(), failed()]);
  const { scheduler, results } = makeScheduler(clock, { check });

  scheduler.start();
  await settle();
  await clock.advance(30_000);
  await clock.advance(60_000);

  assert.equal(results.at(-1)?.status, "update-available");
  assert.equal(scheduler.getSnapshot().consecutiveFailures, 0);
  assert.equal(scheduler.getSnapshot().lastFailure, null);
  assert.deepEqual(
    clock.pending().map((t) => t.ms),
    [15 * MINUTE],
  );

  // A new failure after recovery starts the backoff from the beginning again.
  await clock.advance(15 * MINUTE);
  assert.deepEqual(
    clock.pending().map((t) => t.ms),
    [30_000],
  );
  scheduler.dispose();
});

test("a failure after a detected update keeps the verified update in the snapshot", async () => {
  const clock = createFakeClock();
  const { check } = queuedCheck([available(), failed("ECONNRESET")]);
  const { scheduler } = makeScheduler(clock, { check });

  scheduler.start();
  await settle();
  await clock.advance(15 * MINUTE);

  const snapshot = scheduler.getSnapshot();
  assert.equal(snapshot.lastVerified?.status, "update-available");
  assert.equal(snapshot.lastFailure?.errorMessage, "ECONNRESET");
  assert.equal(snapshot.consecutiveFailures, 1);
  scheduler.dispose();
});

test("malformed or unknown registry results are failures, never proof of being current", async () => {
  const clock = createFakeClock();
  const unknown: UpdateCheckResult = { ...upToDate(), status: "unknown", latestVersion: "banana" };
  const { check } = queuedCheck([unknown]);
  const { scheduler } = makeScheduler(clock, { check });

  scheduler.start();
  await settle();

  const snapshot = scheduler.getSnapshot();
  assert.equal(snapshot.lastVerified, null);
  assert.equal(snapshot.lastFailure?.status, "unknown");
  assert.equal(snapshot.consecutiveFailures, 1);
  assert.deepEqual(
    clock.pending().map((t) => t.ms),
    [30_000],
  );
  scheduler.dispose();
});

test("a thrown check becomes an error result and is retried instead of rejecting", async () => {
  const clock = createFakeClock();
  const { check } = queuedCheck([new Error("socket hang up"), upToDate()]);
  const { scheduler, results } = makeScheduler(clock, { check });

  const result = await scheduler.checkNow();
  assert.equal(result.status, "error");
  assert.equal(result.errorMessage, "socket hang up");
  assert.equal(results[0]?.status, "error");
  scheduler.dispose();
});

test("concurrent check requests share a single in-flight request", async () => {
  const clock = createFakeClock();
  const { check, pending } = deferredCheck();
  const { scheduler, results } = makeScheduler(clock, { check });

  scheduler.start();
  const first = scheduler.checkNow();
  const second = scheduler.checkNow();
  assert.equal(pending.length, 1);
  assert.equal(scheduler.getSnapshot().checking, true);

  const result = available();
  pending[0]?.resolve(result);
  assert.equal(await first, result);
  assert.equal(await second, result);
  assert.equal(results.length, 1);
  assert.equal(scheduler.getSnapshot().checking, false);
  assert.equal(clock.pending().length, 1);
  scheduler.dispose();
});

test("a manual check replaces the pending timer instead of adding another", async () => {
  const clock = createFakeClock();
  const { check, calls } = queuedCheck([upToDate(), available()]);
  const { scheduler } = makeScheduler(clock, { check });

  scheduler.start();
  await settle();
  await clock.advance(5 * MINUTE);
  await scheduler.checkNow();

  assert.equal(calls.length, 2);
  const timers = clock.pending();
  assert.equal(timers.length, 1);
  assert.equal(timers[0]?.at, 5 * MINUTE + 15 * MINUTE);
  scheduler.dispose();
});

test("manual checks before start never schedule follow-up polling", async () => {
  const clock = createFakeClock();
  const { check } = queuedCheck([available()]);
  const { scheduler, results } = makeScheduler(clock, { check });

  const result = await scheduler.checkNow();
  assert.equal(result.status, "update-available");
  assert.equal(results.length, 1);
  assert.equal(clock.pending().length, 0);
  scheduler.dispose();
});

test("dispose clears timers, aborts the in-flight request, and drops late results", async () => {
  const clock = createFakeClock();
  const { check, pending } = deferredCheck();
  const { scheduler, results } = makeScheduler(clock, { check });

  scheduler.start();
  const inFlight = pending[0];
  assert.ok(inFlight);
  scheduler.dispose();

  assert.equal(inFlight.signal.aborted, true);
  inFlight.resolve(available());
  await settle();

  assert.equal(results.length, 0);
  assert.equal(clock.pending().length, 0);
  assert.equal(scheduler.getSnapshot().disposed, true);

  const afterDispose = await scheduler.checkNow();
  assert.equal(afterDispose.status, "error");
  assert.equal(pending.length, 1);
  scheduler.start();
  assert.equal(pending.length, 1);
});

test("dispose cancels a scheduled check", async () => {
  const clock = createFakeClock();
  const { check, calls } = queuedCheck([upToDate()]);
  const { scheduler } = makeScheduler(clock, { check });

  scheduler.start();
  await settle();
  assert.equal(clock.pending().length, 1);
  scheduler.dispose();
  assert.equal(clock.pending().length, 0);
  await clock.advance(60 * MINUTE);
  assert.equal(calls.length, 1);
});

test("an onResult failure does not stop periodic checking", async () => {
  const clock = createFakeClock();
  const { check, calls } = queuedCheck([upToDate(), upToDate()]);
  const scheduler = createUpdateCheckScheduler({
    check,
    onResult: () => {
      throw new Error("listener blew up");
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    random: () => 0,
    trace: () => {},
  });

  scheduler.start();
  await settle();
  await clock.advance(15 * MINUTE);
  assert.equal(calls.length, 2);
  scheduler.dispose();
});

test("default timers are unref'd so polling never keeps the process alive", () => {
  const handle = scheduleUnrefTimer(() => {}, 15 * MINUTE) as { hasRef?: () => boolean };
  try {
    assert.equal(typeof handle.hasRef, "function");
    assert.equal(handle.hasRef?.(), false);
  } finally {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  }
});
