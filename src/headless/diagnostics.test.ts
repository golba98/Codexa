import assert from "node:assert/strict";
import test from "node:test";
import { listProviderStatus } from "./diagnostics.js";

test("provider diagnostics report Antigravity CLI as routable and honor its configured executable and disabled state", () => {
  const config = { providers: { antigravity: { antigravityCommandPath: process.execPath } } };
  const status = listProviderStatus(config, process.cwd()).find((provider) => provider.id === "antigravity");
  assert.equal(status?.routable, true);
  assert.equal(status?.configured, true);
  assert.equal(status?.executable, process.execPath);
  const disabled = listProviderStatus({ providers: { antigravity: { ...config.providers.antigravity, enabled: false } } }, process.cwd()).find((provider) => provider.id === "antigravity");
  assert.equal(disabled?.routable, false);
});
