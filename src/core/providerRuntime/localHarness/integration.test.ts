import { createServer } from "node:http";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeRuntimeConfig, resolveRuntimeConfig } from "../../../config/runtimeConfig.js";
import { localRuntime } from "../local.js";
import { shutdownLocalHarness } from "./runtime.js";

test("packaged Harness completes a Local Unsloth turn against a mock inference server", { timeout: 25_000 }, async () => {
  const workspace = mkdtempSync(join(tmpdir(), "ubume-real-harness-"));
  const keys = ["UBUME_DATA_DIR", "UNSLOTH_STUDIO_URL", "UNSLOTH_API_KEY", "UBUME_BROWSER_ENABLED"] as const;
  const previous = keys.map((key) => process.env[key]);
  let inferenceCalls = 0;
  let registeredTools: string[] = [];
  const respond = (request: Request): Response => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/models")) return Response.json({ data: [{ id: "fixture", loaded: true }] });
    if (path === "/api/inference/status") return Response.json({ active_model: "fixture", supports_tools: true, context_length: 8192 });
    if (path === "/v1/chat/completions") {
      inferenceCalls++;
      const chunks = [
        { choices: [{ index: 0, delta: { role: "assistant", content: "Hello from packaged Harness" }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ];
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response("Not found", { status: 404 });
  };
  const server = createServer(async (request, response) => {
    if (request.url === "/v1/chat/completions") {
      let raw = ""; for await (const chunk of request) raw += chunk;
      registeredTools = JSON.parse(raw).tools.map((tool: { function: { name: string } }) => tool.function.name);
    }
    const result = respond(new Request(`http://127.0.0.1${request.url}`));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    void result.text().then((text) => response.end(text));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  process.env.UBUME_DATA_DIR = join(workspace, "data");
  process.env.UBUME_BROWSER_ENABLED = "0";
  process.env.UNSLOTH_STUDIO_URL = `http://127.0.0.1:${address.port}`; process.env.UNSLOTH_API_KEY = "sk-unsloth-fixture";
  let cancel: (() => void) | undefined;
  try {
    const response = await new Promise<string>((resolve, reject) => {
      cancel = localRuntime.run!({ prompt: "Hi", workspaceRoot: workspace, route: { providerId: "local", modelId: "fixture", backendKind: "local-openai-compatible", localBackend: "unsloth" }, runtime: resolveRuntimeConfig(normalizeRuntimeConfig({ mode: "full-auto", model: "fixture" })) }, { onResponse: resolve, onError: (error) => reject(new Error(error)) });
    });
    assert.equal(response, "Hello from packaged Harness"); assert.equal(inferenceCalls, 1);
    assert.equal(registeredTools.some((name) => name.startsWith("browser_")), false);
    assert(registeredTools.includes("bash")); assert(registeredTools.includes("read"));
  } finally {
    cancel?.(); await shutdownLocalHarness(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    rmSync(workspace, { recursive: true, force: true });
  }
});
