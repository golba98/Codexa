import assert from "node:assert/strict";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { normalizeRuntimeConfig, resolveRuntimeConfig } from "../../config/runtimeConfig.js";
import { runCommand, type CommandResult, type CommandSpec } from "../process/CommandRunner.js";
import {
  ANTIGRAVITY_DEFAULT_MODEL_ID,
  ANTIGRAVITY_DEFAULT_REASONING,
  ANTIGRAVITY_MODELS,
  buildAgyEnv,
  getAgyModelEnvValue,
  getAntigravityModelLabel,
  migrateAntigravityLegacyModelId,
  resetAntigravityRouteValidationCacheForTests,
  runAntigravityWithRunner,
  validateAntigravityRoute,
  antigravityRuntime,
} from "./antigravity.js";
import { resetAgyExecutableCacheForTests } from "../executables/antigravityExecutable.js";
import type { ProviderChatRequest } from "./types.js";

function commandResult(overrides: Partial<CommandResult>): CommandResult {
  return {
    status: "completed",
    exitCode: 0,
    signal: null,
    stdout: "Hello back!",
    stderr: "",
    startedAt: 0,
    endedAt: 0,
    durationMs: 0,
    userMessage: "Command completed.",
    ...overrides,
  };
}

function mockRunCommand(
  resultOrFn: CommandResult | ((spec: Parameters<typeof runCommand>[0]) => CommandResult),
  onCall?: (spec: Parameters<typeof runCommand>[0]) => void,
): typeof runCommand {
  return ((spec) => {
    onCall?.(spec);
    const result = typeof resultOrFn === "function" ? resultOrFn(spec) : resultOrFn;
    return {
      child: null as unknown as ChildProcess,
      result: Promise.resolve(result),
      cancel: () => undefined,
    };
  }) as typeof runCommand;
}

function buildRequest(overrides: Partial<ProviderChatRequest> = {}): ProviderChatRequest {
  const runtime = normalizeRuntimeConfig({});
  return {
    prompt: "say hello back",
    route: {
      providerId: "antigravity",
      modelId: ANTIGRAVITY_DEFAULT_MODEL_ID,
      backendKind: "antigravity-cli-auth",
    },
    runtime: resolveRuntimeConfig(runtime),
    workspaceRoot: "/tmp",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------

test("ANTIGRAVITY_MODELS contains exactly 5 profiles (2 Gemini families + Claude Sonnet + Claude Opus + GPT-OSS)", () => {
  assert.equal(ANTIGRAVITY_MODELS.length, 5);
});

test("Gemini 3.5 Flash appears once, not three times", () => {
  const geminiFlash = ANTIGRAVITY_MODELS.filter((m) => m.label.includes("Gemini 3.5 Flash"));
  assert.equal(geminiFlash.length, 1, "Gemini 3.5 Flash should appear exactly once");
  assert.equal(geminiFlash[0]!.id, "gemini-3.5-flash");
});

test("Gemini 3.1 Pro appears once, not two times", () => {
  const geminiPro = ANTIGRAVITY_MODELS.filter((m) => m.label.includes("Gemini 3.1 Pro"));
  assert.equal(geminiPro.length, 1, "Gemini 3.1 Pro should appear exactly once");
  assert.equal(geminiPro[0]!.id, "gemini-3.1-pro");
});

test("ANTIGRAVITY_MODELS contains all required display labels", () => {
  const labels = ANTIGRAVITY_MODELS.map((m) => m.label);
  assert.ok(labels.includes("Gemini 3.5 Flash"), "missing Gemini 3.5 Flash");
  assert.ok(labels.includes("Gemini 3.1 Pro"), "missing Gemini 3.1 Pro");
  assert.ok(labels.includes("Claude Sonnet 4.6 (Thinking)"), "missing Claude Sonnet 4.6 (Thinking)");
  assert.ok(labels.includes("Claude Opus 4.6 (Thinking)"), "missing Claude Opus 4.6 (Thinking)");
  assert.ok(labels.includes("GPT-OSS 120B"), "missing GPT-OSS 120B");
});

test("Gemini 3.5 Flash supports Low/Medium/High reasoning (3 levels)", () => {
  const model = ANTIGRAVITY_MODELS.find((m) => m.id === "gemini-3.5-flash");
  assert.ok(model, "gemini-3.5-flash not found");
  assert.ok(model!.supportedReasoningLevels !== null, "supportedReasoningLevels should not be null");
  assert.equal(model!.supportedReasoningLevels!.length, 3);
  const ids = model!.supportedReasoningLevels!.map((l) => l.id);
  assert.ok(ids.includes("low"), "missing low");
  assert.ok(ids.includes("medium"), "missing medium");
  assert.ok(ids.includes("high"), "missing high");
});

test("Gemini 3.1 Pro supports Low/High reasoning (2 levels, no Medium)", () => {
  const model = ANTIGRAVITY_MODELS.find((m) => m.id === "gemini-3.1-pro");
  assert.ok(model, "gemini-3.1-pro not found");
  assert.ok(model!.supportedReasoningLevels !== null, "supportedReasoningLevels should not be null");
  assert.equal(model!.supportedReasoningLevels!.length, 2);
  const ids = model!.supportedReasoningLevels!.map((l) => l.id);
  assert.ok(ids.includes("low"), "missing low");
  assert.ok(ids.includes("high"), "missing high");
  assert.ok(!ids.includes("medium"), "Gemini 3.1 Pro should not have medium");
});

test("Claude Sonnet, Claude Opus, and GPT-OSS 120B have no reasoning levels", () => {
  for (const id of ["claude-sonnet-4-6-think", "claude-opus-4-6-think", "gpt-oss-120b"]) {
    const model = ANTIGRAVITY_MODELS.find((m) => m.id === id);
    assert.ok(model, `${id} not found`);
    assert.equal(model!.supportedReasoningLevels, null, `${id} should have null supportedReasoningLevels`);
  }
});

test("GPT-OSS 120B label is 'GPT-OSS 120B' (not 'GPT-OSS 120B (Medium)')", () => {
  const model = ANTIGRAVITY_MODELS.find((m) => m.id === "gpt-oss-120b");
  assert.ok(model, "gpt-oss-120b not found");
  assert.equal(model!.label, "GPT-OSS 120B");
});

test("default model is 'gemini-3.5-flash' with defaultReasoningLevel 'high'", () => {
  assert.equal(ANTIGRAVITY_DEFAULT_MODEL_ID, "gemini-3.5-flash");
  assert.equal(ANTIGRAVITY_DEFAULT_REASONING, "high");
  const defaultModel = ANTIGRAVITY_MODELS.find((m) => m.id === ANTIGRAVITY_DEFAULT_MODEL_ID);
  assert.ok(defaultModel, "default model not found in ANTIGRAVITY_MODELS");
  assert.equal(defaultModel!.label, "Gemini 3.5 Flash");
  assert.equal(defaultModel!.defaultReasoningLevel, "high");
});

// ---------------------------------------------------------------------------
// AGY_MODEL env mapping
// ---------------------------------------------------------------------------

test("getAgyModelEnvValue: gemini-3.5-flash maps to verified 'gemini-3.5-flash'", () => {
  assert.equal(getAgyModelEnvValue("gemini-3.5-flash"), "gemini-3.5-flash");
});

test("getAgyModelEnvValue: gemini-3.1-pro maps to 'gemini-3.1-pro'", () => {
  assert.equal(getAgyModelEnvValue("gemini-3.1-pro"), "gemini-3.1-pro");
});

test("getAgyModelEnvValue: claude and gpt-oss models return null (no AGY_MODEL override)", () => {
  assert.equal(getAgyModelEnvValue("claude-sonnet-4-6-think"), null);
  assert.equal(getAgyModelEnvValue("claude-opus-4-6-think"), null);
  assert.equal(getAgyModelEnvValue("gpt-oss-120b"), null);
});

test("buildAgyEnv: sets AGY_MODEL for Gemini 3.5 Flash", () => {
  const env = buildAgyEnv("gemini-3.5-flash");
  assert.equal(env.AGY_MODEL, "gemini-3.5-flash");
});

test("buildAgyEnv: sets AGY_MODEL for Gemini 3.1 Pro", () => {
  const env = buildAgyEnv("gemini-3.1-pro");
  assert.equal(env.AGY_MODEL, "gemini-3.1-pro");
});

test("buildAgyEnv: does not set AGY_MODEL for Claude/GPT-OSS models", () => {
  const prevAgyModel = process.env.AGY_MODEL;
  delete process.env.AGY_MODEL;
  try {
    const env = buildAgyEnv("claude-sonnet-4-6-think");
    assert.equal(env.AGY_MODEL, undefined);
  } finally {
    if (prevAgyModel !== undefined) process.env.AGY_MODEL = prevAgyModel;
  }
});

// ---------------------------------------------------------------------------
// Legacy model ID migration
// ---------------------------------------------------------------------------

test("migrateAntigravityLegacyModelId: maps old compound IDs to family + reasoning", () => {
  assert.deepEqual(migrateAntigravityLegacyModelId("gemini-3.5-flash-high"),   { modelId: "gemini-3.5-flash", reasoning: "high" });
  assert.deepEqual(migrateAntigravityLegacyModelId("gemini-3.5-flash-medium"), { modelId: "gemini-3.5-flash", reasoning: "medium" });
  assert.deepEqual(migrateAntigravityLegacyModelId("gemini-3.5-flash-low"),    { modelId: "gemini-3.5-flash", reasoning: "low" });
  assert.deepEqual(migrateAntigravityLegacyModelId("gemini-3.1-pro-high"),     { modelId: "gemini-3.1-pro",   reasoning: "high" });
  assert.deepEqual(migrateAntigravityLegacyModelId("gemini-3.1-pro-low"),      { modelId: "gemini-3.1-pro",   reasoning: "low" });
  assert.deepEqual(migrateAntigravityLegacyModelId("gpt-oss-120b-medium"),     { modelId: "gpt-oss-120b" });
});

test("migrateAntigravityLegacyModelId: passes through current model IDs unchanged", () => {
  assert.deepEqual(migrateAntigravityLegacyModelId("gemini-3.5-flash"),      { modelId: "gemini-3.5-flash" });
  assert.deepEqual(migrateAntigravityLegacyModelId("gemini-3.1-pro"),        { modelId: "gemini-3.1-pro" });
  assert.deepEqual(migrateAntigravityLegacyModelId("claude-sonnet-4-6-think"), { modelId: "claude-sonnet-4-6-think" });
  assert.deepEqual(migrateAntigravityLegacyModelId("gpt-oss-120b"),          { modelId: "gpt-oss-120b" });
});

// ---------------------------------------------------------------------------
// Model label display
// ---------------------------------------------------------------------------

test("getAntigravityModelLabel: returns display label for known model ids", () => {
  assert.equal(getAntigravityModelLabel("gemini-3.5-flash"), "Gemini 3.5 Flash");
  assert.equal(getAntigravityModelLabel("gemini-3.1-pro"), "Gemini 3.1 Pro");
  assert.equal(getAntigravityModelLabel("claude-sonnet-4-6-think"), "Claude Sonnet 4.6 (Thinking)");
  assert.equal(getAntigravityModelLabel("gpt-oss-120b"), "GPT-OSS 120B");
});

test("getAntigravityModelLabel: falls back to raw modelId for unknown id", () => {
  assert.equal(getAntigravityModelLabel("unknown-model"), "unknown-model");
});

// ---------------------------------------------------------------------------
// Command construction
// ---------------------------------------------------------------------------

test("runAntigravityWithRunner: spawns agy with -p flag and the prompt", async () => {
  let capturedSpec: CommandSpec | null = null;
  const runner = mockRunCommand(commandResult({}), (spec) => { capturedSpec = spec; });

  await new Promise<void>((resolve) => {
    const cancel = runAntigravityWithRunner(
      buildRequest({ prompt: "say hello back" }),
      {
        onResponse: () => resolve(),
        onError: (msg) => { throw new Error(msg); },
      },
      runner,
      "agy",
    );
    void cancel;
  });

  assert.ok(capturedSpec !== null, "runCommand was not called");
  assert.equal((capturedSpec as CommandSpec).executable, "agy");
  assert.deepEqual((capturedSpec as CommandSpec).args, ["-p", "say hello back"]);
});

test("runAntigravityWithRunner: wraps a .cmd executable in cmd.exe on Windows, keeping the prompt as one arg", async () => {
  let capturedSpec: CommandSpec | null = null;
  const runner = mockRunCommand(commandResult({}), (spec) => { capturedSpec = spec; });

  await new Promise<void>((resolve) => {
    runAntigravityWithRunner(
      buildRequest({ prompt: "say hello back" }),
      { onResponse: () => resolve(), onError: (msg) => { throw new Error(msg); } },
      runner,
      "agy.cmd",
      "win32",
    );
  });

  assert.ok(capturedSpec !== null, "runCommand was not called");
  assert.equal((capturedSpec as CommandSpec).executable, "cmd.exe");
  assert.deepEqual((capturedSpec as CommandSpec).args, ["/d", "/s", "/c", "call", "agy.cmd", "-p", "say hello back"]);
});

test("runAntigravityWithRunner: passes a .cmd executable through unchanged on non-Windows", async () => {
  let capturedSpec: CommandSpec | null = null;
  const runner = mockRunCommand(commandResult({}), (spec) => { capturedSpec = spec; });

  await new Promise<void>((resolve) => {
    runAntigravityWithRunner(
      buildRequest({ prompt: "say hello back" }),
      { onResponse: () => resolve(), onError: (msg) => { throw new Error(msg); } },
      runner,
      "agy.cmd",
      "linux",
    );
  });

  assert.ok(capturedSpec !== null, "runCommand was not called");
  assert.equal((capturedSpec as CommandSpec).executable, "agy.cmd");
  assert.deepEqual((capturedSpec as CommandSpec).args, ["-p", "say hello back"]);
});

test("runAntigravityWithRunner: sets AGY_MODEL=gemini-3.5-flash for default profile", async () => {
  let capturedEnv: NodeJS.ProcessEnv | null | undefined;
  const runner = mockRunCommand(commandResult({}), (spec) => { capturedEnv = spec.env; });

  await new Promise<void>((resolve) => {
    runAntigravityWithRunner(
      buildRequest({ route: { providerId: "antigravity", modelId: "gemini-3.5-flash", backendKind: "antigravity-cli-auth", reasoning: "high" } }),
      { onResponse: () => resolve(), onError: (msg) => { throw new Error(msg); } },
      runner,
      "agy",
    );
  });

  assert.equal(capturedEnv?.AGY_MODEL, "gemini-3.5-flash");
});

test("runAntigravityWithRunner: does not set AGY_MODEL for Claude models", async () => {
  let capturedEnv: NodeJS.ProcessEnv | null | undefined;
  const runner = mockRunCommand(commandResult({}), (spec) => { capturedEnv = spec.env; });

  const prevAgyModel = process.env.AGY_MODEL;
  delete process.env.AGY_MODEL;

  try {
    await new Promise<void>((resolve) => {
      runAntigravityWithRunner(
        buildRequest({ route: { providerId: "antigravity", modelId: "claude-sonnet-4-6-think", backendKind: "antigravity-cli-auth" } }),
        { onResponse: () => resolve(), onError: (msg) => { throw new Error(msg); } },
        runner,
        "agy",
      );
    });
    assert.equal(capturedEnv?.AGY_MODEL, undefined);
  } finally {
    if (prevAgyModel !== undefined) process.env.AGY_MODEL = prevAgyModel;
  }
});

test("runAntigravityWithRunner: calls onError when agy exits non-zero", async () => {
  const runner = mockRunCommand(commandResult({ status: "failed", exitCode: 1, stdout: "", stderr: "auth error" }));

  const errorMsg = await new Promise<string>((resolve) => {
    runAntigravityWithRunner(
      buildRequest(),
      { onResponse: () => { throw new Error("unexpected success"); }, onError: resolve },
      runner,
      "agy",
    );
  });

  assert.ok(errorMsg.length > 0, "expected a non-empty error message");
});

// ---------------------------------------------------------------------------
// Route validation
// ---------------------------------------------------------------------------

test("validateAntigravityRoute: returns not-configured when agy binary is missing (spawn_error)", async () => {
  resetAntigravityRouteValidationCacheForTests();
  const result = await validateAntigravityRoute({
    cwd: "/tmp",
    configuredPath: null,
    runCommandImpl: mockRunCommand(commandResult({ status: "spawn_error", exitCode: null, userMessage: "`agy` is not installed." })),
  });

  assert.equal(result.status, "not-configured");
  assert.ok(result.message?.includes("agy"), "message should mention agy");
});

test("validateAntigravityRoute: returns ready when agy --help succeeds", async () => {
  resetAntigravityRouteValidationCacheForTests();
  const result = await validateAntigravityRoute({
    cwd: "/tmp",
    runCommandImpl: mockRunCommand((spec) => {
      if (spec.args[0] === "--help") {
        return commandResult({ status: "completed", exitCode: 0, stdout: "Usage of agy..." });
      }
      return commandResult({ status: "failed", exitCode: 1 });
    }),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.backendKind, "antigravity-cli-auth");
});

test("validateAntigravityRoute: wraps a .cmd executable probe in cmd.exe on Windows", async () => {
  resetAntigravityRouteValidationCacheForTests();
  let capturedSpec: CommandSpec | null = null;
  const result = await validateAntigravityRoute({
    cwd: "/tmp",
    configuredPath: "agy.cmd",
    platform: "win32",
    runCommandImpl: mockRunCommand(
      commandResult({ status: "completed", exitCode: 0, stdout: "Usage of agy..." }),
      (spec) => { capturedSpec = spec; },
    ),
  });

  assert.equal(result.status, "ready");
  assert.ok(capturedSpec !== null, "probe runCommand was not called");
  assert.equal((capturedSpec as CommandSpec).executable, "cmd.exe");
  assert.deepEqual((capturedSpec as CommandSpec).args, ["/d", "/s", "/c", "call", "agy.cmd", "--help"]);
});

// ---------------------------------------------------------------------------
// Runtime interface
// ---------------------------------------------------------------------------

test("antigravityRuntime exposes routeAvailable: true and correct backendKind", () => {
  assert.equal(antigravityRuntime.routeAvailable, true);
  assert.equal(antigravityRuntime.backendKind, "antigravity-cli-auth");
  assert.equal(antigravityRuntime.providerId, "antigravity");
});

test("antigravityRuntime.discoverModels returns all 5 profiles", () => {
  const result = antigravityRuntime.discoverModels();
  assert.equal(result.status, "ready");
  assert.equal(result.models.length, 5);
  assert.equal(result.providerId, "antigravity");
});
