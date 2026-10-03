import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserManager, browserUrl, isLoopbackUrl } from "./browser.js";
import { resolveBrowserCapability, hasDesktopDisplay } from "./capability.js";
import type { ComputerUseResult, ComputerUseValue } from "./types.js";
import { browserSpecs, validateBrowserArguments, browserDescription, type BrowserToolName } from "../../../bin/ubume-local-browser-tools.js";

import { fixtureServer } from "../../test/fixtures/browserPage.js";

function value(result: ComputerUseResult): ComputerUseValue {
  assert.equal(result.ok, true, JSON.stringify(result));
  return (result as Extract<ComputerUseResult, { ok: true }>).value;
}
function error(result: ComputerUseResult, code: string) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.error.code, code);
}

test("browser schemas validate every tool and reject malformed, ambiguous, or unbounded calls", () => {
  assert.equal(Object.keys(browserSpecs).length, 14);
  for (const [tool, args] of Object.entries({ browser_open: {}, browser_navigate: { url: "http://localhost:3000" }, browser_inspect: {}, browser_click: { element: "e7" }, browser_type: { element: "e8", text: "" }, browser_press: { key: "Control+A" }, browser_select: { element: "e9", values: ["one"] }, browser_scroll: { direction: "down" }, browser_back: {}, browser_forward: {}, browser_reload: {}, browser_screenshot: {}, browser_wait: { text: "Ready" }, browser_close: {} })) assert.doesNotThrow(() => validateBrowserArguments(tool, args));
  for (const [tool, args] of [["browser_click", {}], ["browser_click", { role: "button" }], ["browser_click", { element: "e1", selector: "button" }], ["browser_type", { element: "e1", text: 4 }], ["browser_wait", { delayMs: 6000 }], ["browser_wait", { text: "Ready", loadState: "load" }], ["browser_wait", { text: "Ready", timeoutMs: 0 }], ["browser_select", { element: "e1", values: [] }], ["browser_press", { key: "not a key" }], ["browser_scroll", { direction: "down", pixels: 999999 }], ["browser_close", { unexpected: true }]] as Array<[string, unknown]>) assert.throws(() => validateBrowserArguments(tool, args));
  assert.equal(browserDescription("browser_type", { element: "e2", text: "private-password" }).includes("private-password"), false);
});

test("environment capability is independent of model name and reports setup failures", () => {
  assert.equal(resolveBrowserCapability({ UBUME_BROWSER_ENABLED: "0" }).status, "unavailable");
  assert.match(resolveBrowserCapability({ UBUME_BROWSER_EXECUTABLE_PATH: "/missing/ubume-chromium" }).reason, /install/);
  assert.equal(hasDesktopDisplay({ WAYLAND_DISPLAY: "wayland-0" }, "linux"), true);
  assert.equal(hasDesktopDisplay({ DISPLAY: ":0", SSH_TTY: "/dev/pts/1" }, "linux"), false);
  assert.equal(hasDesktopDisplay({}, "linux"), false);
  assert.equal(resolveBrowserCapability({ UBUME_BROWSER_MODE: "invalid" }).status, "unavailable");
  if (resolveBrowserCapability().status === "available") assert.match(resolveBrowserCapability({ UBUME_NODE_PATH: "/missing/ubume-node" }).reason, /Node/);
});

test("browser URL policy preserves loopback development without permitting external schemes or hosts", () => {
  for (const url of ["http://localhost:3000", "http://127.0.0.1:5173", "http://[::1]:8080"]) assert.doesNotThrow(() => browserUrl(url, false));
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "not a URL", "http://user:pass@localhost:3000"]) assert.throws(() => browserUrl(url, true));
  assert.equal(isLoopbackUrl("https://localhost.evil.invalid"), false);
  assert.throws(() => browserUrl("https://github.com", false), /network access/);
});

const capability = resolveBrowserCapability();
test("actual browser: lifecycle, semantic inspection, interactions, references, privacy, navigation and screenshot", { timeout: 60000, skip: capability.status !== "available" && !process.env.UBUME_REQUIRE_BROWSER_TESTS }, async () => {
  const server = await fixtureServer();
  const home = mkdtempSync(join(tmpdir(), "ubume-browser-test-"));
  const manager = new BrowserManager({ ...capability, mode: "headless" });
  let callId = 0;
  const run = (tool: BrowserToolName, args: Record<string, unknown> = {}, signal = new AbortController().signal) => manager.execute({ sessionId: "test", callId: String(++callId), tool, arguments: args }, { dshHome: home, networkAccess: false, signal });
  const ref = (state: ComputerUseValue, name: string) => { const target = state.elements?.find((element) => element.name === name); assert(target?.element, `No ref for ${name}: ${JSON.stringify(state)}`); return target.element; };
  try {
    error(await run("browser_inspect"), "BROWSER_CLOSED");
    error(await run("browser_open", { url: "invalid" }), "BROWSER_INVALID_URL");
    const opened = value(await run("browser_open", { url: server.url }));
    assert.equal(opened.page?.title, "Ubume browser fixture");
    assert.equal(JSON.stringify(opened).includes("private initial text"), false);
    assert.equal(JSON.stringify(opened).includes("private editable text"), false);
    assert.equal(JSON.stringify(opened).includes("Hidden secret"), false);
    for (const role of ["heading", "link", "button", "textbox", "combobox", "checkbox", "dialog"]) assert(opened.elements?.some((element) => element.role === role), `missing ${role}`);
    value(await run("browser_click", { element: ref(opened, "Click me") }));
    assert.match(value(await run("browser_inspect")).visibleText!, /Clicked/);
    value(await run("browser_type", { element: ref(opened, "Email"), text: "tester" }));
    value(await run("browser_type", { element: ref(opened, "Email"), text: "@local.test", append: true }));
    value(await run("browser_select", { element: ref(opened, "Choice"), values: ["Two"], by: "label" }));
    value(await run("browser_press", { element: ref(opened, "Email"), key: "Enter" }));
    assert.match(value(await run("browser_inspect")).visibleText!, /Submitted tester@local.test/);
    value(await run("browser_type", { element: ref(opened, "Password"), text: "fixture-secret-password" }));
    const inspected = value(await run("browser_inspect"));
    assert.equal(JSON.stringify(inspected).includes("fixture-secret-password"), false);
    value(await run("browser_scroll", { direction: "bottom" }));
    const shot = value(await run("browser_screenshot"));
    assert.equal(shot.image?.mediaType, "image/png"); assert(existsSync(shot.artifactPath!));
    error(await run("browser_click", { text: "Duplicate" }), "BROWSER_AMBIGUOUS_TARGET");
    value(await run("browser_click", { text: "Duplicate", index: 2 }));
    error(await run("browser_click", { text: "Not present" }), "BROWSER_ELEMENT_NOT_FOUND");
    error(await run("browser_wait", { selector: "#missing", timeoutMs: 30 }), "BROWSER_TIMEOUT");
    value(await run("browser_wait", { text: "Submitted tester@local.test", timeoutMs: 5000 }));
    const replaced = value(await run("browser_inspect"));
    const old = ref(replaced, "Replace me");
    value(await run("browser_click", { element: old }));
    error(await run("browser_click", { element: old }), "BROWSER_STALE_REFERENCE");
    const beforeNavigation = value(await run("browser_inspect"));
    value(await run("browser_navigate", { url: server.url + "/second" }));
    error(await run("browser_click", { element: ref(beforeNavigation, "Click me") }), "BROWSER_STALE_REFERENCE");
    assert.equal(value(await run("browser_back")).page?.title, "Ubume browser fixture");
    assert.equal(value(await run("browser_forward")).page?.title, "Second");
    assert.equal(value(await run("browser_reload")).page?.title, "Second");
    assert.equal(value(await run("browser_navigate", { url: server.url + "/redirect" })).page?.url, server.url + "/");
    error(await run("browser_navigate", { url: server.url + "/external" }), "BROWSER_NETWORK_DENIED");
    const cancelled = new AbortController(); cancelled.abort();
    error(await run("browser_wait", { delayMs: 5000 }, cancelled.signal), "ABORTED");
    value(await run("browser_close")); value(await run("browser_close"));
    error(await run("browser_inspect"), "BROWSER_CLOSED");
    value(await run("browser_open", { url: server.url }));
    await manager.closeSession("test");
    error(await run("browser_inspect"), "BROWSER_CLOSED");
  } finally { await manager.shutdown(); await server.close(); rmSync(home, { recursive: true, force: true }); }
});

test("actual browser: cancellation drains and worker crashes recover without retaining browser state", { timeout: 60000, skip: capability.status !== "available" && !process.env.UBUME_REQUIRE_BROWSER_TESTS }, async () => {
  const server = await fixtureServer();
  const home = mkdtempSync(join(tmpdir(), "ubume-browser-crash-"));
  const manager = new BrowserManager({ ...capability, mode: "headless" });
  let callId = 0;
  const run = (tool: BrowserToolName, args: Record<string, unknown> = {}, signal = new AbortController().signal) => manager.execute({ sessionId: "crash", callId: String(++callId), tool, arguments: args }, { dshHome: home, networkAccess: false, signal });
  try {
    value(await run("browser_open", { url: server.url }));
    const abort = new AbortController();
    const pending = run("browser_wait", { delayMs: 5000 }, abort.signal);
    const timer = setTimeout(() => abort.abort(), 100);
    error(await pending, "ABORTED"); clearTimeout(timer);
    assert.equal(value(await run("browser_inspect")).page?.title, "Ubume browser fixture");
    // Force the execution host to die, exercising supervisor ownership cleanup.
    const worker = (manager as unknown as { child: import("node:child_process").ChildProcess }).child;
    const directory = (manager as unknown as { workerDirectory: string }).workerDirectory;
    assert(existsSync(directory));
    const exited = new Promise<void>((resolve) => worker.once("exit", () => resolve()));
    worker.kill("SIGKILL"); await exited;
    assert.equal(existsSync(directory), false);
    assert.equal(manager.hasSession("crash"), false);
    error(await run("browser_inspect"), "BROWSER_CLOSED");
    value(await run("browser_open", { url: server.url }));
    await manager.shutdown();
    assert.equal(manager.hasSession("crash"), false);
    error(await run("browser_inspect"), "BROWSER_CLOSED");
  } finally { await manager.shutdown(); await server.close(); rmSync(home, { recursive: true, force: true }); }
});
