import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEXA_NPM_REGISTRY_URL,
  CODEXA_UPDATE_COMMAND,
  checkForUpdates,
  compareSemver,
  formatUpdateInstructions,
  isNewerVersion,
  type NpmRegistryMetadata,
} from "./updateCheck.js";
import { isCacheValid, type UpdateCheckCache } from "../config/updateCheckCache.js";

function metadata(version: string): NpmRegistryMetadata {
  return { "dist-tags": { latest: version } };
}

test("checkForUpdates returns update-available when installed version is lower than npm latest", async () => {
  const result = await checkForUpdates(
    {},
    {
      currentVersion: "1.0.1",
      fetchNpmMetadataFn: async (url) => {
        assert.equal(url, CODEXA_NPM_REGISTRY_URL);
        return metadata("1.0.2");
      },
    },
  );

  assert.equal(result.status, "update-available");
  assert.equal(result.currentVersion, "1.0.1");
  assert.equal(result.latestVersion, "1.0.2");
});

test("checkForUpdates returns up-to-date when installed version equals npm latest", async () => {
  const result = await checkForUpdates(
    {},
    {
      currentVersion: "1.0.2",
      fetchNpmMetadataFn: async () => metadata("1.0.2"),
    },
  );

  assert.equal(result.status, "up-to-date");
});

test("checkForUpdates does not show update available when installed version is higher than npm latest", async () => {
  const result = await checkForUpdates(
    {},
    {
      currentVersion: "1.0.3",
      fetchNpmMetadataFn: async () => metadata("1.0.2"),
    },
  );

  assert.equal(result.status, "up-to-date");
});

test("checkForUpdates returns error status instead of throwing when npm request fails", async () => {
  const result = await checkForUpdates(
    {},
    {
      currentVersion: "1.0.1",
      fetchNpmMetadataFn: async () => {
        throw new Error("network unavailable");
      },
    },
  );

  assert.equal(result.status, "error");
  assert.match(result.errorMessage ?? "", /network unavailable/);
});

test("checkForUpdates returns error when npm latest is missing", async () => {
  const result = await checkForUpdates(
    {},
    {
      currentVersion: "1.0.1",
      fetchNpmMetadataFn: async () => ({ "dist-tags": {} }),
    },
  );

  assert.equal(result.status, "error");
  assert.match(result.errorMessage ?? "", /dist-tags\.latest/);
});

test("checkForUpdates returns unknown immediately when enabled=false", async () => {
  let called = false;
  const result = await checkForUpdates(
    { enabled: false },
    {
      currentVersion: "1.0.1",
      fetchNpmMetadataFn: async () => {
        called = true;
        return metadata("1.0.2");
      },
    },
  );

  assert.equal(result.status, "unknown");
  assert.equal(called, false, "should not call npm when disabled");
});

test("semver comparison handles numeric and prerelease ordering", () => {
  assert.equal(isNewerVersion("1.0.10", "1.0.2"), true);
  assert.equal(isNewerVersion("1.0.2", "1.0.10"), false);
  assert.equal(compareSemver("1.0.2", "1.0.2"), 0);
  assert.equal(isNewerVersion("1.0.2", "1.0.2-beta.1"), true);
  assert.equal(isNewerVersion("1.0.2-beta.1", "1.0.2"), false);
});

test("isCacheValid returns true when cache is within the interval", () => {
  const cache: UpdateCheckCache = {
    lastChecked: Date.now() - 1000 * 60 * 30,
    currentVersion: "1.0.1",
    latestVersion: "1.0.1",
    updateAvailable: false,
  };
  assert.equal(isCacheValid(cache, 6), true);
});

test("isCacheValid returns false when cache is older than the interval", () => {
  const cache: UpdateCheckCache = {
    lastChecked: Date.now() - 1000 * 60 * 60 * 7,
    currentVersion: "1.0.1",
    latestVersion: "1.0.1",
    updateAvailable: false,
  };
  assert.equal(isCacheValid(cache, 6), false);
});

test("formatUpdateInstructions formats update-available npm status", () => {
  const result = formatUpdateInstructions({
    status: "update-available",
    currentVersion: "1.0.1",
    latestVersion: "1.0.2",
    checkedAt: Date.now(),
  });

  assert.match(result, /Current installed version: 1\.0\.1/);
  assert.match(result, /npm latest version:\s+1\.0\.2/);
  assert.match(result, /Update available: Codexa 1\.0\.2 is available\. You are using 1\.0\.1\./);
  assert.match(result, new RegExp(`Run: ${CODEXA_UPDATE_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("formatUpdateInstructions formats up-to-date npm status", () => {
  const result = formatUpdateInstructions({
    status: "up-to-date",
    currentVersion: "1.0.2",
    latestVersion: "1.0.2",
    checkedAt: Date.now(),
  });

  assert.match(result, /Already up to date/);
  assert.match(result, /npm install -g @golba98\/codexa@latest/);
});

test("formatUpdateInstructions formats manual npm errors", () => {
  const result = formatUpdateInstructions({
    status: "error",
    currentVersion: "1.0.1",
    latestVersion: null,
    errorMessage: "Connection timed out",
    checkedAt: Date.now(),
  });

  assert.match(result, /Error checking npm update status: Connection timed out/);
});

test("/update check path bypasses cache by performing a fresh npm check", async () => {
  const validCache: UpdateCheckCache = {
    lastChecked: Date.now(),
    currentVersion: "1.0.1",
    latestVersion: "1.0.1",
    updateAvailable: false,
  };
  assert.equal(isCacheValid(validCache, 6), true);

  let calls = 0;
  const result = await checkForUpdates(
    { enabled: true },
    {
      currentVersion: validCache.currentVersion,
      fetchNpmMetadataFn: async () => {
        calls += 1;
        return metadata("1.0.2");
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.status, "update-available");
  assert.equal(result.latestVersion, "1.0.2");
});

test("shows prompt when update is available and version is not skipped", () => {
  const latest = "1.0.3";
  const skipped: string | null = null;
  // null skipped version never suppresses the prompt
  assert.notEqual(latest, skipped);
});

test("skips prompt when skippedUpdateVersion matches the latest version", () => {
  const latest: string = "1.0.3";
  const skipped: string = "1.0.3";
  assert.equal(latest, skipped);
});

test("shows prompt again when npm latest is newer than skipped version", () => {
  const latest = "1.0.4";
  const skipped = "1.0.3";
  // Different versions means the prompt is shown again
  assert.notEqual(latest, skipped);
  assert.equal(isNewerVersion(latest, skipped), true);
});
