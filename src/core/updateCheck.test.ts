import assert from "node:assert/strict";
import test from "node:test";
import {
  checkForUpdates,
  findGitRoot,
  formatUpdateInstructions,
} from "./updateCheck.js";
import { isCacheValid, type UpdateCheckCache } from "../config/updateCheckCache.js";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

// ─── findGitRoot ──────────────────────────────────────────────────────────────

test("findGitRoot returns null for a path that has no .git ancestor", () => {
  // /tmp is unlikely to have a .git directory
  const result = findGitRoot("/tmp/definitely-no-git-here-xyzzy");
  assert.equal(result, null);
});

// ─── checkForUpdates: disabled ───────────────────────────────────────────────

test("checkForUpdates returns unknown immediately when enabled=false", async () => {
  let called = false;
  const result = await checkForUpdates(
    { enabled: false },
    {
      getRemoteCommitFn: async () => { called = true; return SHA_B; },
    },
  );
  assert.equal(result.status, "unknown");
  assert.equal(called, false, "should not call getRemoteCommitFn when disabled");
});

// ─── checkForUpdates: update-available ───────────────────────────────────────

test("checkForUpdates returns update-available when remote is different from local", async () => {
  const result = await checkForUpdates(
    {},
    {
      findGitRootFn: () => "/fake/repo",
      getLocalCommitFn: async () => SHA_A,
      getRemoteCommitFn: async () => SHA_B,
    },
  );
  assert.equal(result.status, "update-available");
  assert.equal(result.localCommit, SHA_A);
  assert.equal(result.remoteCommit, SHA_B);
});

// ─── checkForUpdates: up-to-date ─────────────────────────────────────────────

test("checkForUpdates returns up-to-date when local and remote match", async () => {
  const result = await checkForUpdates(
    {},
    {
      findGitRootFn: () => "/fake/repo",
      getLocalCommitFn: async () => SHA_A,
      getRemoteCommitFn: async () => SHA_A,
    },
  );
  assert.equal(result.status, "up-to-date");
});

// ─── checkForUpdates: unknown local commit ───────────────────────────────────

test("checkForUpdates returns unknown when local commit is null", async () => {
  const result = await checkForUpdates(
    {},
    {
      findGitRootFn: () => "/fake/repo",
      getLocalCommitFn: async () => null,
      getRemoteCommitFn: async () => SHA_B,
    },
  );
  assert.equal(result.status, "unknown");
});

test("checkForUpdates returns unknown when remote commit is null", async () => {
  const result = await checkForUpdates(
    {},
    {
      findGitRootFn: () => "/fake/repo",
      getLocalCommitFn: async () => SHA_A,
      getRemoteCommitFn: async () => null,
    },
  );
  assert.equal(result.status, "unknown");
});

// ─── checkForUpdates: error handling ─────────────────────────────────────────

test("checkForUpdates returns error status (not throw) when an override throws", async () => {
  const result = await checkForUpdates(
    {},
    {
      findGitRootFn: () => "/fake/repo",
      getLocalCommitFn: async () => { throw new Error("simulated failure"); },
      getRemoteCommitFn: async () => SHA_B,
    },
  );
  assert.equal(result.status, "error");
  assert.ok(result.errorMessage?.includes("simulated failure"));
});

// ─── isCacheValid ─────────────────────────────────────────────────────────────

test("isCacheValid returns true when cache is within the interval", () => {
  const cache: UpdateCheckCache = {
    lastChecked: Date.now() - 1000 * 60 * 30, // 30 minutes ago
    localCommit: SHA_A,
    remoteCommit: SHA_A,
    updateAvailable: false,
  };
  assert.equal(isCacheValid(cache, 6), true);
});

test("isCacheValid returns false when cache is older than the interval", () => {
  const cache: UpdateCheckCache = {
    lastChecked: Date.now() - 1000 * 60 * 60 * 7, // 7 hours ago
    localCommit: SHA_A,
    remoteCommit: SHA_A,
    updateAvailable: false,
  };
  assert.equal(isCacheValid(cache, 6), false);
});

// ─── formatUpdateInstructions ────────────────────────────────────────────────

test("formatUpdateInstructions formats update-available with known repo path", () => {
  const result = formatUpdateInstructions({
    status: "update-available",
    localCommit: SHA_A,
    remoteCommit: SHA_B,
    repoPath: "/fake/repo",
    checkedAt: Date.now(),
  });

  assert.match(result, /Update available — remote main has newer Codexa changes/);
  assert.match(result, /cd \/fake\/repo/);
  assert.match(result, /git status --short/);
  assert.match(result, /git pull origin main/);
  assert.match(result, /hash -r/);
  assert.match(result, /codexa --version/);
});

test("formatUpdateInstructions formats update-available with unknown repo path", () => {
  const result = formatUpdateInstructions({
    status: "update-available",
    localCommit: SHA_A,
    remoteCommit: SHA_B,
    repoPath: null,
    checkedAt: Date.now(),
  });

  assert.match(result, /Update available — remote main has newer Codexa changes/);
  assert.match(result, /cd ~\//);
  assert.equal(result.includes("git status --short"), false);
  assert.match(result, /git pull origin main/);
  assert.equal(result.includes("hash -r"), false);
  assert.equal(result.includes("codexa --version"), false);
});

test("formatUpdateInstructions formats up-to-date status", () => {
  const result = formatUpdateInstructions({
    status: "up-to-date",
    localCommit: SHA_A,
    remoteCommit: SHA_A,
    repoPath: "/fake/repo",
    checkedAt: Date.now(),
  });

  assert.match(result, /Already up to date/);
});

test("formatUpdateInstructions formats unknown/null result", () => {
  const result = formatUpdateInstructions(null);
  assert.match(result, /Status unknown — could not reach origin\/main/);
});

test("formatUpdateInstructions formats error status", () => {
  const result = formatUpdateInstructions({
    status: "error",
    localCommit: null,
    remoteCommit: null,
    repoPath: null,
    errorMessage: "Connection timed out",
    checkedAt: Date.now(),
  });

  assert.match(result, /Error checking update status: Connection timed out/);
});

