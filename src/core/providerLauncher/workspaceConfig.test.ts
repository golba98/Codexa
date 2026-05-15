import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import { buildProviderRegistry } from "./registry.js";
import { resetGeminiRouteValidationCacheForTests } from "../providerRuntime/gemini.js";
import {
  getProviderWorkspaceConfigFile,
  loadProviderWorkspaceConfig,
  parseProviderWorkspaceConfig,
  saveProviderWorkspaceConfig,
  serializeProviderWorkspaceConfig,
  setProviderActiveRoute,
  setProviderWorkspaceDefault,
} from "./workspaceConfig.js";

function withGeminiEnv<T>(
  env: Partial<NodeJS.ProcessEnv>,
  callback: () => T,
): T {
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalGoogle = process.env.GOOGLE_API_KEY;

  try {
    if ("GEMINI_API_KEY" in env) {
      process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    if ("GOOGLE_API_KEY" in env) {
      process.env.GOOGLE_API_KEY = env.GOOGLE_API_KEY;
    } else {
      delete process.env.GOOGLE_API_KEY;
    }
    resetGeminiRouteValidationCacheForTests();
    return callback();
  } finally {
    if (originalGemini === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGemini;
    }
    if (originalGoogle === undefined) {
      delete process.env.GOOGLE_API_KEY;
    } else {
      process.env.GOOGLE_API_KEY = originalGoogle;
    }
    resetGeminiRouteValidationCacheForTests();
  }
}

test("parses provider workspace config from Codexa-owned JSON", () => {
  const config = parseProviderWorkspaceConfig({
    default_provider_id: "google",
    activeRoute: {
      providerId: "openai",
      modelId: "gpt-5.5",
      reasoning: "high",
    },
    providers: {
      local: {
        current_model: "llama",
        command: "ollama",
      },
      unknown: {
        command: "ignored",
      },
    },
  });

  assert.equal(config.workspaceDefaultProviderId, "google");
  assert.deepEqual(config.activeRoute, {
    providerId: "openai",
    modelId: "gpt-5.5",
    backendKind: "codex-cli-auth",
    reasoning: "high",
  });
  assert.deepEqual(config.providers?.local, {
    currentModel: "llama",
    command: "ollama",
  });
  assert.equal("unknown" in (config.providers ?? {}), false);
});

test("serializes and persists provider workspace defaults", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codexa-provider-config-"));
  try {
    const config = setProviderWorkspaceDefault({}, "anthropic");
    saveProviderWorkspaceConfig(tempRoot, config);

    assert.equal(getProviderWorkspaceConfigFile(tempRoot), join(tempRoot, ".codexa", "providers.json"));
    assert.deepEqual(loadProviderWorkspaceConfig(tempRoot), {
      workspaceDefaultProviderId: "anthropic",
    });
    assert.deepEqual(serializeProviderWorkspaceConfig(config), {
      workspaceDefaultProviderId: "anthropic",
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("loaded workspace default is applied to a fresh provider registry", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codexa-provider-restart-"));
  try {
    saveProviderWorkspaceConfig(tempRoot, setProviderWorkspaceDefault({}, "google"));

    const loadedConfig = loadProviderWorkspaceConfig(tempRoot);
    const providers = buildProviderRegistry({
      activeModel: "gpt-5.4",
      workspaceConfig: loadedConfig,
    });

    assert.equal(providers.find((provider) => provider.id === "google")?.isDefault, true);
    assert.equal(providers.find((provider) => provider.id === "openai")?.isDefault, false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("workspace provider config reload preserves default and active route separately", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codexa-provider-route-"));
  try {
    saveProviderWorkspaceConfig(tempRoot, {
      workspaceDefaultProviderId: "anthropic",
      activeRoute: {
        providerId: "openai",
        modelId: "gpt-5.5",
        backendKind: "codex-cli-auth",
        reasoning: "high",
      },
    });

    assert.deepEqual(loadProviderWorkspaceConfig(tempRoot), {
      workspaceDefaultProviderId: "anthropic",
      activeRoute: {
        providerId: "openai",
        modelId: "gpt-5.5",
        backendKind: "codex-cli-auth",
        reasoning: "high",
      },
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("active Anthropic route persists without secrets", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codexa-provider-anthropic-route-"));
  const original = process.env.ANTHROPIC_API_KEY;

  try {
    process.env.ANTHROPIC_API_KEY = "secret-test-key";
    saveProviderWorkspaceConfig(tempRoot, {
      workspaceDefaultProviderId: "anthropic",
      activeRoute: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        backendKind: "claude-code-auth",
        reasoning: "high",
      },
    });

    const loaded = loadProviderWorkspaceConfig(tempRoot);
    assert.deepEqual(loaded, {
      workspaceDefaultProviderId: "anthropic",
      activeRoute: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        backendKind: "claude-code-auth",
        reasoning: "high",
      },
    });
    assert.doesNotMatch(JSON.stringify(serializeProviderWorkspaceConfig(loaded)), /secret-test-key/);
  } finally {
    if (original === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = original;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("setProviderActiveRoute rejects unconfigured Gemini routes", () => {
  withGeminiEnv({}, () => {
    const config = setProviderActiveRoute({
      activeRoute: {
        providerId: "openai",
        modelId: "gpt-5.5",
        backendKind: "codex-cli-auth",
        reasoning: "high",
      },
    }, {
      providerId: "google",
      modelId: "gemini-3.1-pro",
      backendKind: "gemini-cli-auth",
      reasoning: "high",
    });

    assert.deepEqual(config.activeRoute, {
      providerId: "openai",
      modelId: "gpt-5.5",
      backendKind: "codex-cli-auth",
      reasoning: "high",
    });
  });
});

test("setProviderActiveRoute persists Gemini routes when GEMINI_API_KEY is configured", () => {
  withGeminiEnv({ GEMINI_API_KEY: "test-gemini-key" }, () => {
    const config = setProviderActiveRoute({}, {
      providerId: "google",
      modelId: "gemini-3.1-pro",
      backendKind: "gemini-api-key",
      reasoning: "high",
    });

    assert.deepEqual(config.activeRoute, {
      providerId: "google",
      modelId: "gemini-3.1-pro",
      backendKind: "gemini-api-key",
      reasoning: "high",
    });
    assert.doesNotMatch(JSON.stringify(serializeProviderWorkspaceConfig(config)), /test-gemini-key/);
  });
});

test("setProviderActiveRoute persists Gemini routes when GOOGLE_API_KEY is configured", () => {
  withGeminiEnv({ GOOGLE_API_KEY: "test-google-key" }, () => {
    const config = setProviderActiveRoute({}, {
      providerId: "google",
      modelId: "gemini-3.1-pro",
      backendKind: "gemini-api-key",
      reasoning: "high",
    });

    assert.deepEqual(config.activeRoute, {
      providerId: "google",
      modelId: "gemini-3.1-pro",
      backendKind: "gemini-api-key",
      reasoning: "high",
    });
    assert.doesNotMatch(JSON.stringify(serializeProviderWorkspaceConfig(config)), /test-google-key/);
  });
});
