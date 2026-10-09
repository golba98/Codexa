import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderId } from "../providerLauncher/types.js";
import type { ProviderBackendKind } from "../providerRuntime/types.js";
import { resolveUsageTarget } from "./registry.js";

function route(providerId: ProviderId, backendKind: ProviderBackendKind) {
  return { providerId, modelId: "m", backendKind };
}

test("every provider maps to its own usage adapter", () => {
  assert.equal(resolveUsageTarget(route("openai", "codex-cli-auth")).adapter.id, "codex");
  assert.equal(
    resolveUsageTarget(route("google", "antigravity-cli-auth")).adapter.id,
    "antigravity",
  );
  assert.equal(
    resolveUsageTarget(route("mistral", "mistral-vibe-cli-auth")).adapter.id,
    "mistral-vibe",
  );
  assert.equal(resolveUsageTarget(route("local", "local-openai-compatible")).adapter.id, "local");
  assert.equal(
    resolveUsageTarget(route("codexa-native", "codexa-native-pytorch")).adapter.id,
    "local",
  );
});

test("Anthropic routes resolve to the account the run will actually use", () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    const cli = resolveUsageTarget(route("anthropic", "claude-code-auth"));
    assert.equal(cli.adapter.id, "claude-code");
    assert.equal(cli.route.backendKind, "claude-code-auth");

    const configuredKey = resolveUsageTarget(route("anthropic", "claude-code-auth"), {
      apiKey: "sk-ant-test",
    });
    assert.equal(configuredKey.adapter.id, "anthropic-api");
    assert.equal(configuredKey.route.backendKind, "anthropic-api-key");
    assert.notEqual(configuredKey.scopeKey, cli.scopeKey);
    assert.ok(!configuredKey.scopeKey.includes("sk-ant-test"));
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("switching provider changes the scope so cached usage cannot leak", () => {
  const keys = new Set(
    [
      resolveUsageTarget(route("openai", "codex-cli-auth")),
      resolveUsageTarget(route("anthropic", "claude-code-auth")),
      resolveUsageTarget(route("google", "antigravity-cli-auth")),
      resolveUsageTarget(route("mistral", "mistral-vibe-cli-auth")),
      resolveUsageTarget(route("local", "local-openai-compatible")),
    ].map((target) => target.scopeKey),
  );
  assert.equal(keys.size, 5);
});

test("a different configured executable is a different usage scope", () => {
  const a = resolveUsageTarget(route("openai", "codex-cli-auth"), { codexCommandPath: "/a/codex" });
  const b = resolveUsageTarget(route("openai", "codex-cli-auth"), { codexCommandPath: "/b/codex" });
  assert.notEqual(a.scopeKey, b.scopeKey);
});
