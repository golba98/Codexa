import React from "react";
import { render, type Instance, type RenderOptions } from "ink";
import { App } from "./app.js";
import { parseLaunchArgs, type LaunchArgs } from "./config/launchArgs.js";
import { getTerminalCapability } from "./core/terminalCapabilities.js";
import * as renderDebug from "./core/perf/renderDebug.js";
import { MIN_VIEWPORT_COLS, MIN_VIEWPORT_ROWS } from "./ui/layout.js";
import { SET_TERMINAL_TITLE } from "./core/terminalTitle.js";
import {
  createTerminalModeController,
  TERMINAL_SEQUENCES,
  traceTerminalClear,
  writeTerminalControl,
} from "./core/terminalControl.js";

type RenderHandle = Pick<Instance, "clear" | "cleanup" | "waitUntilExit">;
const KITTY_KEYBOARD_OPTIONS: RenderOptions["kittyKeyboard"] = {
  mode: "auto",
  flags: ["disambiguateEscapeCodes"],
};

/**
 * Typed subset of the internal Ink class instance we access to disable Ink's
 * built-in resize listener. Post-startup repainting is driven by React layout
 * state, not by forcing Ink's private render buffers.
 */
interface InkInstance {
  unsubscribeResize?: () => void;
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
  resolveInkInstanceForStdout: (stdout: AppStdout) => InkInstance | null;
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
  resolveInkInstanceForStdout = resolveInkInstance,
  registerExitHandler = (handler) => {
    process.on("exit", handler);
  },
}: Partial<StartAppDependencies> = {}): StartAppResult {
  renderDebug.configureRenderDebug(env);

  if (activeRoot) {
    return { started: true, exitCode: 0 };
  }

  const terminal = createTerminalModeController((chunk) => stdout.write(chunk));
  const writeStdout = (chunk: string, source: string): boolean => terminal.write(chunk, source);

  const writeStderr = (chunk: string, source: string): boolean => {
    return writeTerminalControl((value) => stderr.write(value), "stderr", source, chunk);
  };

  const capability = getTerminalCapability({
    stdinIsTTY: Boolean(stdin.isTTY),
    stdoutIsTTY: Boolean(stdout.isTTY),
    platform,
    env,
  });

  if (!capability.supported) {
    writeStderr(`${capability.message}\n`, "src/index.tsx:unsupportedTerminal");
    return { started: false, exitCode: 1 };
  }
  if (capability.warning) {
    writeStderr(`${capability.warning}\n`, "src/index.tsx:terminalCapabilityWarning");
  }

  const parsedLaunchArgs = parseLaunchArgs(argv);
  if (!parsedLaunchArgs.ok) {
    writeStderr(`${parsedLaunchArgs.error}\n`, "src/index.tsx:launchArgs");
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
  traceTerminalClear("src/index.tsx:startup", { mode: "hard" });
  writeStdout(`${SET_TERMINAL_TITLE}${TERMINAL_SEQUENCES.hardRepaint}`, "src/index.tsx:startup");
  terminal.setBracketedPaste(true, "src/index.tsx:startup.bracketedPaste");

  let cleanupDone = false;
  let repaintArmed = false;
  let renderHandle: RenderHandle | null = null;
  let inkInstance: InkInstance | null = null;

  const onResize = () => {
    renderDebug.traceEvent("terminal", "resize", {
      cols: stdout.columns,
      rows: stdout.rows,
      invalid: hasInvalidRestoreDimensions(stdout),
    });

    if (hasInvalidRestoreDimensions(stdout)) {
      // Transient invalid dimensions (e.g. during maximize/restore on
      // Windows). Keep the previous frame visible and let useTerminalViewport
      // preserve the last renderable layout until valid dimensions return.
      repaintArmed = true;
      return;
    }

    if (repaintArmed) {
      repaintArmed = false;
    }

    // useTerminalViewport owns resize-driven React state. Do not clear the
    // terminal, reset Ink output caches, or force Ink renders here; those
    // imperative paths can produce a transient empty frame during streaming.
  };

  const cleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    stdout.off("resize", onResize);
    renderHandle?.cleanup();
    // Restore terminal state: disable mouse reporting and bracketed paste.
    terminal.setMouseReporting(false, "src/index.tsx:cleanup.mouse");
    terminal.setBracketedPaste(false, "src/index.tsx:cleanup.bracketedPaste");
    terminal.resetModes();
    activeRoot = null;
  };

  const handleFatal = (error: unknown) => {
    cleanup();
    if (error instanceof Error) {
      writeStderr(`${error.stack || error.message}\n`, "src/index.tsx:fatalError");
    } else if (error) {
      writeStderr(`${String(error)}\n`, "src/index.tsx:fatalUnknown");
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
  inkInstance = resolveInkInstanceForStdout(stdout);

  // Remove Ink's own resize handler so the app is the sole resize handler.
  // This eliminates the race where Ink's resized() fires alongside our
  // onResize, causing interleaved renders that desync logUpdate.
  if (inkInstance?.unsubscribeResize) {
    inkInstance.unsubscribeResize();
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
