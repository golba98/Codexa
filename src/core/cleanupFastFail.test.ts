import assert from "node:assert/strict";
import test from "node:test";
import type { RunToolActivity } from "../session/types.js";
import { getBlockedCleanupFailure } from "./cleanupFastFail.js";

function activity(overrides: Partial<RunToolActivity>): RunToolActivity {
  return {
    id: "tool-1",
    command: "Remove-Item -Recurse __pycache__",
    status: "failed",
    startedAt: 1,
    completedAt: 2,
    ...overrides,
  };
}

test("reports access-denied Remove-Item cleanup failures", () => {
  const result = getBlockedCleanupFailure(activity({
    summary: "Access to the path 'C:\\repo\\__pycache__\\mod.pyc' is denied.",
  }));

  assert.match(result ?? "", /access denied/i);
  assert.match(result ?? "", /C:\\repo\\__pycache__\\mod\.pyc/);
  assert.match(result ?? "", /stopped/i);
});

test("reports generic POSIX and node locked delete failures", () => {
  for (const summary of [
    "rm: cannot remove 'tests/__pycache__/case.pyc': Permission denied",
    "EPERM: operation not permitted, unlink 'tests/__pycache__/case.pyc'",
    "EACCES: permission denied, rmdir 'tests/__pycache__'",
    "EBUSY: resource busy or locked, unlink 'tests/__pycache__/case.pyc'",
    "The process cannot access the file because it is being used by another process: 'tests/__pycache__/case.pyc'",
  ]) {
    const result = getBlockedCleanupFailure(activity({
      command: "rm -rf tests/__pycache__",
      summary,
    }));

    assert.ok(result, `Expected blocked cleanup failure for: ${summary}`);
    assert.match(result, /blocked|denied|locked|busy/i);
  }
});

test("reports git and generic lock artifacts during delete failures", () => {
  const gitLock = getBlockedCleanupFailure(activity({
    command: "Remove-Item -LiteralPath .git\\config.lock",
    summary: "Access to the path '.git\\config.lock' is denied.",
  }));
  const genericLock = getBlockedCleanupFailure(activity({
    command: "del cache.lock",
    summary: "EPERM: operation not permitted, unlink 'cache.lock'",
  }));

  assert.match(gitLock ?? "", /lock artifact/i);
  assert.match(gitLock ?? "", /\.git\\config\.lock/i);
  assert.match(genericLock ?? "", /lock artifact/i);
  assert.match(genericLock ?? "", /cache\.lock/i);
});

test("ignores non-delete failures and non-failed activities", () => {
  assert.equal(getBlockedCleanupFailure(activity({
    command: "git status",
    summary: "fatal: Unable to create '.git/config.lock': File exists.",
  })), null);

  assert.equal(getBlockedCleanupFailure(activity({
    status: "completed",
    summary: "Access to the path 'x.pyc' is denied.",
  })), null);

  assert.equal(getBlockedCleanupFailure(activity({
    command: "rm -rf __pycache__",
    summary: "No such file or directory",
  })), null);
});
