import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderRegistry, getDefaultProviderId } from "./registry.js";
import { checkLocalProvider, resetLocalProviderStateForTests } from "../providerRuntime/local.js";

test("provider registry exposes the default launcher providers", () => {
  const providers = buildProviderRegistry({ activeModel: "gpt-5.4" });

  assert.deepEqual(providers.map((provider) => provider.id), ["openai", "anthropic", "google", "local"]);
  assert.equal(providers[0]?.displayName, "OpenAI");
  assert.equal(providers[0]?.currentModel, "gpt-5.4");
  assert.deepEqual(providers[0]?.launchCommand, { executable: "codex", args: [] });
  assert.deepEqual(providers[1]?.launchCommand, { executable: "claude", args: [] });
  assert.deepEqual(providers[2]?.launchCommand, { executable: "gemini", args: [] });
  assert.equal(providers[3]?.enabled, false);
  assert.equal(providers[3]?.launchCommand, null);
});

test("workspace config can set the default provider", () => {
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4",
    workspaceConfig: { workspaceDefaultProviderId: "anthropic" },
  });

  assert.equal(getDefaultProviderId({ workspaceDefaultProviderId: "anthropic" }), "anthropic");
  assert.equal(providers.find((provider) => provider.id === "anthropic")?.isDefault, true);
  assert.equal(providers.find((provider) => provider.id === "openai")?.isDefault, false);
});

test("provider registry keeps workspace default separate from active route", () => {
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4",
    workspaceConfig: {
      workspaceDefaultProviderId: "anthropic",
      activeRoute: {
        providerId: "openai",
        modelId: "gpt-5.4",
      },
    },
  });

  assert.equal(providers.find((provider) => provider.id === "anthropic")?.isDefault, true);
  assert.equal(providers.find((provider) => provider.id === "anthropic")?.isActiveRoute, false);
  assert.equal(providers.find((provider) => provider.id === "openai")?.isDefault, false);
  assert.equal(providers.find((provider) => provider.id === "openai")?.isActiveRoute, true);
});

test("unvalidated local provider remains disabled until endpoint discovery succeeds", () => {
  resetLocalProviderStateForTests();
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4",
    workspaceConfig: {
      workspaceDefaultProviderId: "anthropic",
      activeRoute: {
        providerId: "local",
        modelId: "llama-local",
      },
    },
  });

  assert.equal(providers.find((provider) => provider.id === "anthropic")?.isDefault, true);
  assert.equal(providers.find((provider) => provider.id === "local")?.isActiveRoute, true);
  assert.equal(providers.find((provider) => provider.id === "local")?.routeMode, "in-codexa");
  assert.equal(providers.find((provider) => provider.id === "local")?.enabled, false);
});

test("google can be selected as an active in-Codexa route", () => {
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4",
    workspaceConfig: {
      activeRoute: {
        providerId: "google",
        modelId: "gemini-3-flash-preview",
        backendKind: "gemini-cli-auth",
      },
    },
  });

  assert.equal(providers.find((provider) => provider.id === "google")?.isActiveRoute, true);
  assert.equal(providers.find((provider) => provider.id === "google")?.routeMode, "in-codexa");
  assert.equal(providers.find((provider) => provider.id === "google")?.currentModel, "gemini-3-flash-preview");
  assert.equal(providers.find((provider) => provider.id === "openai")?.isActiveRoute, false);
});

test("anthropic can be selected as an active in-Codexa route", () => {
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4",
    workspaceConfig: {
      activeRoute: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        backendKind: "anthropic-api-key",
      },
    },
  });

  assert.equal(providers.find((provider) => provider.id === "anthropic")?.isActiveRoute, true);
  assert.equal(providers.find((provider) => provider.id === "anthropic")?.routeMode, "in-codexa");
  assert.equal(providers.find((provider) => provider.id === "anthropic")?.currentModel, "claude-sonnet-4-20250514");
  assert.equal(providers.find((provider) => provider.id === "openai")?.isActiveRoute, false);
});


test("discovered local models enable local provider and display selected model", async () => {
  resetLocalProviderStateForTests();
  const localOverride = {
    currentModel: "google/gemma-4-26b-a4b",
  };
  await checkLocalProvider({
    override: localOverride,
    fetchImpl: (async (input) => {
      if (String(input).includes("/api/v0/")) {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify({
        data: [{ id: "google/gemma-4-26b-a4b" }],
      }), { status: 200 });
    }) as typeof fetch,
  });

  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4",
    workspaceConfig: {
      activeRoute: {
        providerId: "local",
        modelId: "google/gemma-4-26b-a4b",
        backendKind: "local-openai-compatible",
      },
      providers: {
        local: localOverride,
      },
    },
  });

  const local = providers.find((provider) => provider.id === "local");
  assert.equal(local?.enabled, true);
  assert.equal(local?.currentModel, "google/gemma-4-26b-a4b");
  assert.equal(local?.backendType, "local-openai-compatible");
  assert.equal(local?.statusLabel, "Enabled");
  assert.deepEqual(local?.launchCommand, null);
  resetLocalProviderStateForTests();
});

test("LM Studio loaded Local model replaces stale active route in provider registry", async () => {
  resetLocalProviderStateForTests();
  try {
    await checkLocalProvider({
      override: {
        currentModel: "google/gemma-4-26b-a4b",
        defaultModel: "google/gemma-4-26b-a4b",
        baseUrl: "http://localhost:1234/v1",
      },
      fetchImpl: (async (input) => {
        if (String(input).includes("/api/v0/")) {
          return new Response(JSON.stringify({
            data: [{
              id: "qwen/qwen3.6-27b",
              state: "loaded",
              loaded_context_length: 32000,
              max_context_length: 262144,
              capabilities: ["tool_use"],
            }],
            object: "list",
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          data: [{ id: "google/gemma-4-26b-a4b" }, { id: "qwen/qwen3.6-27b" }],
        }), { status: 200 });
      }) as typeof fetch,
    });

    const providers = buildProviderRegistry({
      activeModel: "gpt-5.4",
      workspaceConfig: {
        activeRoute: {
          providerId: "local",
          modelId: "google/gemma-4-26b-a4b",
          backendKind: "local-openai-compatible",
        },
        providers: {
          local: {
            currentModel: "google/gemma-4-26b-a4b",
            defaultModel: "google/gemma-4-26b-a4b",
            baseUrl: "http://localhost:1234/v1",
          },
        },
      },
    });

    const local = providers.find((provider) => provider.id === "local");
    assert.equal(local?.currentModel, "qwen/qwen3.6-27b");
    assert.equal(local?.contextLengthLabel, "32,000");
    assert.equal(local?.contextLengthSource, "lmstudio-api");
    assert.equal(local?.capabilityProfile?.supportsToolCalls, true);
    assert.equal(local?.capabilityProfile?.supportsVision, null);
  } finally {
    resetLocalProviderStateForTests();
  }
});
