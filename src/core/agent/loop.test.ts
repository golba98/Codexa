import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeRuntimeConfig, resolveRuntimeConfig } from "../../config/runtimeConfig.js";
import type { ProviderChatRequest } from "../providerRuntime/types.js";
import { runAgentLoop, type AgentChatMessage } from "./loop.js";

function request(workspaceRoot: string, prompt: string): ProviderChatRequest {
  return {
    prompt,
    workspaceRoot,
    runtime: resolveRuntimeConfig(normalizeRuntimeConfig({
      policy: { sandboxMode: "danger-full-access" },
    })),
    route: {
      providerId: "local",
      modelId: "test-model",
      backendKind: "local-openai-compatible",
    },
  };
}

async function withTempWorkspace<T>(callback: (workspaceRoot: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexa-agent-loop-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function handlers() {
  const tools: string[] = [];
  return {
    tools,
    handlers: {
      onResponse: () => undefined,
      onError: assert.fail,
      onToolActivity: (activity: { status: string; command: string }) => {
        if (activity.status !== "running") tools.push(activity.command);
      },
    },
  };
}

test("create a rust hello world project leads to write_file and final summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const observed = handlers();
    const replies = [
      '<tool_call>{"name":"write_file","arguments":{"path":"Cargo.toml","content":"[package]\\nname = \\"hello\\"\\nversion = \\"0.1.0\\"\\nedition = \\"2021\\"\\n"}}</tool_call>',
      "Created Cargo.toml.",
    ];

    const text = await runAgentLoop({
      request: request(workspaceRoot, "create a rust hello world project here"),
      handlers: observed.handlers,
      includeSystemPrompt: true,
      sendMessages: async () => ({ text: replies.shift() ?? "done" }),
    });

    assert.equal(text, "Created Cargo.toml.");
    assert.match(await readFile(path.join(workspaceRoot, "Cargo.toml"), "utf8"), /name = "hello"/);
    assert.deepEqual(observed.tools, ["write_file: Cargo.toml"]);
  });
});

test("open the main file and fix the bug performs read then write", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeFile(path.join(workspaceRoot, "main.ts"), "const value = false;\n", "utf8");
    const replies = [
      '<tool_call>{"name":"read_file","arguments":{"path":"main.ts"}}</tool_call>',
      '<tool_call>{"name":"write_file","arguments":{"path":"main.ts","content":"const value = true;\\n"}}</tool_call>',
      "Fixed main.ts.",
    ];

    const text = await runAgentLoop({
      request: request(workspaceRoot, "open the main file and fix the bug"),
      handlers: handlers().handlers,
      includeSystemPrompt: true,
      sendMessages: async () => ({ text: replies.shift() ?? "done" }),
    });

    assert.equal(text, "Fixed main.ts.");
    assert.equal(await readFile(path.join(workspaceRoot, "main.ts"), "utf8"), "const value = true;\n");
  });
});

test("run it performs run_shell", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const text = await runAgentLoop({
      request: request(workspaceRoot, "run it"),
      handlers: handlers().handlers,
      includeSystemPrompt: true,
      sendMessages: async (_messages: readonly AgentChatMessage[], index) => ({
        text: index === 0
          ? '<tool_call>{"name":"run_shell","arguments":{"command":"printf ok"}}</tool_call>'
          : "It prints ok.",
      }),
    });

    assert.equal(text, "It prints ok.");
  });
});

test("structured provider tool calls are executed before final text", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const text = await runAgentLoop({
      request: request(workspaceRoot, "write a rust file"),
      handlers: handlers().handlers,
      includeSystemPrompt: true,
      sendMessages: async (_messages: readonly AgentChatMessage[], index) => ({
        text: index === 0 ? "" : "Created main.rs.",
        toolCalls: index === 0
          ? [{
            name: "write_file",
            arguments: { path: "main.rs", content: "fn main() { println!(\"hi\"); }\n" },
          }]
          : undefined,
      }),
    });

    assert.equal(text, "Created main.rs.");
    assert.equal(await readFile(path.join(workspaceRoot, "main.rs"), "utf8"), "fn main() { println!(\"hi\"); }\n");
  });
});

test("loop synthesizes a useful final answer after max tool calls", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const text = await runAgentLoop({
      request: request(workspaceRoot, "keep listing"),
      handlers: handlers().handlers,
      includeSystemPrompt: true,
      maxToolCalls: 1,
      sendMessages: async (_messages: readonly AgentChatMessage[], index) => ({
        text: index <= 1
          ? '<tool_call>{"name":"list_files","arguments":{"path":"."}}</tool_call>'
          : "",
      }),
    });

    assert.match(text, /repeated the same list_files tool call|reached 1 tool calls/i);
    assert.match(text, /Files changed:/);
    assert.match(text, /Commands run:/);
    assert.match(text, /Next command:/);
  });
});

test("duplicate identical tool call asks for final answer instead of executing again", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    let chatCalls = 0;
    const bodies: AgentChatMessage[][] = [];
    const text = await runAgentLoop({
      request: request(workspaceRoot, "write main"),
      handlers: handlers().handlers,
      includeSystemPrompt: true,
      sendMessages: async (messages: readonly AgentChatMessage[]) => {
        bodies.push([...messages]);
        chatCalls += 1;
        if (chatCalls === 1) {
          return { text: '<tool_call>{"name":"write_file","arguments":{"path":"main.rs","content":"fn main() {}\\n"}}</tool_call>' };
        }
        if (chatCalls === 2) {
          return { text: '<tool_call>{"name":"write_file","arguments":{"path":"main.rs","content":"fn main() {}\\n"}}</tool_call>' };
        }
        return { text: "Finalized after the write." };
      },
    });

    assert.equal(text, "Finalized after the write.");
    assert.equal(chatCalls, 3);
    assert.match(bodies.at(-1)?.at(-1)?.content ?? "", /repeated the same write_file tool call/i);
    assert.equal(await readFile(path.join(workspaceRoot, "main.rs"), "utf8"), "fn main() {}\n");
  });
});
