import assert from "node:assert/strict";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { runCommand, type CommandResult } from "../process/CommandRunner.js";
import {
  GEMINI_ROUTE_SETUP_MESSAGE,
  hasGeminiApiKey,
  isGeminiRouteConfigured,
  resetGeminiRouteValidationCacheForTests,
  validateGeminiRoute,
} from "./gemini.js";

function commandResult(overrides: Partial<CommandResult>): CommandResult {
  return {
    status: "completed",
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    startedAt: 0,
    endedAt: 0,
    durationMs: 0,
    userMessage: "Command completed.",
    ...overrides,
  };
}

async function withGeminiEnv<T>(
  env: Partial<NodeJS.ProcessEnv>,
  callback: () => T | Promise<T>,
): Promise<T> {
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
    return await callback();
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

function mockRunCommand(result: CommandResult, onCall?: (spec: Parameters<typeof runCommand>[0]) => void): typeof runCommand {
  return ((spec) => {
    onCall?.(spec);
    return {
      child: null as unknown as ChildProcess,
      result: Promise.resolve(result),
      cancel: () => undefined,
    };
  }) as typeof runCommand;
}

test("Gemini route validation fails without API key or authenticated headless CLI", async () => {
  await withGeminiEnv({}, async () => {
    const validation = await validateGeminiRoute({
      cwd: process.cwd(),
      modelId: "gemini-3.1-pro",
      runCommandImpl: mockRunCommand(commandResult({
        status: "spawn_error",
        exitCode: null,
        errorCode: "ENOENT",
        userMessage: "`gemini` is not installed or not available on PATH.",
      })),
    });

    assert.equal(validation.status, "not-configured");
    assert.equal(validation.backendKind, "not-configured");
    assert.equal(validation.message, GEMINI_ROUTE_SETUP_MESSAGE);
    assert.equal(isGeminiRouteConfigured(), false);
  });
});

test("Gemini route validation allows GEMINI_API_KEY without launching CLI", async () => {
  await withGeminiEnv({ GEMINI_API_KEY: "gemini-key" }, async () => {
    let commandCalled = false;
    const validation = await validateGeminiRoute({
      cwd: process.cwd(),
      modelId: "gemini-3.1-pro",
      runCommandImpl: mockRunCommand(commandResult({}), () => {
        commandCalled = true;
      }),
    });

    assert.equal(validation.status, "ready");
    assert.equal(validation.backendKind, "google-api");
    assert.equal(commandCalled, false);
    assert.equal(hasGeminiApiKey(), true);
    assert.equal(isGeminiRouteConfigured(), true);
  });
});

test("Gemini route validation allows GOOGLE_API_KEY without launching CLI", async () => {
  await withGeminiEnv({ GOOGLE_API_KEY: "google-key" }, async () => {
    let commandCalled = false;
    const validation = await validateGeminiRoute({
      cwd: process.cwd(),
      modelId: "gemini-3.1-pro",
      runCommandImpl: mockRunCommand(commandResult({}), () => {
        commandCalled = true;
      }),
    });

    assert.equal(validation.status, "ready");
    assert.equal(validation.backendKind, "google-api");
    assert.equal(commandCalled, false);
    assert.equal(hasGeminiApiKey(), true);
  });
});

test("Gemini route validation accepts authenticated headless CLI", async () => {
  await withGeminiEnv({}, async () => {
    let observedArgs: readonly string[] = [];
    const validation = await validateGeminiRoute({
      cwd: process.cwd(),
      modelId: "gemini-3.1-pro",
      runCommandImpl: mockRunCommand(commandResult({
        stdout: JSON.stringify({ response: "READY" }),
      }), (spec) => {
        observedArgs = spec.args;
      }),
    });

    assert.equal(validation.status, "ready");
    assert.equal(validation.backendKind, "gemini-cli-headless");
    assert.deepEqual(observedArgs, [
      "--prompt",
      "Respond with READY only.",
      "--model",
      "gemini-3.1-pro",
      "--output-format",
      "json",
    ]);
    assert.equal(isGeminiRouteConfigured(), true);
  });
});
