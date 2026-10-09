import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeRuntimeConfig, resolveRuntimeConfig } from "../../config/runtimeConfig.js";
import type { CommandSpec, runCommand } from "../process/commandRunner.js";
import {
  geminiRuntime,
  resetGeminiRouteValidationCacheForTests,
  runGeminiCliWithRunner,
} from "./gemini.js";
import { parseGeminiModels } from "./geminiDiscovery.js";
import { parseMistralModels } from "./mistralDiscovery.js";
import { runMistralVibe } from "./mistralVibe.js";
import type { ProviderChatRequest } from "./types.js";

const result = {
  status: "completed" as const,
  exitCode: 0,
  signal: null,
  stdout: "OK",
  stderr: "",
  startedAt: 0,
  endedAt: 0,
  durationMs: 0,
  userMessage: "done",
};
const runtime = resolveRuntimeConfig(normalizeRuntimeConfig({}));

for (const effort of ["none", "high"])
  test(`Mistral Vibe sends selectable API-native ID and exact ${effort} effort mapping`, async () => {
    const model = parseMistralModels({
      data: [
        {
          id: "mistral-medium-3-5",
          capabilities: {
            completion_chat: true,
            reasoning: true,
            function_calling: true,
            vision: false,
          },
          max_context_length: 32768,
        },
      ],
    })[0]!;
    let captured: CommandSpec | undefined;
    await new Promise<void>((resolve, reject) =>
      runMistralVibe(
        {
          prompt: "hello",
          route: {
            providerId: "mistral",
            modelId: model.modelId,
            reasoning: effort,
            backendKind: "mistral-vibe-cli-auth",
          },
          modelDescriptor: model,
          workspaceRoot: "/tmp",
          runtime,
          providerConfig: { apiKey: "fixture-key", baseUrl: "https://fixture.test/v1" },
        },
        { onResponse: () => resolve(), onError: reject },
        {
          env: {},
          resolveExecutable: async () => "/fixture/vibe",
          findSessionImpl: async () => null,
          runCommandImpl: (spec, handlers) => {
            captured = spec;
            handlers.onStdout?.("OK\n");
            return { result: Promise.resolve(result), cancel: () => {} };
          },
        },
      ),
    );
    const configured = JSON.parse(captured!.env!.VIBE_MODELS!)[model.modelId];
    expect(captured?.env?.VIBE_ACTIVE_MODEL).toBe(model.modelId);
    expect(configured.name).toBe(model.modelId);
    expect(configured.thinking).toBe(effort === "none" ? "low" : "high");
    expect(configured.max_context_length).toBe(32768);
    expect(JSON.parse(captured!.env!.VIBE_PROVIDERS!)[0].api_base).toBe("https://fixture.test/v1");
  });
test("unsupported Mistral settings stop before spawning", async () => {
  const model = parseMistralModels({
    data: [{ id: "mistral-medium-3-5", capabilities: { completion_chat: true, reasoning: true } }],
  })[0]!;
  let spawned = false;
  const error = await new Promise<string>((resolve) =>
    runMistralVibe(
      {
        prompt: "hi",
        route: {
          providerId: "mistral",
          modelId: model.modelId,
          reasoning: "max",
          backendKind: "mistral-vibe-cli-auth",
        },
        modelDescriptor: model,
        workspaceRoot: "/tmp",
        runtime,
      },
      { onResponse: () => {}, onError: resolve },
      {
        env: {},
        resolveExecutable: async () => "/fixture/vibe",
        runCommandImpl: () => {
          spawned = true;
          return { result: Promise.resolve(result), cancel: () => {} };
        },
      },
    ),
  );
  expect(error).toContain("Unsupported");
  expect(spawned).toBe(false);
});

for (const [id, effort, thinking] of [
  ["models/gemini-2.5-pro", "budget:4096", { thinkingBudget: 4096 }],
  ["models/gemini-3.1-pro-preview", "low", { thinkingLevel: "LOW" }],
] as const)
  test(`Gemini API request preserves ${id} and transmits selected thinking configuration`, async () => {
    resetGeminiRouteValidationCacheForTests();
    const model = parseGeminiModels({
      models: [{ name: id, supportedGenerationMethods: ["generateContent"] }],
    })[0]!;
    const original = globalThis.fetch;
    let url = "";
    let body: Record<string, unknown> = {};
    try {
      globalThis.fetch = (async (input, init) => {
        url = String(input);
        body = JSON.parse(String(init?.body));
        return Response.json({ candidates: [{ content: { parts: [{ text: "OK" }] } }] });
      }) as typeof fetch;
      await new Promise<void>((resolve, reject) =>
        geminiRuntime.run!(
          {
            prompt: "hi",
            route: {
              providerId: "google",
              modelId: id,
              reasoning: effort,
              backendKind: "gemini-api-key",
            },
            modelDescriptor: model,
            providerConfig: { apiKey: "fixture", baseUrl: "https://fixture.test/v1beta" },
            workspaceRoot: "/tmp",
            runtime,
          },
          { onResponse: () => resolve(), onError: reject },
        ),
      );
      expect(url).toBe(`https://fixture.test/v1beta/${id}:generateContent`);
      expect(body.generationConfig).toEqual({ thinkingConfig: thinking });
      expect(url).not.toContain("fixture-key");
    } finally {
      globalThis.fetch = original;
      resetGeminiRouteValidationCacheForTests();
    }
  });

test("Gemini CLI settings reach child process and are removed after completion", async () => {
  const root = mkdtempSync(join(tmpdir(), "ubume-google-payload-"));
  let settingsPath = "";
  let settings: Record<string, unknown> = {};
  const id = "gemini-2.5-pro";
  const model = parseGeminiModels(
    { availableModels: [{ modelId: id, name: "Gemini 2.5 Pro" }] },
    true,
  )[0]!;
  const request: ProviderChatRequest = {
    prompt: "hello",
    route: {
      providerId: "google",
      modelId: id,
      reasoning: "budget:2048",
      backendKind: "gemini-cli-auth",
    },
    modelDescriptor: model,
    workspaceRoot: root,
    runtime: { ...runtime, geminiCommandPath: "gemini" },
  };
  const runner = ((spec: CommandSpec) => {
    if (spec.args.includes("-p")) {
      settingsPath = spec.env?.GEMINI_CLI_SYSTEM_SETTINGS_PATH ?? "";
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(spec.args[1]).toBe(id);
    }
    return { child: null, result: Promise.resolve(result), cancel: () => {} };
  }) as unknown as typeof runCommand;
  try {
    expect(await runGeminiCliWithRunner(request, runner)).toBe("OK");
    expect((settings.modelConfigs as { overrides: unknown[] }).overrides.at(-1)).toEqual({
      match: { model: id },
      modelConfig: { generateContentConfig: { thinkingConfig: { thinkingBudget: 2048 } } },
    });
    expect(existsSync(settingsPath)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude Messages API sends configured endpoint, native ID and only advertised effort", async () => {
  const { anthropicRuntime, resetAnthropicRouteValidationCacheForTests } = await import(
    "./anthropic.js"
  );
  const { parseAnthropicModels } = await import("./anthropicDiscovery.js");
  const model = parseAnthropicModels({
    data: [
      {
        id: "claude-future-99",
        capabilities: { effort: { supported: true, high: { supported: true } } },
      },
    ],
  })[0]!;
  const original = globalThis.fetch;
  let url = "";
  let payload: Record<string, unknown> = {};
  resetAnthropicRouteValidationCacheForTests();
  try {
    globalThis.fetch = (async (input, init) => {
      url = String(input);
      payload = JSON.parse(String(init?.body));
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("fixture");
      return Response.json({ content: [{ type: "text", text: "OK" }] });
    }) as typeof fetch;
    await new Promise<void>((resolve, reject) =>
      anthropicRuntime.run!(
        {
          prompt: "hello",
          route: {
            providerId: "anthropic",
            modelId: model.modelId,
            backendKind: "anthropic-api-key",
            reasoning: "high",
          },
          modelDescriptor: model,
          workspaceRoot: "/tmp",
          runtime,
          providerConfig: { apiKey: "fixture", baseUrl: "https://fixture.test" },
        },
        { onResponse: () => resolve(), onError: reject },
      ),
    );
    expect(url).toBe("https://fixture.test/v1/messages");
    expect(payload.model).toBe(model.modelId);
    expect(payload.output_config).toEqual({ effort: "high" });
  } finally {
    globalThis.fetch = original;
    resetAnthropicRouteValidationCacheForTests();
  }
});

test("Claude effort rejection reconciles catalog, footer and actual retry payload", async () => {
  const { providerCatalog } = await import("../models/modelCatalog.js");
  const { getProviderRuntime } = await import("./registry.js");
  const { resetAnthropicRouteValidationCacheForTests, runClaudeCodeWithRunner } = await import(
    "./anthropic.js"
  );
  const { providerModelsToCodexCapabilities } = await import("./models.js");
  const { buildActiveRuntimeDisplay } = await import("../../ui/render/runtimeDisplay.js");
  const levels = [
    { id: "low", label: "Low", description: null },
    { id: "high", label: "High", description: null },
  ];
  const model = {
    id: "opus-test",
    modelId: "opus-test",
    label: "Opus Test",
    description: null,
    defaultReasoningLevel: "low",
    supportedReasoningLevels: levels,
    reasoningControl: {
      kind: "levels" as const,
      levels,
      default: "low",
      transport: "parameter" as const,
    },
    source: "discovered" as const,
  };
  resetAnthropicRouteValidationCacheForTests([model]);
  const native = getProviderRuntime("anthropic");
  const discovery = {
    status: "ready" as const,
    providerId: "anthropic" as const,
    backendKind: native.backendKind,
    models: [model],
  };
  try {
    await providerCatalog.refresh(
      { ...native, discoverModels: () => discovery, refreshModels: async () => discovery },
      { cwd: "/tmp/claude-effort-fixture", forceRefresh: true },
    );
    const descriptor = providerCatalog.get("anthropic")!.models[0]!;
    const efforts: string[] = [];
    const route = {
      providerId: "anthropic" as const,
      modelId: model.modelId,
      reasoning: "high",
      backendKind: native.backendKind,
    };
    const runner = ((spec: CommandSpec) => {
      const effort = spec.args[spec.args.indexOf("--effort") + 1]!;
      efforts.push(effort);
      return {
        child: null,
        result: Promise.resolve(
          effort === "high"
            ? {
                ...result,
                status: "failed",
                exitCode: 2,
                stdout: "",
                stderr: "Invalid effort high for selected model. Valid efforts: low.",
                userMessage: "Invalid effort high.",
              }
            : result,
        ),
        cancel: () => {},
      };
    }) as unknown as typeof runCommand;
    await new Promise<string>((resolve, reject) =>
      runClaudeCodeWithRunner(
        { prompt: "hi", route, modelDescriptor: descriptor, workspaceRoot: "/tmp", runtime },
        { onResponse: resolve, onError: reject },
        runner,
        "claude",
      ),
    );
    expect(efforts).toEqual(["high", "low"]);
    const updated = providerCatalog.get("anthropic")!.models;
    expect(updated[0]!.supportedReasoningLevels?.map((l) => l.id)).toEqual(["low"]);
    const capability = providerModelsToCodexCapabilities(updated, model.modelId).models[0]!;
    const display = buildActiveRuntimeDisplay({
      route,
      reasoningLevel: "high",
      mode: "auto",
      tokensUsed: 0,
      modelCapability: capability,
    });
    expect(display.footerModelDisplay).toContain("(Low)");
    expect(display.footerModelDisplay).not.toContain("(High)");
  } finally {
    providerCatalog.dispose();
    resetAnthropicRouteValidationCacheForTests();
  }
});
