import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run after installing the tarball in a clean directory. Root checkout tests
// cannot catch differences in the consumer's resolved dependency graph.
const packageRoot = resolve(process.argv[2] ?? ".");
const load = (path: string) => import(pathToFileURL(join(packageRoot, path)).href);
const { localRuntime } = await load("src/core/providerRuntime/local.ts");
const { shutdownLocalHarness } = await load("src/core/providerRuntime/localHarness/runtime.ts");
const { normalizeRuntimeConfig, resolveRuntimeConfig } = await load("src/config/runtimeConfig.ts");
const workspace = mkdtempSync(join(tmpdir(), "ubume-packed-harness-"));
const server = Bun.serve({ port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path.endsWith("/models")) return Response.json({ data: [{ id: "fixture", loaded: true }] });
  if (path === "/api/inference/status") return Response.json({ active_model: "fixture", supports_tools: true, context_length: 8192 });
  if (path === "/v1/chat/completions") return new Response(
    'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Packaged Harness works"},"finish_reason":null}]}\n\n'
    + 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  return new Response("Not found", { status: 404 });
} });
process.env.UBUME_DATA_DIR = join(workspace, "data");
process.env.UNSLOTH_STUDIO_URL = server.url.toString(); process.env.UNSLOTH_API_KEY = "sk-unsloth-fixture";
let cancel: (() => void) | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  const text = await new Promise<string>((resolveResponse, reject) => {
    timer = setTimeout(() => { cancel?.(); reject(new Error("Packaged Harness timed out")); }, 25_000);
    cancel = localRuntime.run({ prompt: "Hi", workspaceRoot: workspace, route: { providerId: "local", modelId: "fixture", backendKind: "local-openai-compatible", localBackend: "unsloth" }, runtime: resolveRuntimeConfig(normalizeRuntimeConfig({ mode: "full-auto", model: "fixture" })) }, { onResponse: resolveResponse, onError: (error: string) => reject(new Error(error)) });
  });
  assert.equal(text, "Packaged Harness works");
  console.log("Packaged Harness inference passed");
} finally {
  clearTimeout(timer); cancel?.(); await shutdownLocalHarness(); server.stop(true);
  rmSync(workspace, { recursive: true, force: true });
}
