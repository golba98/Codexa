import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderRegistry, getDefaultProviderId } from "./registry.js";

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

test("launch-only providers are not treated as active in-Codexa routes", () => {
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
  assert.equal(providers.find((provider) => provider.id === "local")?.isActiveRoute, false);
  assert.equal(providers.find((provider) => provider.id === "openai")?.isActiveRoute, true);
});

test("google can be selected as an active in-Codexa route", () => {
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4",
    workspaceConfig: {
      activeRoute: {
        providerId: "google",
        modelId: "gemini-3.1-pro",
        backendKind: "gemini-cli-auth",
      },
    },
  });

  assert.equal(providers.find((provider) => provider.id === "google")?.isActiveRoute, true);
  assert.equal(providers.find((provider) => provider.id === "google")?.routeMode, "in-codexa");
  assert.equal(providers.find((provider) => provider.id === "google")?.currentModel, "gemini-3.1-pro");
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


test("configured local command enables local provider", () => {
  const providers = buildProviderRegistry({
    activeModel: "gpt-5.4",
    workspaceConfig: {
      providers: {
        local: {
          currentModel: "llama-local",
          command: { executable: "ollama", args: ["run", "llama3"] },
        },
      },
    },
  });

  const local = providers.find((provider) => provider.id === "local");
  assert.equal(local?.enabled, true);
  assert.equal(local?.currentModel, "llama-local");
  assert.deepEqual(local?.launchCommand, { executable: "ollama", args: ["run", "llama3"] });
});
