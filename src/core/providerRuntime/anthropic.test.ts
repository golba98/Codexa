import assert from "node:assert/strict";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { normalizeRuntimeConfig, resolveRuntimeConfig } from "../../config/runtimeConfig.js";
import { runCommand, type CommandResult } from "../process/CommandRunner.js";
import {
  ANTHROPIC_ROUTE_SETUP_MESSAGE,
  anthropicRuntime,
  resetAnthropicRouteValidationCacheForTests,
  validateAnthropicRoute,
} from "./anthropic.js";
import type { ProviderChatRequest } from "./types.js";

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

function buildRequest(): ProviderChatRequest {
  return {
    prompt: "Say hi.",
    route: {
      providerId: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      backendKind: "anthropic-api-key",
      reasoning: "high",
    },
    runtime: resolveRuntimeConfig(normalizeRuntimeConfig({})),
    workspaceRoot: process.cwd(),
    projectInstructions: {
      path: "AGENTS.md",
      content: "Be brief.",
    },
  };
}

async function withAnthropicEnv<T>(
  env: Partial<NodeJS.ProcessEnv>,
  callback: () => T | Promise<T>,
): Promise<T> {
  const original = process.env.ANTHROPIC_API_KEY;
  try {
    if ("ANTHROPIC_API_KEY" in env) {
      process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    return await callback();
  } finally {
    if (original === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = original;
    }
    resetAnthropicRouteValidationCacheForTests();
  }
}

test("Anthropic runtime sends prompts through the Messages API", async () => {
  await withAnthropicEnv({ ANTHROPIC_API_KEY: "test-anthropic-key" }, async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    try {
      globalThis.fetch = (async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(JSON.stringify({
          content: [{ type: "text", text: "Hi from Claude." }],
        }), { status: 200 });
      }) as typeof fetch;

      const response = await new Promise<string>((resolve, reject) => {
        anthropicRuntime.run?.(buildRequest(), {
          onResponse: resolve,
          onError: reject,
        });
      });

      assert.equal(response, "Hi from Claude.");
      assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
      assert.equal(capturedInit?.method, "POST");
      assert.equal((capturedInit?.headers as Record<string, string>)["x-api-key"], "test-anthropic-key");
      assert.equal((capturedInit?.headers as Record<string, string>)["anthropic-version"], "2023-06-01");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("Anthropic route validation prefers authenticated Claude Code over API key", async () => {
  await withAnthropicEnv({ ANTHROPIC_API_KEY: "anthropic-key" }, async () => {
    let commandCalled = false;
    const validation = await validateAnthropicRoute({
      cwd: process.cwd(),
      runCommandImpl: mockRunCommand(commandResult({
        stdout: "READY",
      }), () => {
        commandCalled = true;
      }),
    });

    assert.equal(validation.status, "ready");
    assert.equal(validation.backendKind, "claude-code-auth");
    assert.equal(commandCalled, true);
  });
});

test("Anthropic route validation falls back to ANTHROPIC_API_KEY if Claude Code fails", async () => {
  await withAnthropicEnv({ ANTHROPIC_API_KEY: "anthropic-key" }, async () => {
    const validation = await validateAnthropicRoute({
      cwd: process.cwd(),
      runCommandImpl: mockRunCommand(commandResult({
        status: "spawn_error",
        exitCode: 1,
      })),
    });

    assert.equal(validation.status, "ready");
    assert.equal(validation.backendKind, "anthropic-api-key");
  });
});

test("Anthropic route validation fails without API key or authenticated Claude Code", async () => {
  await withAnthropicEnv({}, async () => {
    const validation = await validateAnthropicRoute({
      cwd: process.cwd(),
      runCommandImpl: mockRunCommand(commandResult({
        status: "spawn_error",
        exitCode: 1,
      })),
    });

    assert.equal(validation.status, "not-configured");
    assert.equal(validation.backendKind, "unavailable");
    assert.match(validation.message!, /Sign in with Claude Code/);
  });
});
