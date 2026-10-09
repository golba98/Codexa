import assert from "node:assert/strict";
import test from "node:test";
import { listProviderStatus } from "./diagnostics.js";

test("provider diagnostics honor a configured executable and the disabled state", () => {
  const config = { providers: { anthropic: { claudeCommandPath: process.execPath } } };
  const status = listProviderStatus(config, process.cwd()).find(
    (provider) => provider.id === "anthropic",
  );
  assert.equal(status?.routable, true);
  assert.equal(status?.configured, true);
  assert.equal(status?.executable, process.execPath);
  const disabled = listProviderStatus(
    { providers: { anthropic: { ...config.providers.anthropic, enabled: false } } },
    process.cwd(),
  ).find((provider) => provider.id === "anthropic");
  assert.equal(disabled?.routable, false);
});

test("provider diagnostics no longer list Antigravity", () => {
  assert.equal(
    listProviderStatus({}, process.cwd()).some(
      (provider) => (provider.id as string) === "antigravity",
    ),
    false,
  );
});
