import { chromium } from "playwright";
import { saveImageFile, DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_DIMENSION, DEFAULT_MAX_IMAGE_PIXELS, DEFAULT_MAX_IMAGES_PER_MESSAGE, DEFAULT_MAX_MESSAGE_IMAGE_BYTES } from "@deepseek-ai/dsh-attachment-local";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { browserDescription, safeBrowserUrl, validateBrowserArguments } from "./ubume-local-browser-tools.js";
import { BrowserToolError, browserUrl, isLoopbackUrl } from "./ubume-browser-url.js";
import { createBrowserProxy } from "./ubume-browser-proxy.js";
export { BrowserToolError, browserUrl, isLoopbackUrl } from "./ubume-browser-url.js";
const fail = (code, message) => { throw new BrowserToolError(code, message); };
const MAX_ELEMENTS = 100;
const MAX_TEXT = 8000;
const MAX_RESULT_BYTES = 32768;

function hasTarget(args, typing = false) {
  return ["element", "role", "selector", ...typing ? [] : ["text"]].some((key) => args[key] !== undefined);
}
function scrub(value, session) {
  let result = value;
  for (const secret of session.secrets)
    if (secret)
      result = result.split(secret).join("[redacted]");
  return result.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " ");
}
async function closeServer(server) {
  if (!server)
    return;
  let timer;
  try {
    await Promise.race([server.close(), new Promise((resolve) => {
      timer = setTimeout(() => {
        server.kill().then(resolve, resolve);
      }, 1500);
    })]);
  } catch {
    await server.kill().catch(() => {
      return;
    });
  } finally {
    if (timer)
      clearTimeout(timer);
  }
}

export class BrowserManager {
  capability;
  sessions = new Map;
  constructor(capability, onProcess = () => {}) {
    this.capability = capability; this.onProcess = onProcess;
  }
  session(id) {
    let session = this.sessions.get(id);
    if (!session) {
      session = { refs: new Map, nextRef: 1, epoch: 0, networkAccess: false, disposed: false, controllers: new Set, tail: Promise.resolve(), secrets: new Set };
      this.sessions.set(id, session);
    }
    return session;
  }
  async execute(request, policy) {
    const session = this.session(request.sessionId);
    const controller = new AbortController;
    const abort = () => controller.abort();
    policy.signal.addEventListener("abort", abort, { once: true });
    if (policy.signal.aborted)
      abort();
    session.controllers.add(controller);
    const work = session.tail.then(async () => {
      try {
        controller.signal.throwIfAborted();
        if (session.disposed)
          fail("BROWSER_CLOSED", "Browser session closed. Open a browser again.");
        validateBrowserArguments(request.tool, request.arguments);
        session.networkAccess = policy.networkAccess;
        const value = await this.perform(session, request, { ...policy, signal: controller.signal });
        controller.signal.throwIfAborted();
        return { ok: true, value };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        let code = error instanceof BrowserToolError ? error.code : controller.signal.aborted ? "ABORTED" : error instanceof Error && error.name === "TimeoutError" ? "BROWSER_TIMEOUT" : !policy.networkAccess && /ERR_BLOCKED_BY_CLIENT|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED/.test(message) ? "BROWSER_NETWORK_DENIED" : /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED/.test(message) ? "BROWSER_NAVIGATION_FAILED" : /ERR_CERT_|ERR_SSL_/.test(message) ? "BROWSER_TLS_FAILED" : /closed|crash|disconnected/i.test(message) ? "BROWSER_CLOSED" : "BROWSER_FAILED";
        if (error?.code === "BROWSER_INVALID_ARGUMENTS")
          code = "BROWSER_INVALID_ARGUMENTS";
        const detail = error instanceof BrowserToolError ? error.message : code === "ABORTED" ? "Browser action cancelled." : code === "BROWSER_TIMEOUT" ? "Browser action timed out. Inspect the page and use a bounded wait before retrying." : code === "BROWSER_NETWORK_DENIED" ? "External browser requests are blocked. Enable network access; localhost remains available." : code === "BROWSER_TLS_FAILED" ? "TLS validation failed. Check the site's certificate." : code === "BROWSER_NAVIGATION_FAILED" ? "Navigation failed. Check the URL and whether the server is running." : code === "BROWSER_CLOSED" ? "Browser/page closed or crashed. Open a browser again." : code === "BROWSER_INVALID_ARGUMENTS" ? "Invalid browser arguments." : "Browser action failed. Inspect the page and check the target; no action was retried automatically.";
        return { ok: false, error: { code, message: scrub(detail, session) } };
      } finally {
        session.controllers.delete(controller);
        policy.signal.removeEventListener("abort", abort);
      }
    });
    session.tail = work;
    return work;
  }
  async open(session, args, signal) {
    const configured = args.mode ?? this.capability.mode;
    const mode = configured === "auto" ? this.capability.headedSupported ? "headed" : "headless" : configured;
    if (session.context && session.browser?.isConnected()) {
      if (args.mode && configured !== "auto" && mode !== session.mode)
        fail("BROWSER_MODE_CONFLICT", "Close the existing browser before changing its display mode.");
      if (!session.page || session.page.isClosed())
        session.page = await session.context.newPage();
      return;
    }
    if (this.capability.status !== "available")
      fail("BROWSER_UNAVAILABLE", this.capability.reason);
    await closeServer(session.server);
    const launch = (headless) => chromium.launchServer({
      executablePath: this.capability.executablePath,
      host: "127.0.0.1",
      headless,
      chromiumSandbox: true,
      timeout: 30000,
      args: !headless && process.env.WAYLAND_DISPLAY && !process.env.DISPLAY ? ["--ozone-platform=wayland"] : []
    });
    try {
      session.server = await launch(mode === "headless");
      session.mode = mode;
    } catch {
      if (configured !== "auto" || mode !== "headed")
        fail("BROWSER_LAUNCH_FAILED", "Chromium could not launch. Check browser installation, host libraries, desktop display, and Chromium sandbox support. No sandbox bypass is attempted.");
      try {
        session.server = await launch(true);
        session.mode = "headless";
        session.fallback = true;
      } catch {
        fail("BROWSER_LAUNCH_FAILED", "Chromium could not launch in headed or headless mode. Check host libraries and sandbox support; run ubume browser install.");
      }
    }
    const pid = session.server.process().pid;
    this.onProcess(pid);
    session.server.on("close", () => this.onProcess(pid, true));
    if (signal.aborted || session.disposed) {
      await closeServer(session.server);
      signal.throwIfAborted();
      fail("BROWSER_CLOSED", "Browser session closed during launch.");
    }
    session.browser = await chromium.connect(session.server.wsEndpoint(), { timeout: 1e4 });
    session.browser.on("disconnected", () => {
      session.refs.clear();
      session.epoch++;
    });
    await session.proxy?.close();
    session.proxy = await createBrowserProxy((url) => session.networkAccess || isLoopbackUrl(url));
    session.context = await session.browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: false, serviceWorkers: "block", proxy: { server: session.proxy.url, bypass: "<-loopback>" } });
    await session.context.route("**/*", async (route) => {
      const url = route.request().url();
      const protocol = new URL(url).protocol;
      if (["http:", "https:"].includes(protocol) && (session.networkAccess || isLoopbackUrl(url)))
        await route.continue();
      else
        await route.abort("blockedbyclient");
    });
    await session.context.routeWebSocket(() => true, async (ws) => {
      if (session.networkAccess || isLoopbackUrl(ws.url()))
        await ws.connectToServer();
      else
        await ws.close();
    });
    session.context.on("page", (page) => {
      session.page = page;
      session.refs.clear();
      session.epoch++;
      page.on("framenavigated", () => {
        session.refs.clear();
        session.epoch++;
      });
      page.on("crash", () => {
        session.refs.clear();
        session.epoch++;
      });
      page.on("dialog", (dialog) => {
        dialog.dismiss().catch(() => {
          return;
        });
      });
      page.on("close", () => {
        session.refs.clear();
        session.epoch++;
        if (session.page === page)
          session.page = session.context?.pages().filter((candidate) => !candidate.isClosed()).at(-1);
      });
    });
    session.page = await session.context.newPage();
    signal.throwIfAborted();
  }
  current(session) {
    if (!session.browser?.isConnected() || !session.page || session.page.isClosed())
      fail("BROWSER_CLOSED", "No open browser page. Call browser_open first.");
    return session.page;
  }
  async resolveTarget(session, args, signal) {
    const page = this.current(session);
    let locator;
    if (args.element) {
      const ref = session.refs.get(String(args.element));
      if (!ref || ref.epoch !== session.epoch || ref.frame.isDetached())
        fail("BROWSER_STALE_REFERENCE", `Element ${args.element} is no longer available. Inspect the page again.`);
      locator = ref.frame.locator(`aria-ref=${ref.native}`);
    } else if (args.role) {
      locator = page.getByRole(args.role, { name: String(args.name), exact: true });
    } else if (args.selector)
      locator = page.locator(`css=${args.selector}`);
    else
      locator = page.getByText(String(args.text), { exact: true });
    signal.throwIfAborted();
    const count = await locator.count();
    if (!count || args.index && Number(args.index) > count)
      fail(args.element ? "BROWSER_STALE_REFERENCE" : "BROWSER_ELEMENT_NOT_FOUND", args.element ? `Element ${args.element} is no longer available. Inspect the page again.` : "Element not found. Inspect the page and choose a current target.");
    if (count > 1 && !args.index)
      fail("BROWSER_AMBIGUOUS_TARGET", `${count} elements match. Inspect again and use an element reference or a one-based index.`);
    return args.index ? locator.nth(Number(args.index) - 1) : locator;
  }
  async inspect(session, signal, scope) {
    const page = this.current(session);
    const elements = [];
    const texts = [];
    let textSize = 0;
    let truncated = false;
    const old = session.refs;
    const refs = scope ? new Map([...old].slice(-MAX_ELEMENTS)) : new Map;
    const scopeFrame = scope ? await (await scope.elementHandle({ timeout: 10000 }))?.ownerFrame() : undefined;
    for (const frame of scope ? [scopeFrame ?? page.mainFrame()] : page.frames().slice(0, 16)) {
      if (frame.isDetached())
        continue;
      const root = scope ?? frame.locator("body");
      const snapshot = await root.ariaSnapshotJSON({ mode: "ai", depth: 8, timeout: 1e4, signal });
      const visit = async (node, depth) => {
        if (depth > 8 || elements.length >= MAX_ELEMENTS || textSize >= MAX_TEXT) {
          truncated = true;
          return;
        }
        if (typeof node === "string") {
          const text = scrub(node, session).slice(0, MAX_TEXT - textSize);
          texts.push(text);
          textSize += text.length;
          return;
        }
        if (!node || typeof node !== "object")
          return;
        const item = node;
        const native = typeof item.ref === "string" ? item.ref : undefined;
        let privateField = false;
        let fieldName = "";
        if (native) {
          const loc = frame.locator(`aria-ref=${native}`);
          privateField = await loc.evaluate((el) => el.matches("input,textarea,select,[contenteditable]"), undefined, { timeout: 1e4, signal }).catch(() => true);
          if (privateField) fieldName = await loc.evaluate((el) => el.getAttribute("aria-label") || [...(el.labels ?? [])].map((label) => label.textContent).join(" "), undefined, { timeout: 1e4, signal }).catch(() => "");
        }
        const role = privateField && item.role === "generic" ? "textbox" : String(item.role ?? "text");
        const name = fieldName || String(item.name ?? "");
        if ((role !== "generic" || item.cursor === "pointer") && role !== "text" && role !== "iframe") {
          const entry = { role, name: scrub(name, session).slice(0, 240) };
          if (native) {
            const known = [...old].find(([, ref]) => ref.frame === frame && ref.native === native && ref.epoch === session.epoch && ref.role === role && ref.name === name);
            const id = known?.[0] ?? `e${session.nextRef++}`;
            refs.set(id, { frame, native, epoch: session.epoch, role, name });
            entry.element = id;
          }
          for (const key of ["checked", "disabled", "expanded", "selected", "level"])
            if (item[key] !== undefined)
              Object.assign(entry, { [key]: item[key] });
          if (typeof item.url === "string") {
            try {
              entry.url = scrub(safeBrowserUrl(new URL(item.url, page.url()).href), session);
            } catch {}
          }
          if (!privateField && typeof item.text === "string")
            entry.text = scrub(item.text, session).slice(0, 500);
          elements.push(entry);
        }
        if (!privateField && role !== "iframe") {
          if (typeof item.text === "string")
            await visit(item.text, depth + 1);
          if (Array.isArray(item.children))
            for (const child of item.children)
              await visit(child, depth + 1);
        }
      };
      for (const node of snapshot)
        await visit(node, 0);
      if (scope || elements.length >= MAX_ELEMENTS || textSize >= MAX_TEXT)
        break;
    }
    session.refs = refs;
    const result = { summary: `Page inspected: ${elements.length} elements${truncated ? " (truncated; inspect a section for more)" : ""}.`, page: { url: scrub(safeBrowserUrl(page.url()), session), title: scrub(await page.title(), session).slice(0, 500), loadState: await page.evaluate(() => document.readyState) }, elements, visibleText: texts.join(`
`), truncated };
    while (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES && result.elements.length) {
      result.elements.pop();
      result.truncated = true;
    }
    return result;
  }
  async approvalState(sessionId, args, typing, signal) {
    const session = this.session(sessionId);
    const page = this.current(session);
    const focused = page.locator(":focus");
    const locator = hasTarget(args, typing) ? await this.resolveTarget(session, args, signal) : await focused.count() ? focused : page.locator("body");
    const token = await locator.evaluate((el) => {
      const node = el;
      return node.__ubumeApprovalIdentity ??= crypto.randomUUID();
    }, undefined, { timeout: 1e4, signal });
    const editable = await locator.evaluate((el) => el.matches("input,textarea,select,[contenteditable]"), undefined, { timeout: 1e4, signal });
    const label = await locator.getAttribute("aria-label", { timeout: 1e4, signal }) || (editable ? String(args.name ?? "form field") : await locator.innerText({ timeout: 1e4, signal }).catch(() => "")) || String(args.element ?? args.name ?? "focused element");
    const shape = await locator.evaluate((el) => [el.tagName, el.getAttribute("role"), el.getAttribute("aria-label"), el.getAttribute("href"), el.getAttribute("type"), el.textContent].join(`
`), undefined, { timeout: 1e4, signal });
    return { description: `${scrub(label, session).slice(0, 120)} on ${scrub(safeBrowserUrl(page.url()), session)}`, identity: `${session.epoch}:${token}:${createHash("sha256").update(shape).digest("hex")}` };
  }
  async perform(session, request, policy) {
    const { tool, arguments: args } = request;
    const { signal } = policy;
    if (tool === "browser_close") {
      await closeServer(session.server);
      await session.proxy?.close(); session.proxy = undefined;
      session.server = undefined;
      session.browser = undefined;
      session.context = undefined;
      session.page = undefined;
      session.refs.clear();
      session.epoch++;
      session.secrets.clear();
      return { summary: "Browser closed; authentication and references discarded." };
    }
    if (tool === "browser_open") {
      if (args.url)
        browserUrl(args.url, policy.networkAccess);
      await this.open(session, args, signal);
      if (args.url)
        await this.current(session).goto(browserUrl(args.url, policy.networkAccess), { waitUntil: "domcontentloaded", timeout: Number(args.timeoutMs ?? 30000), signal });
    }
    const page = this.current(session);
    const timeout = Number(args.timeoutMs ?? (["browser_open", "browser_navigate", "browser_back", "browser_forward", "browser_reload"].includes(tool) ? 30000 : 1e4));
    const opts = { timeout, signal };
    if (tool !== "browser_open" && tool !== "browser_inspect")
      await this.inspect(session, signal);
    const loc = hasTarget(args, tool === "browser_type") && tool !== "browser_wait" ? await this.resolveTarget(session, args, signal) : undefined;
    switch (tool) {
      case "browser_navigate":
        await page.goto(browserUrl(args.url, policy.networkAccess), { ...opts, waitUntil: "domcontentloaded" });
        break;
      case "browser_click":
        await loc.click(opts);
        break;
      case "browser_type": {
        const sensitive = args.sensitive === true || await loc.evaluate((el) => el.matches('input[type="password"],[autocomplete*="password"],[autocomplete^="cc-"],[name*="token" i]'), undefined, opts);
        if (sensitive) {
          session.secrets.add(String(args.text));
          await loc.evaluate((el) => el.setAttribute("data-ubume-sensitive", "true"), undefined, opts);
        }
        if (args.append) {
          await loc.press("End", opts);
          await loc.pressSequentially(String(args.text), opts);
        } else
          await loc.fill(String(args.text), opts);
        break;
      }
      case "browser_press":
        if (loc)
          await loc.press(String(args.key), opts);
        else
          await page.keyboard.press(String(args.key));
        break;
      case "browser_select":
        await loc.selectOption(args.values.map((value) => args.by === "label" ? { label: value } : { value }), opts);
        break;
      case "browser_scroll": {
        const scroll = { direction: String(args.direction), pixels: Number(args.pixels ?? 600) };
        await (loc ?? page.locator("html")).evaluate((el, { direction, pixels }) => {
          const target = el === document.documentElement ? document.scrollingElement ?? el : el;
          target.scrollTo({ top: direction === "top" ? 0 : direction === "bottom" ? target.scrollHeight : target.scrollTop + (direction === "up" ? -pixels : pixels), behavior: "instant" });
        }, scroll, opts);
        break;
      }
      case "browser_back":
        await page.goBack({ ...opts, waitUntil: "domcontentloaded" });
        break;
      case "browser_forward":
        await page.goForward({ ...opts, waitUntil: "domcontentloaded" });
        break;
      case "browser_reload":
        await page.reload({ ...opts, waitUntil: "domcontentloaded" });
        break;
      case "browser_wait":
        if (args.delayMs)
          await delay(Number(args.delayMs), undefined, { signal });
        else if (args.loadState)
          await page.waitForLoadState(args.loadState, opts);
        else {
          const pending = args.element ? await this.resolveTarget(session, args, signal) : args.selector ? page.locator(`css=${args.selector}`) : page.getByText(String(args.text), { exact: true });
          await pending.waitFor({ ...opts, state: "visible" });
        }
        break;
      case "browser_screenshot": {
        const mask = page.frames().map((frame) => frame.locator('input[type="password"],[autocomplete*="password"],[autocomplete^="cc-"],[autocomplete="one-time-code"],[name*="token" i],[data-ubume-sensitive="true"]'));
        const buffer = await (loc ?? page).screenshot({ ...opts, type: "png", scale: "css", mask, animations: "disabled" });
        const image = await saveImageFile(join(policy.dshHome, "attachments", "v1"), { data: buffer, mediaType: "image/png", name: "browser-screenshot.png" }, { maxImageBytes: Math.min(DEFAULT_MAX_IMAGE_BYTES, 4 * 1024 * 1024), maxImagesPerMessage: DEFAULT_MAX_IMAGES_PER_MESSAGE, maxMessageImageBytes: DEFAULT_MAX_MESSAGE_IMAGE_BYTES, maxImagePixels: DEFAULT_MAX_IMAGE_PIXELS, maxImageDimension: DEFAULT_MAX_IMAGE_DIMENSION, mediaTypes: ["image/png"] }, { maxPixels: 2048 * 2048, maxDimension: 2048, maxBytes: 4 * 1024 * 1024 });
        const hash = String(image.attachmentId).slice("sha256:".length);
        return { summary: `Screenshot saved (${image.width}×${image.height}); sensitive fields masked.`, image, artifactPath: join(policy.dshHome, "attachments", "v1", "objects", hash.slice(0, 2), hash) };
      }
    }
    const result = await this.inspect(session, signal, tool === "browser_inspect" ? loc : undefined);
    if (!policy.networkAccess && !isLoopbackUrl(this.current(session).url()) && this.current(session).url() !== "about:blank") fail("BROWSER_NETWORK_DENIED", "External browser access is disabled. Redirects to external websites are blocked; enable Ubume network access to visit them.");
    if (tool !== "browser_inspect")
      result.summary = browserDescription(tool, args) + (session.fallback ? " (automatic headed launch unavailable; using headless)" : "");
    return result;
  }
  async closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session)
      return;
    session.disposed = true;
    for (const controller of session.controllers)
      controller.abort();
    await closeServer(session.server);
    await session.tail;
    await closeServer(session.server);
    session.refs.clear();
    await session.proxy?.close();
    session.secrets.clear();
    if (this.sessions.get(sessionId) === session)
      this.sessions.delete(sessionId);
  }
  async shutdown() {
    await Promise.allSettled([...this.sessions.keys()].map((id) => this.closeSession(id)));
  }
  terminate() {
    for (const session of this.sessions.values()) {
      session.disposed = true;
      for (const controller of session.controllers)
        controller.abort();
      session.server?.kill().catch(() => {
        return;
      });
    }
    this.shutdown();
  }
}
