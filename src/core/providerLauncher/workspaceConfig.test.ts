import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import { buildProviderRegistry } from "./registry.js";
import { resetGeminiRouteValidationCacheForTests } from "../providerRuntime/gemini.js";
import { checkLocalProvider, resetLocalProviderStateForTests } from "../providerRuntime/local.js";
import {
  getProviderWorkspaceConfigFile,
  loadProviderWorkspaceConfig,
  parseProviderWorkspaceConfig,
  saveProviderWorkspaceConfig,
  serializeProviderWorkspaceConfig,
  setProviderActiveRoute,
  setProviderDefaultReasoning,
  setProviderDefaultModel,
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
        current_reasoning: "medium",
        type: "openai-compatible",
        base_url: "http://localhost:1234/v1",
        api_key: "lm-studio",
        default_model: "llama",
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
    currentReasoning: "medium",
    type: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    apiKey: "lm-studio",
    defaultModel: "llama",
    command: "ollama",
  });
  assert.equal("unknown" in (config.providers ?? {}), false);
});

test("legacy Antigravity active/default config falls back to OpenAI and drops provider override", () => {
  const config = parseProviderWorkspaceConfig({
    workspaceDefaultProviderId: "antigravity",
    activeRoute: {
      providerId: "antigravity",
      modelId: "external-antigravity-default",
      backendKind: "antigravity-cli-auth",
      reasoning: "medium",
    },
    providers: {
      antigravity: {
        current_model: "external-antigravity-default",
        current_reasoning: "medium",
      },
      openai: {
        current_model: "gpt-5.4-mini",
        current_reasoning: "low",
      },
    },
  });

  assert.deepEqual(config.activeRoute, {
    providerId: "openai",
    modelId: "gpt-5.4-mini",
    backendKind: "codex-cli-auth",
    reasoning: "low",
  });
  assert.equal(config.workspaceDefaultProviderId, "openai");
  assert.equal(config.providers?.openai?.currentModel, "gpt-5.4-mini");
  assert.equal((config.providers as Record<string, unknown> | undefined)?.antigravity, undefined);
  assert.deepEqual(config.migrationNotice, {
    deprecatedProviderId: "antigravity",
    revertedProviderId: "openai",
  });
  assert.doesNotMatch(JSON.stringify(serializeProviderWorkspaceConfig(config)), /antigravity/i);
});

test("legacy Antigravity backend aliases are treated as deprecated routes", () => {
  const config = parseProviderWorkspaceConfig({
    active_route: {
      provider_id: "openai",
      model_id: "external-antigravity-default",
      backend_kind: "agy",
    },
  });

  assert.equal(config.activeRoute?.providerId, "openai");
  assert.equal(config.activeRoute?.backendKind, "codex-cli-auth");
  assert.equal(config.migrationNotice?.revertedProviderId, "openai");
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
      modelId: "gemini-2.5-flash",
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
      modelId: "gemini-2.5-flash",
      backendKind: "gemini-api-key",
      reasoning: "high",
    });

    assert.deepEqual(config.activeRoute, {
      providerId: "google",
      modelId: "gemini-2.5-flash",
      backendKind: "gemini-api-key",
      reasoning: "high",
    });
    assert.doesNotMatch(JSON.stringify(serializeProviderWorkspaceConfig(config)), /test-gemini-key/);
  });
});

// ---------------------------------------------------------------------------
// setProviderDefaultModel
// ---------------------------------------------------------------------------

test("setProviderDefaultModel saves model without overwriting other provider fields", () => {
  const initial = {
    providers: {
      anthropic: { currentModel: "opus", currentReasoning: "high", enabled: true },
      google: { currentModel: "gemini-2.5-pro" },
    },
  };
  const updated = setProviderDefaultModel(initial, "anthropic", "sonnet");
  assert.equal(updated.providers?.["anthropic"]?.currentModel, "sonnet");
  assert.equal(updated.providers?.["anthropic"]?.currentReasoning, "high", "reasoning must be preserved");
  assert.equal(updated.providers?.["anthropic"]?.enabled, true, "enabled flag must be preserved");
  assert.equal(updated.providers?.["google"]?.currentModel, "gemini-2.5-pro", "other provider unchanged");
});

test("setProviderDefaultModel creates providers entry when none exists", () => {
  const config = setProviderDefaultModel({}, "anthropic", "haiku");
  assert.equal(config.providers?.["anthropic"]?.currentModel, "haiku");
});

test("setProviderDefaultModel round-trips through serialize/parse", () => {
  const config = setProviderDefaultModel({}, "anthropic", "sonnet");
  const serialized = serializeProviderWorkspaceConfig(config);
  const reparsed = parseProviderWorkspaceConfig(serialized);
  assert.equal(reparsed.providers?.["anthropic"]?.currentModel, "sonnet");
});

test("setProviderDefaultReasoning saves provider-scoped reasoning without touching other providers", () => {
  const initial = {
    providers: {
      openai: { currentReasoning: "high" },
      anthropic: { currentModel: "sonnet", currentReasoning: "medium" },
    },
  };
  const updated = setProviderDefaultReasoning(initial, "anthropic", "max");
  assert.equal(updated.providers?.anthropic?.currentModel, "sonnet");
  assert.equal(updated.providers?.anthropic?.currentReasoning, "max");
  assert.equal(updated.providers?.openai?.currentReasoning, "high");
});

test("provider default reasoning round-trips through serialize/parse", () => {
  const config = setProviderDefaultReasoning(
    setProviderDefaultModel({}, "anthropic", "sonnet"),
    "anthropic",
    "xhigh",
  );
  const serialized = serializeProviderWorkspaceConfig(config);
  assert.deepEqual(serialized.providers, {
    anthropic: {
      current_model: "sonnet",
      current_reasoning: "xhigh",
    },
  });
  const reparsed = parseProviderWorkspaceConfig(serialized);
  assert.equal(reparsed.providers?.anthropic?.currentModel, "sonnet");
  assert.equal(reparsed.providers?.anthropic?.currentReasoning, "xhigh");
});

test("Anthropic claudeCommandPath round-trips through serialize/parse", () => {
  const config = parseProviderWorkspaceConfig({
    providers: {
      anthropic: {
        current_model: "sonnet",
        claude_command_path: "C:\\Users\\Example\\.local\\bin\\claude.exe",
      },
    },
  });

  assert.equal(config.providers?.anthropic?.claudeCommandPath, "C:\\Users\\Example\\.local\\bin\\claude.exe");
  const serialized = serializeProviderWorkspaceConfig(config);
  assert.deepEqual(serialized.providers, {
    anthropic: {
      current_model: "sonnet",
      claude_command_path: "C:\\Users\\Example\\.local\\bin\\claude.exe",
    },
  });
});

test("Gemini geminiCommandPath round-trips through serialize/parse", () => {
  const config = parseProviderWorkspaceConfig({
    providers: {
      google: {
        current_model: "gemini-2.5-flash",
        gemini_command_path: "C:\\Users\\Example\\AppData\\Roaming\\npm\\gemini.cmd",
      },
    },
  });

  assert.equal(config.providers?.google?.geminiCommandPath, "C:\\Users\\Example\\AppData\\Roaming\\npm\\gemini.cmd");
  const serialized = serializeProviderWorkspaceConfig(config);
  assert.deepEqual(serialized.providers, {
    google: {
      current_model: "gemini-2.5-flash",
      gemini_command_path: "C:\\Users\\Example\\AppData\\Roaming\\npm\\gemini.cmd",
    },
  });
});

test("Codex codexCommandPath round-trips through serialize/parse", () => {
  const config = parseProviderWorkspaceConfig({
    providers: {
      openai: {
        current_model: "gpt-5.4",
        codex_command_path: "C:\\Users\\Example\\AppData\\Roaming\\npm\\codex.cmd",
      },
    },
  });

  assert.equal(config.providers?.openai?.codexCommandPath, "C:\\Users\\Example\\AppData\\Roaming\\npm\\codex.cmd");
  const serialized = serializeProviderWorkspaceConfig(config);
  assert.deepEqual(serialized.providers, {
    openai: {
      current_model: "gpt-5.4",
      codex_command_path: "C:\\Users\\Example\\AppData\\Roaming\\npm\\codex.cmd",
    },
  });
});

test("Local OpenAI-compatible config round-trips through serialize/parse", () => {
  const config = parseProviderWorkspaceConfig({
    providers: {
      local: {
        enabled: true,
        type: "openai-compatible",
        base_url: "http://localhost:1234/v1",
        api_key: "lm-studio",
        pinned_model: "qwen/qwen3.6-27b",
        default_model: "google/gemma-4-26b-a4b",
        models: {
          "google/gemma-4-26b-a4b": {
            contextLength: 8192,
          },
        },
      },
    },
  });

  assert.deepEqual(config.providers?.local, {
    enabled: true,
    type: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    apiKey: "lm-studio",
    pinnedModel: "qwen/qwen3.6-27b",
    defaultModel: "google/gemma-4-26b-a4b",
    models: {
      "google/gemma-4-26b-a4b": {
        contextLength: 8192,
      },
    },
  });
  assert.deepEqual(serializeProviderWorkspaceConfig(config).providers, {
    local: {
      enabled: true,
      type: "openai-compatible",
      base_url: "http://localhost:1234/v1",
      api_key: "lm-studio",
      pinned_model: "qwen/qwen3.6-27b",
      default_model: "google/gemma-4-26b-a4b",
      models: {
        "google/gemma-4-26b-a4b": {
          contextLength: 8192,
        },
      },
    },
  });
});

test("provider model context length config rejects invalid values", () => {
  const config = parseProviderWorkspaceConfig({
    providers: {
      local: {
        models: {
          zero: { contextLength: 0 },
          negative: { contextLength: -1 },
          decimal: { contextLength: 8192.5 },
          text: { contextLength: "8192" },
          valid: { context_length: 32768 },
        },
      },
    },
  });

  assert.deepEqual(config.providers?.local?.models, {
    valid: {
      contextLength: 32768,
    },
  });
});

test("setProviderActiveRoute persists Local routes after endpoint discovery", async () => {
  resetLocalProviderStateForTests();
  try {
    await checkLocalProvider({
      fetchImpl: (async (input) => {
        if (String(input).includes("/api/v0/")) {
          return new Response(null, { status: 404 });
        }
        return new Response(JSON.stringify({
          data: [{ id: "google/gemma-4-26b-a4b" }],
        }), { status: 200 });
      }) as typeof fetch,
    });
    const config = setProviderActiveRoute({}, {
      providerId: "local",
      modelId: "google/gemma-4-26b-a4b",
      backendKind: "local-openai-compatible",
    });

    assert.deepEqual(config.activeRoute, {
      providerId: "local",
      modelId: "google/gemma-4-26b-a4b",
      backendKind: "local-openai-compatible",
    });
  } finally {
    resetLocalProviderStateForTests();
  }
});

test("Gemini workspace config normalizes legacy flash model IDs to preview", () => {
  const config = parseProviderWorkspaceConfig({
    activeRoute: {
      providerId: "google",
      modelId: "gemini-3-flash",
      backendKind: "gemini-cli-auth",
      modelSelection: {
        kind: "manual",
        modelId: "gemini-3-flash",
      },
    },
    providers: {
      google: {
        current_model: "gemini-3-flash",
      },
    },
  });

  assert.equal(config.activeRoute?.modelId, "gemini-3-flash-preview");
  assert.deepEqual(config.activeRoute?.modelSelection, {
    kind: "manual",
    modelId: "gemini-3-flash-preview",
  });
  assert.equal(config.providers?.google?.currentModel, "gemini-3-flash-preview");
});

test("Local model capability fields round-trip through serialize/parse", () => {
  const config = parseProviderWorkspaceConfig({
    providers: {
      local: {
        enabled: true,
        type: "openai-compatible",
        base_url: "http://localhost:1234/v1",
        api_key: "lm-studio",
        default_model: "test-model",
        models: {
          "test-model": {
            contextLength: 8192,
            supportsToolCalls: false,
            supportsStreaming: true,
            supportsSystemPrompt: true,
            maxOutputTokens: 4096,
          },
        },
      },
    },
  });

  assert.deepEqual(config.providers?.local?.models?.["test-model"], {
    contextLength: 8192,
    supportsToolCalls: false,
    supportsStreaming: true,
    supportsSystemPrompt: true,
    maxOutputTokens: 4096,
  });

  const serialized = serializeProviderWorkspaceConfig(config);
  const reparsed = parseProviderWorkspaceConfig(serialized);
  assert.deepEqual(reparsed.providers?.local?.models?.["test-model"], {
    contextLength: 8192,
    supportsToolCalls: false,
    supportsStreaming: true,
    supportsSystemPrompt: true,
    maxOutputTokens: 4096,
  });
});

test("Local model capability boolean string values are rejected", () => {
  const config = parseProviderWorkspaceConfig({
    providers: {
      local: {
        models: {
          "bad-model": {
            supportsStreaming: "true",
            supportsToolCalls: 1,
            supportsSystemPrompt: null,
          },
        },
      },
    },
  });

  // None of the invalid values should create a model entry
  assert.equal(config.providers?.local?.models?.["bad-model"], undefined);
});

test("Local model maxOutputTokens: 4096 round-trips; invalid values are rejected", () => {
  const config = parseProviderWorkspaceConfig({
    providers: {
      local: {
        models: {
          valid: { max_output_tokens: 4096 },
          zero: { maxOutputTokens: 0 },
          negative: { max_output_tokens: -512 },
          decimal: { maxOutputTokens: 1024.5 },
        },
      },
    },
  });

  assert.deepEqual(config.providers?.local?.models?.valid, { maxOutputTokens: 4096 });
  assert.equal(config.providers?.local?.models?.zero, undefined);
  assert.equal(config.providers?.local?.models?.negative, undefined);
  assert.equal(config.providers?.local?.models?.decimal, undefined);
});

test("setProviderActiveRoute persists Gemini routes when GOOGLE_API_KEY is configured", () => {
  withGeminiEnv({ GOOGLE_API_KEY: "test-google-key" }, () => {
    const config = setProviderActiveRoute({}, {
      providerId: "google",
      modelId: "gemini-2.5-flash",
      backendKind: "gemini-api-key",
      reasoning: "high",
    });

    assert.deepEqual(config.activeRoute, {
      providerId: "google",
      modelId: "gemini-2.5-flash",
      backendKind: "gemini-api-key",
      reasoning: "high",
    });
    assert.doesNotMatch(JSON.stringify(serializeProviderWorkspaceConfig(config)), /test-google-key/);
  });
});
