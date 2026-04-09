import React from "react";
import { render, type Instance } from "ink";
import { App } from "./app.js";
import { getTerminalCapability } from "./core/terminalCapabilities.js";

// \x1b[2J clears the visible viewport but on Windows Terminal it pushes the
// cleared content into the scrollback buffer.  When the terminal is later
// expanded (maximise / snap-restore) those buffered frames become visible
// again — causing the "stacked UI" artifact.  \x1b[3J erases the scrollback
// immediately after so nothing accumulates there.
const HARD_REPAINT_SEQUENCE = "\x1b[2J\x1b[3J\x1b[H";

type RenderHandle = Pick<Instance, "clear" | "waitUntilExit">;

/**
 * Typed subset of the internal Ink class instance we access for repaint control.
 * The render() wrapper only exposes clear/waitUntilExit/etc — the real properties
 * (lastOutput, onRender, calculateLayout, unsubscribeResize) live on the Ink class.
 */
interface InkInstance {
  lastOutput: string;
  onRender: (() => void) & { cancel?: () => void };
  calculateLayout: () => void;
  unsubscribeResize?: () => void;
  rootNode: { onRender: { cancel?: () => void } };
  throttledLog: { cancel?: () => void };
}

/**
 * Resolve the real Ink class instance via Ink's internal WeakMap<stdout, Ink>.
 * Returns null if resolution fails (e.g. different Ink version, test mocks).
 */
function resolveInkInstance(stdout: AppStdout): InkInstance | null {
  try {
    // Bun doesn't resolve bare subpath imports like "ink/build/instances.js"
    // so we resolve ink's main entry first, then derive the sibling path.
    const { createRequire } = require("node:module");
    const req = createRequire(import.meta.url);
    const inkMain = req.resolve("ink");
    const instancesPath = inkMain.replace(/index\.js$/, "instances.js");
    const instances = req(instancesPath);
    const weakMap: WeakMap<object, InkInstance> =
      instances.default ?? instances;
    return weakMap.get(stdout as object) ?? null;
  } catch {
    return null;
  }
}

export interface AppStdout {
  isTTY: boolean;
  write: (chunk: string) => boolean;
  on: (event: "resize" | string, listener: (...args: unknown[]) => void) => void;
  off: (event: "resize" | string, listener: (...args: unknown[]) => void) => void;
  columns?: number;
  rows?: number;
}

export interface StartAppDependencies {
  stdin: Pick<NodeJS.ReadStream, "isTTY">;
  stdout: AppStdout;
  stderr: Pick<NodeJS.WriteStream, "write">;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  renderApp: (node: React.ReactElement) => RenderHandle;
  registerExitHandler: (handler: () => void) => void;
}

export interface StartAppResult {
  started: boolean;
  exitCode: number;
}

interface ActiveRootState {
  cleanup: () => void;
}

let activeRoot: ActiveRootState | null = null;

function hasInvalidRestoreDimensions(stdout: Pick<AppStdout, "columns" | "rows">): boolean {
  const cols = stdout.columns;
  const rows = stdout.rows;
  return !Number.isFinite(cols) || !Number.isFinite(rows) || (cols ?? 0) <= 1 || (rows ?? 0) <= 1;
}

export function startApp({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  platform = process.platform,
  renderApp = render,
  registerExitHandler = (handler) => {
    process.on("exit", handler);
  },
}: Partial<StartAppDependencies> = {}): StartAppResult {
  if (activeRoot) {
    return { started: true, exitCode: 0 };
  }

  const capability = getTerminalCapability({
    stdinIsTTY: Boolean(stdin.isTTY),
    stdoutIsTTY: Boolean(stdout.isTTY),
    platform,
    env,
  });

  if (!capability.supported) {
    stderr.write(`${capability.message}\n`);
    return { started: false, exitCode: 1 };
  }

  // Clear the screen and move cursor to home before rendering so no stale
  // content from a previous process (e.g. bun --watch restart) ghosts above
  // the new frame.  We stay in the normal screen buffer (no \x1b[?1049h) to
  // preserve terminal scrollback and allow mouse text selection.
  stdout.write(`${HARD_REPAINT_SEQUENCE}\x1b[?2004h`);

  let cleanupDone = false;
  let repaintArmed = false;
  let pendingRecoveryRepaint = false;
  let renderHandle: RenderHandle | null = null;
  let inkInstance: InkInstance | null = null;
  let repaintDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const performHardRepaint = () => {
    stdout.write(HARD_REPAINT_SEQUENCE);
    if (renderHandle) {
      renderHandle.clear();
    }
    if (inkInstance) {
      // Reset on the REAL Ink instance so the next render always redraws,
      // even when terminal dimensions haven't changed (e.g. taskbar restore).
      inkInstance.lastOutput = "";
    }
    // Do NOT call onRender() here — let React's own re-render cycle
    // (triggered by useTerminalViewport state update) handle drawing.
    // Forcing onRender() while React state still holds stale dimensions
    // triggers Ink's outputHeight >= rows direct-write path, which
    // desyncs logUpdate and causes duplicated UI.
  };

  const scheduleRepaint = () => {
    if (repaintDebounceTimer) clearTimeout(repaintDebounceTimer);
    repaintDebounceTimer = setTimeout(() => {
      repaintDebounceTimer = null;
      if (renderHandle && inkInstance) {
        // By now (150ms later) React state has settled — useTerminalViewport's
        // 100ms settle timer has fired, so dimensions are correct.
        stdout.write(HARD_REPAINT_SEQUENCE);
        renderHandle.clear();
        inkInstance.lastOutput = "";

        // Cancel any pending throttled callbacks so they don't fire with
        // stale layout after we force a fresh render below.
        inkInstance.throttledLog?.cancel?.();
        inkInstance.rootNode?.onRender?.cancel?.();

        // Safe to call now — React state is settled, output height will fit.
        inkInstance.calculateLayout();
        inkInstance.onRender();
      } else if (renderHandle) {
        // Fallback: no Ink instance resolved (e.g. test mock).
        renderHandle.clear();
      } else {
        pendingRecoveryRepaint = true;
      }
    }, 150);
  };

  const onResize = () => {
    if (hasInvalidRestoreDimensions(stdout)) {
      if (repaintDebounceTimer) {
        clearTimeout(repaintDebounceTimer);
        repaintDebounceTimer = null;
      }
      repaintArmed = true;
      return;
    }

    if (repaintArmed) {
      repaintArmed = false;
      if (renderHandle) {
        performHardRepaint();
        return;
      }
      pendingRecoveryRepaint = true;
      return;
    }

    // Normal resize (valid dims throughout).
    // Clear the screen and reset Ink's line tracking immediately so the next
    // Ink re-render starts from a clean slate instead of ghosting old output.
    performHardRepaint();
    scheduleRepaint();
  };

  const cleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    if (repaintDebounceTimer) clearTimeout(repaintDebounceTimer);
    stdout.off("resize", onResize);
    stdout.write("\x1b[?2004l");
    activeRoot = null;
  };

  stdout.on("resize", onResize);
  registerExitHandler(cleanup);

  renderHandle = renderApp(<App />);

  // Resolve the real Ink class instance to get access to lastOutput,
  // onRender, calculateLayout, etc.  Gracefully degrades to null in tests.
  inkInstance = resolveInkInstance(stdout);

  // Remove Ink's own resize handler so the app is the sole resize handler.
  // This eliminates the race where Ink's resized() fires alongside our
  // onResize, causing interleaved renders that desync logUpdate.
  if (inkInstance?.unsubscribeResize) {
    inkInstance.unsubscribeResize();
  }

  if (pendingRecoveryRepaint) {
    pendingRecoveryRepaint = false;
    performHardRepaint();
  }

  void renderHandle.waitUntilExit().finally(cleanup);

  activeRoot = { cleanup };
  return { started: true, exitCode: 0 };
}

const isMainModule = Boolean((import.meta as ImportMeta & { main?: boolean }).main);

if (isMainModule) {
  const result = startApp();
  if (!result.started) {
    process.exitCode = result.exitCode;
  }
}
