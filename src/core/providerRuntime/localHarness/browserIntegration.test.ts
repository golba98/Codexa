import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureServer } from "../../../test/fixtures/browserPage.js";
import { resolveBrowserCapability } from "../../computerUse/capability.js";
import { normalizeRuntimeConfig, resolveRuntimeConfig } from "../../../config/runtimeConfig.js";
import { localRuntime, resetLocalProviderStateForTests } from "../local.js";
import { resetLocalHarnessProcessForTests, shutdownLocalHarness } from "./runtime.js";
import type { LocalHarnessSessionMetadata } from "../../workspace/conversationStore.js";
import type { ProviderChatRequest } from "../types.js";

interface ModelBody { tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; tool_call_id?: string; content: unknown }>; }
function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => textContent(item)).join("");
  if (value && typeof value === "object" && "text" in value) return String(value.text);
  return "";
}

for (const [backend, vision] of [["lm-studio", true], ["unsloth", false]] as const) {
  test(`Local ${backend}: real Harness browser tools, fragmented calls, approvals, images and multi-turn state (${vision ? "vision" : "text-only"})`, { timeout: 60000, skip: resolveBrowserCapability().status !== "available" && !process.env.UBUME_REQUIRE_BROWSER_TESTS }, async () => {
    const site = await fixtureServer();
    const workspace = mkdtempSync(join(tmpdir(), "ubume-browser-harness-"));
    const keys = ["UBUME_DATA_DIR", "UBUME_BROWSER_MODE", "UNSLOTH_STUDIO_URL", "UNSLOTH_API_KEY"] as const;
    const saved = keys.map((key) => process.env[key]);
    let step = 0;
    let approvals = 0;
    let screenshotSeen = false;
    const failures: unknown[] = [];
    const toolCalls: string[] = [];
    const messages: ModelBody[] = [];
    const model = createServer(async (request, response) => {
      response.setHeader("Content-Type", "application/json");
      if (request.url?.endsWith("/models")) { response.end(JSON.stringify({ data: [{ id: "generic-browser-fixture", loaded: true }] })); return; }
      if (request.url === "/api/inference/status") { response.end(JSON.stringify({ active_model: "generic-browser-fixture", supports_tools: true, is_vision: vision, context_length: 65536 })); return; }
      if (request.url !== "/v1/chat/completions") { response.writeHead(404); response.end("{}"); return; }
      let raw = ""; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw) as ModelBody; messages.push(body);
      let calls: Array<{ name: string; args: Record<string, unknown> }> = [];
      let final = "";
      try {
        const names = body.tools?.map((tool) => tool.function.name) ?? [];
        for (const name of ["browser_open", "browser_inspect", "browser_click", "browser_type", "browser_press", "browser_select", "browser_scroll", "browser_back", "browser_forward", "browser_reload", "browser_screenshot", "browser_wait", "browser_close", "browser_navigate", "bash", "read", "write", "edit"]) assert(names.includes(name), `${name} not registered`);
        const results = body.messages.filter((message) => message.role === "tool");
        const last = results.at(-1);
        // Harness appends an image handle after the JSON tool result for vision.
        const state = last ? JSON.parse(textContent(last.content).split("\n")[0]!) : undefined;
        if (step > 0 && step !== 6) assert(last?.tool_call_id?.startsWith("browser-call-"), "tool result call id not preserved");
        const ref = (name: string): string => { const element = state?.elements?.find((item: { name: string }) => item.name === name)?.element; assert(element, `No ref for ${name}`); return element; };
        switch (step++) {
          case 0: calls = [{ name: "browser_open", args: { url: site.url, mode: "headless" } }]; break;
          case 1: assert.equal(state.page.title, "Ubume browser fixture"); calls = [{ name: "browser_inspect", args: {} }]; break;
          case 2: calls = [{ name: "browser_click", args: { element: ref("Click me") } }]; break;
          case 3: assert.match(state.visibleText, /Clicked/); calls = [{ name: "browser_type", args: { element: ref("Email"), text: "local-browser-test" } }, { name: "browser_press", args: { key: "Enter" } }]; break;
          case 4: assert.match(state.visibleText, /Submitted local-browser-test/); final = "Browser turn one complete"; break;
          // A second normal Local turn must retain the same browser and DOM state.
          case 5: calls = [{ name: "browser_inspect", args: {} }]; break;
          case 6: assert.match(state.visibleText, /Submitted local-browser-test/); calls = [{ name: "browser_screenshot", args: {} }]; break;
          case 7: screenshotSeen = JSON.stringify(body.messages).includes('"image_url"'); assert.equal(screenshotSeen, vision); assert.equal(state.image.mediaType, "image/png"); calls = [{ name: "browser_close", args: {} }]; break;
          case 8: assert.match(state.summary, /closed/); final = "Browser flow complete"; break;
          case 9: calls = [{ name: "browser_open", args: { url: site.url } }]; break;
          case 10: assert.match(state.visibleText, /Ready/); assert.doesNotMatch(state.visibleText, /Submitted local-browser-test/); final = "Browser durable resume complete"; break;
          default: throw new Error("Unexpected extra model request.");
        }
      } catch (error) { failures.push(error); final = "Fixture assertion failed"; }
      response.setHeader("Content-Type", "text/event-stream");
      const chunks: unknown[] = [{ choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "Inspecting the local application." }, finish_reason: null }] }];
      if (calls.length) {
        for (const [index, call] of calls.entries()) {
          toolCalls.push(call.name);
          const args = JSON.stringify(call.args); const split = Math.floor(args.length / 2);
          chunks.push({ choices: [{ index: 0, delta: { tool_calls: [{ index, id: `browser-call-${step}-${index}`, type: "function", function: { name: call.name, arguments: args.slice(0, split) } }] }, finish_reason: null }] });
          chunks.push({ choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: args.slice(split) } }] }, finish_reason: null }] });
        }
      } else chunks.push({ choices: [{ index: 0, delta: { content: final }, finish_reason: null }] });
      chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: calls.length ? "tool_calls" : "stop" }] });
      response.end(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
    const address = model.address(); assert(address && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}`;
    process.env.UBUME_DATA_DIR = join(workspace, "data"); process.env.UBUME_BROWSER_MODE = "headless";
    process.env.UNSLOTH_STUDIO_URL = endpoint; process.env.UNSLOTH_API_KEY = "fixture";
    resetLocalProviderStateForTests(); resetLocalHarnessProcessForTests();
    let metadata: LocalHarnessSessionMetadata | undefined;
    const activities: Array<{ command: string; summary?: string | null }> = [];
    const base: ProviderChatRequest = { prompt: "Test the local app", workspaceRoot: workspace, route: { providerId: "local", modelId: "generic-browser-fixture", backendKind: "local-openai-compatible", localBackend: backend }, localConfig: { baseUrl: endpoint + "/v1", models: { "generic-browser-fixture": { supportsToolCalls: true, supportsVision: vision, contextLength: 65536, maxOutputTokens: 4096 } } }, runtime: resolveRuntimeConfig(normalizeRuntimeConfig({ mode: "full-auto", model: "generic-browser-fixture" })) };
    const run = (request: ProviderChatRequest) => new Promise<string>((resolve, reject) => localRuntime.run!(request, { onResponse: resolve, onError: (message) => reject(new Error(message)), onToolApproval: async (approval) => { approvals++; assert.equal(approval.allowForRun, false); return "allow-once"; }, onLocalHarnessSession: (session) => { metadata = session ?? undefined; }, onToolActivity: (activity) => activities.push(activity) }));
    try {
      const first = await run(base); assert.equal(first, "Browser turn one complete"); assert(metadata);
      const firstSession = metadata.sessionId;
      const second = await run({ ...base, prompt: "Inspect the same page, take a screenshot, and close", localHarnessSession: metadata, conversationHistory: [{ role: "user", content: base.prompt }, { role: "assistant", content: first }] });
      assert.deepEqual(failures, []); assert.equal(second, "Browser flow complete"); assert.equal(metadata?.sessionId, firstSession);
      assert.deepEqual(failures, []); assert.equal(approvals, 3); assert.equal(step, 9);
      assert(toolCalls.includes("browser_screenshot")); assert(activities.some((activity) => activity.command.startsWith("Browser  ")));
      assert.equal(JSON.stringify(activities).includes("local-browser-test"), false);
      assert.equal(screenshotSeen, vision); assert(messages.length > 5);
      // Restart the real Harness and resume durable history: tools re-register,
      // but browser cookies/DOM/references must start fresh.
      await shutdownLocalHarness();
      const resumed = await run({ ...base, prompt: "Open a fresh browser after resume", localHarnessSession: metadata, conversationHistory: [{ role: "user", content: base.prompt }, { role: "assistant", content: first }, { role: "user", content: "Inspect the same page, take a screenshot, and close" }, { role: "assistant", content: second }] });
      assert.deepEqual(failures, []); assert.equal(resumed, "Browser durable resume complete");
      assert.equal(metadata?.sessionId, firstSession); assert.equal(step, 11);
    } finally {
      await shutdownLocalHarness(); resetLocalProviderStateForTests();
      model.closeAllConnections(); await new Promise<void>((resolve) => model.close(() => resolve())); await site.close();
      keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
      rmSync(workspace, { recursive: true, force: true });
    }
  });
}
