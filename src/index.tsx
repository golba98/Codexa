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
  let repaintDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const performHardRepaint = () => {
    stdout.write(HARD_REPAINT_SEQUENCE);
    if (renderHandle) {
      // Reset Ink's lastOutput cache so the next onRender() call always
      // re-draws, even when terminal dimensions haven't changed (e.g. after
      // a taskbar restore where cols/rows are identical to before).
      (renderHandle as any).lastOutput = "";
      renderHandle.clear();
    }
  };

  const scheduleRepaint = () => {
    if (repaintDebounceTimer) clearTimeout(repaintDebounceTimer);
    repaintDebounceTimer = setTimeout(() => {
      repaintDebounceTimer = null;
      if (renderHandle) {
        // Soft re-render: erase current output and redraw with final settled
        // dimensions.  We intentionally do NOT call performHardRepaint() here
        // because a second \x1b[2J would push the fresh render back into the
        // scrollback buffer, and Ink would skip re-drawing (output unchanged
        // vs lastOutput) — leaving the screen blank.
        renderHandle.clear();
        (renderHandle as any).lastOutput = "";
        (renderHandle as any).onRender?.();
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
