import React from "react";
import { render, type Instance, type RenderOptions } from "ink";
import { App } from "./app.js";
import { parseLaunchArgs, type LaunchArgs } from "./config/launchArgs.js";
import { getTerminalCapability } from "./core/terminalCapabilities.js";
import { MIN_VIEWPORT_COLS, MIN_VIEWPORT_ROWS } from "./ui/layout.js";

// \x1b[2J clears the visible viewport but on Windows Terminal it pushes the
// cleared content into the scrollback buffer.  When the terminal is later
// expanded (maximise / snap-restore) those buffered frames become visible
// again — causing the "stacked UI" artifact.  \x1b[3J erases the scrollback
// immediately after so nothing accumulates there.
const HARD_REPAINT_SEQUENCE = "\x1b[2J\x1b[3J\x1b[H";
// Clears the visible viewport and homes the cursor but does NOT erase the
// scrollback buffer. This is reserved for invalid-dimension recovery only;
// normal valid resizes use a soft repaint path.
const VIEWPORT_CLEAR_SEQUENCE = "\x1b[2J\x1b[H";
const DISABLE_TRANSCRIPT_WHEEL_MODE = "\x1b[?1000l\x1b[?1006l";
import { SET_TERMINAL_TITLE } from "./core/terminalTitle.js";

type RenderHandle = Pick<Instance, "clear" | "cleanup" | "waitUntilExit">;
const KITTY_KEYBOARD_OPTIONS: RenderOptions["kittyKeyboard"] = {
  mode: "auto",
  flags: ["disambiguateEscapeCodes"],
};

/**
 * Typed subset of the internal Ink class instance we access for repaint control.
 * The render() wrapper only exposes clear/waitUntilExit/etc — the real properties
 * (lastOutput, onRender, calculateLayout, unsubscribeResize) live on the Ink class.
 */
interface InkInstance {
  lastOutput: string;
  lastOutputToRender: string;
  lastOutputHeight: number;
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
  argv: string[];
  renderApp: (node: React.ReactElement, options?: RenderOptions) => RenderHandle;
  registerExitHandler: (handler: () => void) => void;
}

export interface StartAppResult {
  started: boolean;
  exitCode: number;
}

interface ActiveRootState {
  cleanup: () => void;
}

type RepaintMode = "soft" | "recovery";

let activeRoot: ActiveRootState | null = null;

function hasInvalidRestoreDimensions(stdout: Pick<AppStdout, "columns" | "rows">): boolean {
  const cols = stdout.columns;
  const rows = stdout.rows;
  return !Number.isFinite(cols) || !Number.isFinite(rows)
    || (cols ?? 0) < MIN_VIEWPORT_COLS || (rows ?? 0) < MIN_VIEWPORT_ROWS;
}

export function startApp({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  platform = process.platform,
  argv = process.argv.slice(2),
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

  const parsedLaunchArgs = parseLaunchArgs(argv);
  if (!parsedLaunchArgs.ok) {
    stderr.write(`${parsedLaunchArgs.error}\n`);
    return { started: false, exitCode: 1 };
  }
  const launchArgs: LaunchArgs = parsedLaunchArgs.value;

  // Clear the screen and move cursor to home before rendering so no stale
  // content from a previous process (e.g. bun --watch restart) ghosts above
  // the new frame.  We stay in the normal screen buffer (no \x1b[?1049h) to
  // preserve terminal scrollback and allow mouse text selection.
  // NOTE: Mouse reporting (\x1b[?1000h / \x1b[?1006h) is NOT enabled here.
  // It is managed exclusively by the React app (app.tsx) and defaults to OFF
  // so native terminal drag-selection and copy work without any special steps.
  stdout.write(`${SET_TERMINAL_TITLE}${HARD_REPAINT_SEQUENCE}\x1b[?2004h`);

  let cleanupDone = false;
  let repaintArmed = false;
  let pendingRecoveryRepaint = false;
  let renderHandle: RenderHandle | null = null;
  let inkInstance: InkInstance | null = null;
  let repaintDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRepaintMode: RepaintMode = "soft";

  const performHardRepaint = () => {
    stdout.write(HARD_REPAINT_SEQUENCE);
    if (inkInstance) {
      // Reset ALL Ink output state BEFORE calling clear().
      // Ink.clear() internally calls log.sync(this.lastOutputToRender || …)
      // which re-fills log-update's previousOutput.  If lastOutputToRender
      // still holds the most recent frame, the subsequent render produces
      // identical output and log-update's hasChanges() returns false —
      // the render silently no-ops and the screen stays blank.
      inkInstance.lastOutput = "";
      inkInstance.lastOutputToRender = "";
      inkInstance.lastOutputHeight = 0;
    }
    if (renderHandle) {
      renderHandle.clear();
    }
    // Do NOT call onRender() here — let React's own re-render cycle
    // (triggered by useTerminalViewport state update) handle drawing.
    // Forcing onRender() while React state still holds stale dimensions
    // triggers Ink's outputHeight >= rows direct-write path, which
    // desyncs logUpdate and causes duplicated UI.
  };

  const scheduleRepaint = (mode: RepaintMode = "soft") => {
    if (mode === "recovery") {
      pendingRepaintMode = "recovery";
    } else if (!repaintDebounceTimer) {
      pendingRepaintMode = "soft";
    }

    if (repaintDebounceTimer) clearTimeout(repaintDebounceTimer);
    repaintDebounceTimer = setTimeout(() => {
      repaintDebounceTimer = null;
      const repaintMode = pendingRepaintMode;
      pendingRepaintMode = "soft";

      // If dimensions are still invalid when the timer fires, skip the
      // destructive repaint — the old content is still on-screen (we never
      // cleared the viewport during the unstable phase) so the user sees
      // stale-but-visible UI instead of a blank frame.  The next resize
      // event with valid dimensions will schedule a fresh repaint.
      if (hasInvalidRestoreDimensions(stdout)) {
        return;
      }

      repaintArmed = false;

      if (renderHandle && inkInstance) {
        // By now (150ms later) React state has settled — useTerminalViewport's
        // 100ms settle timer has fired, so dimensions are correct.
        // Normal valid resize is a soft repaint: reset Ink's cached frame and
        // ask it to render once. Only invalid-dimension recovery uses an ANSI
        // viewport clear, preserving busy-state stability during ordinary
        // resize/layout updates.
        if (repaintMode === "recovery") {
          stdout.write(VIEWPORT_CLEAR_SEQUENCE);
        }

        // Reset ALL Ink output state BEFORE calling clear().
        // Ink.clear() internally calls log.sync(this.lastOutputToRender || …)
        // which re-fills log-update's previousOutput.  If lastOutputToRender
        // still holds the most recent frame, the subsequent onRender() produces
        // identical output and log-update's hasChanges() returns false — the
        // forced render silently no-ops and the screen stays blank.
        inkInstance.lastOutput = "";
        inkInstance.lastOutputToRender = "";
        inkInstance.lastOutputHeight = 0;

        if (repaintMode === "recovery") {
          renderHandle.clear();
        }

        // Cancel ALL pending throttled callbacks — including onRender's own
        // throttle — so the forced render below executes immediately rather
        // than being silently deferred by a stale throttle window.
        inkInstance.throttledLog?.cancel?.();
        inkInstance.rootNode?.onRender?.cancel?.();
        if (typeof inkInstance.onRender?.cancel === "function") {
          inkInstance.onRender.cancel();
        }

        // Force a synchronous layout + render pass.
        inkInstance.calculateLayout();
        inkInstance.onRender();

        // Safety: reset lastOutput after the forced render so the very next
        // React-driven render cycle also writes output.  This recovers from
        // edge cases where the forced onRender above produced a frame that
        // was buffered/lost by the terminal during its resize animation.
        inkInstance.lastOutput = "";

        // Verification: monitor switches and DPI changes can take 200-500ms
        // to settle.  Check if dims changed after the forced render and, if
        // so, trigger another repaint cycle.
        const renderedCols = stdout.columns;
        const renderedRows = stdout.rows;
        setTimeout(() => {
          if (stdout.columns !== renderedCols || stdout.rows !== renderedRows) {
            scheduleRepaint();
          }
        }, 350);
      } else if (renderHandle && repaintMode === "recovery") {
        // Fallback recovery path: no Ink instance resolved (e.g. test mock).
        renderHandle.clear();
      } else if (repaintMode === "recovery") {
        pendingRecoveryRepaint = true;
      }
    }, 150);
  };

  const onResize = () => {
    if (hasInvalidRestoreDimensions(stdout)) {
      // Transient invalid dimensions (e.g. during maximize/restore on
      // Windows).  Don't clear the screen or reset Ink's cache — we want
      // the old content to stay visible while dimensions are unstable.
      //
      // CRITICAL: always schedule a repaint rather than cancelling the
      // pending timer.  On Windows Terminal, restore-down can emit resize
      // events in this order:
      //   1. valid dims (restored size)  → scheduleRepaint at t+150
      //   2. invalid dims (trailing glitch) → THIS branch
      // Previously this branch cancelled the timer from step 1, leaving
      // the app with repaintArmed=true and no timer — permanent blank.
      // Now the scheduleRepaint call here replaces the old timer with a
      // new one that fires 150ms after the LAST event.  By then the
      // terminal has settled and dims are valid.
      repaintArmed = true;
      scheduleRepaint("recovery");
      return;
    }

    const recoveringFromInvalidDimensions = repaintArmed;
    if (repaintArmed) {
      repaintArmed = false;
    }

    // ── Resize strategy: preserve visible content during the transition ──
    //
    // Don't clear the visible viewport (\x1b[2J]) immediately — that would
    // create a blank frame while React processes the new dimensions.
    //
    //  1. Reset Ink's output cache so the React-driven re-render (triggered
    //     by useTerminalViewport's state update) writes fresh output to
    //     stdout instead of short-circuiting due to lastOutput matching.
    //  2. Schedule one settled repaint after dimensions stop changing. Normal
    //     valid resizes do not clear the viewport; only recovery from invalid
    //     dimensions uses a targeted visible-viewport clear.
    if (inkInstance) {
      inkInstance.lastOutput = "";
    }
    scheduleRepaint(recoveringFromInvalidDimensions ? "recovery" : "soft");
  };

  const cleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    if (repaintDebounceTimer) clearTimeout(repaintDebounceTimer);
    stdout.off("resize", onResize);
    renderHandle?.cleanup();
    // Restore terminal state: disable mouse reporting and bracketed paste.
    stdout.write(`${DISABLE_TRANSCRIPT_WHEEL_MODE}\x1b[?2004l`);
    activeRoot = null;
  };

  const handleFatal = (error: unknown) => {
    cleanup();
    if (error instanceof Error) {
      stderr.write(`${error.stack || error.message}\n`);
    } else if (error) {
      stderr.write(`${String(error)}\n`);
    }
    process.exit(1);
  };

  const handleSignal = () => {
    cleanup();
    process.exit(0);
  };

  stdout.on("resize", onResize);
  registerExitHandler(cleanup);

  // Ensure clean teardown on signals and unhandled failures to prevent
  // leaving the terminal in mouse-reporting mode.
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
  process.on("uncaughtException", handleFatal);
  process.on("unhandledRejection", handleFatal);

  renderHandle = renderApp(<App launchArgs={launchArgs} />, {
    kittyKeyboard: KITTY_KEYBOARD_OPTIONS,
  });

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
