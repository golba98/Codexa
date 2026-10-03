// Private Node execution host; there is no model client or agent loop here.
import { JsonRpcLineTransport } from "@deepseek-ai/dsh-sdk-protocol";
import { BrowserManager } from "./ubume-browser-backend.js";

const transport = new JsonRpcLineTransport(process.stdin, process.stdout);
let backend;
let shuttingDown = false;
const controllers = new Map();
transport.onNotification((method, params) => {
  if (method === "browser.cancel") controllers.get(String(params.callId))?.abort();
});
transport.onRequest(async (method, params) => {
  if (method === "initialize") {
    if (backend) throw new Error("Browser worker already initialized.");
    backend = new BrowserManager(params.capability, (pid, closed = false) => transport.notify("browser.process", { pid, closed }));
    return {};
  }
  if (!backend || shuttingDown) throw new Error("Browser worker unavailable.");
  if (method === "browser/close-session") { await backend.closeSession(String(params.sessionId)); return {}; }
  if (method === "shutdown") {
    shuttingDown = true;
    for (const controller of controllers.values()) controller.abort();
    await backend.shutdown();
    setImmediate(async () => { await transport.flush(); process.exit(0); });
    return {};
  }
  const controller = new AbortController();
  const callId = String(params.callId);
  if (controllers.has(callId)) throw new Error("Duplicate browser call id.");
  controllers.set(callId, controller);
  let timedOut = false;
  const timeout = method === "browser/execute" ? Number(params.arguments?.timeoutMs ?? (["browser_open", "browser_navigate", "browser_back", "browser_forward", "browser_reload"].includes(params.tool) ? 30000 : 10000)) : 10000;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1, Math.min(timeout, 30000)));
  try {
    if (method === "browser/execute") {
      const result = await backend.execute(params, { networkAccess: params.networkAccess === true, dshHome: String(params.dshHome), signal: controller.signal });
      return timedOut ? { ok: false, error: { code: "BROWSER_TIMEOUT", message: "Browser action timed out. Inspect the page before retrying." } } : result;
    }
    if (method === "browser/approval-state") return await backend.approvalState(String(params.sessionId), params.arguments, params.typing === true, controller.signal);
    throw new Error("Unsupported browser request.");
  } catch {
    // Never forward Playwright's raw exception/call log across the boundary.
    throw new Error(controller.signal.aborted ? "Browser action cancelled." : "Browser target unavailable.");
  } finally { clearTimeout(timer); controllers.delete(callId); }
});
transport.start();
const stop = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const controller of controllers.values()) controller.abort();
  await backend?.shutdown();
  process.exit(0);
};
process.stdin.on("end", () => { void stop(); });
process.on("SIGTERM", () => { void stop(); });
process.on("SIGINT", () => { void stop(); });
