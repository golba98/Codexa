import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "app.tsx"), "utf8");
const appShellSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ui", "AppShell.tsx"), "utf8");
const composerSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ui", "BottomComposer.tsx"), "utf8");
const launcherSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "codexa.js"), "utf8");
const indexSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.tsx"), "utf8");
const layoutSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ui", "layout.ts"), "utf8");
const clearBoundarySource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "core", "terminal", "clearFrameBoundary.ts"), "utf8");

test("App does not start terminal title guards during busy rendering", () => {
  assert.doesNotMatch(appSource, /debugEventName: "busy-guard"/);
  assert.doesNotMatch(appSource, /acquireTerminalTitleGuard/);
  assert.doesNotMatch(appSource, /setInterval\(\(\) => \{[\s\S]*?refreshTerminalTitle/);
});

test("App does not write terminal title OSC sequences while Ink is active", () => {
  assert.doesNotMatch(appSource, /\\x1b\]0;CODEXA/);
  assert.doesNotMatch(appSource, /\\x1b\]2;CODEXA/);
});

test("App root does not own the busy status animation frame", () => {
  assert.doesNotMatch(appSource, /busyStatusFrame/);
  assert.doesNotMatch(appSource, /useBusyStatusFrame/);
  assert.doesNotMatch(appSource, /BUSY_STATUS_FRAME_MS/);
  assert.doesNotMatch(composerSource, /busyStatusFrame/);
});

test("App mouse capture follows terminalMouseMode setting, defaults to off (selection mode)", () => {
  // mouseCapture is driven by the persisted terminalMouseMode. Default is "selection" so
  // mouseCapture=false by default — no SGR tracking. "wheel" mode enables SGR capture.
  assert.match(appSource, /const mouseCapture = \(mouseOverride \?\? \(terminalMouseMode === "wheel"\)\) && !isMouseIdle/);
  assert.doesNotMatch(appSource, /mouseOverride \?\? false/);
});

test("Workspace display changes do not force AppShell remounts or viewport clears", () => {
  assert.doesNotMatch(appSource, /workspaceLabelEpoch/);
  assert.doesNotMatch(appSource, /workspaceDisplayChange/);
  assert.doesNotMatch(appSource, /key=\{`app-shell-\$\{sessionState\.clearCount\}-/);
});

test("AppShell renders the header as live layout instead of static transcript output", () => {
  assert.match(appShellSource, /MemoizedTopHeader/);
  assert.doesNotMatch(appShellSource, /import \{[^}]*Static[^}]*\} from "ink"/);
  assert.doesNotMatch(appShellSource, /<Static\b/);
  assert.doesNotMatch(appShellSource, /StaticIntroItem/);
  assert.doesNotMatch(appShellSource, /session-intro/);
});

test("Settings panel workspace display save path does not append Settings transcript events", () => {
  const match = appSource.match(/const saveSettingsFromPanel = useCallback\(\(nextSettings: UserSettingValues\) => \{([\s\S]*?)\n  \}, \[/);
  assert.ok(match, "saveSettingsFromPanel callback should exist");
  assert.doesNotMatch(match[1] ?? "", /appendSystemEvent\("Settings"/);
});

test("Settings panel terminal title save path updates only persisted title state", () => {
  assert.match(appSource, /if \(nextSettings\.terminalTitleMode !== terminalTitleMode\) \{\s*setTerminalTitleMode\(nextSettings\.terminalTitleMode\);/);
  assert.doesNotMatch(appSource, /setIntendedTerminalTitle\(terminalTitleLabel/);
  assert.doesNotMatch(appSource, /refreshTerminalTitle\(/);
});

test("App does not reassert terminal titles from live UI state", () => {
  assert.doesNotMatch(appSource, /debugEventName: "busy-start"/);
  assert.doesNotMatch(appSource, /debugEventName: "busy-end"/);
  assert.doesNotMatch(appSource, /terminal-title-label-change/);
});

test("Index owns a single startup terminal title write before Ink renders", () => {
  const writes = indexSource.match(/setIntendedTerminalTitle\(/g) ?? [];
  assert.equal(writes.length, 1);
  assert.match(indexSource, /reason: "startup-title"/);
  assert.doesNotMatch(indexSource, /startTerminalTitleStartupGuard/);
  assert.doesNotMatch(indexSource, /reassertIntendedTerminalTitle/);
});

test("Prompt and shell busy paths do not write titles before state dispatch", () => {
  assert.doesNotMatch(appSource, /writeCurrentTerminalTitleBeforeStateChange/);
  assert.match(appSource, /type: "SUBMIT_PROMPT_RUN"/);
  assert.match(appSource, /dispatchSession\(\{ type: "UI_ACTION", action: \{ type: "SHELL_STARTED"/);
});

test("Terminal title cold-start retries are not mounted inside App", () => {
  assert.doesNotMatch(appSource, /beginColdStartSequence/);
  assert.doesNotMatch(appSource, /postMountTerminalTitleRefreshRef/);
  assert.doesNotMatch(appSource, /retryDelaysMs/);
});

test("App has no live terminal title write helper calls", () => {
  assert.doesNotMatch(appSource, /reassertTerminalTitle/);
  assert.doesNotMatch(appSource, /setIntendedTerminalTitle/);
  assert.doesNotMatch(appSource, /reassertIntendedTerminalTitle/);
  assert.doesNotMatch(appSource, /deriveTerminalTitle\(workspaceRoot, terminalTitleMode\)/);
});

test("App does not reassert titles around child process lifecycle events", () => {
  assert.doesNotMatch(appSource, /codex-process-\$\{event\}/);
  assert.doesNotMatch(appSource, /shell-process-\$\{event\}/);
});

test("Installed launcher preserves inherited stdio for interactive TTY launches", () => {
  assert.match(launcherSource, /const parentHasTTY = parentStdinIsTTY && parentStdoutIsTTY/);
  assert.match(launcherSource, /if \(!isHeadlessMode && parentHasTTY\)/);
  assert.match(launcherSource, /parentHasTTY\s*\?\s*\["inherit", "inherit", "inherit"\]/);
  assert.match(launcherSource, /CODEXA_DEBUG_LAUNCH/);
});

test("Installed launcher does not own terminal titles for interactive TTY launches", () => {
  const launchStartIndex = launcherSource.indexOf('markExecTiming("launcher_start"');
  const helpIndex = launcherSource.indexOf('hasFlag(forwardArgs, "--help", "-h")');

  assert.ok(launchStartIndex >= 0);
  assert.ok(helpIndex > launchStartIndex);
  assert.match(launcherSource, /CODEXA_INITIAL_TERMINAL_TITLE: intendedTerminalTitle/);
  assert.doesNotMatch(launcherSource, /writeIntendedTitle/);
  assert.doesNotMatch(launcherSource, /startLauncherTitleGuard/);
  assert.doesNotMatch(launcherSource, /createTitleStripper/);
  assert.match(launcherSource, /process\.stdout\.write\(chunk\)/);
  assert.match(launcherSource, /process\.stderr\.write\(chunk\)/);
  assert.match(launcherSource, /\/\^\[a-zA-Z\]:\[\\\\\/\]\//);
  assert.doesNotMatch(launcherSource, /intendedTerminalTitle\s*=\s*workspaceRoot/);
});

test("/clear resolves the live Ink instance behind stdout and memoizes it", () => {
  assert.match(appSource, /const inkInstance = useMemo\(\(\) => resolveInkRenderInstance\(stdout\), \[stdout\]\)/);
  assert.match(appSource, /import \{ resolveInkRenderInstance, resetInkOutputForFreshFrame \} from "\.\/core\/terminal\/inkRenderReset\.js"/);
  assert.match(appSource, /import \{ createClearFrameBoundaryController \} from "\.\/core\/terminal\/clearFrameBoundary\.js"/);
});

test("/clear arms a fresh render generation before transcript reset", () => {
  const handleClearMatch = appSource.match(/const handleClear = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/);
  assert.ok(handleClearMatch, "handleClear callback should exist");
  const body = handleClearMatch[1] ?? "";
  const armBoundaryIndex = body.indexOf("beginClearGeneration(clearGeneration)");
  const clearDispatchIndex = body.indexOf('dispatchSession({ type: "CLEAR_TRANSCRIPT" })');
  assert.ok(armBoundaryIndex >= 0, "handleClear should arm clear-generation boundary");
  assert.ok(clearDispatchIndex >= 0, "handleClear should clear transcript state");
  assert.ok(armBoundaryIndex < clearDispatchIndex, "clear generation should be armed before transcript reset");
});

test("Ink render-cache reset is owned by the render path, never wired into out-of-band resize handlers", () => {
  // The repaint authority is clearFrameBoundary's wrapped renderInteractiveFrame:
  // it resets caches both on the /clear boundary AND on width-changing resizes,
  // atomically with the very frame it writes (no transient blank). It must NOT be
  // called from the out-of-band resize paths (index.tsx onResize / ui/layout.ts),
  // where a clear/reset would blank the screen until the next React commit.
  assert.match(clearBoundarySource, /resetInkOutputForFreshFrame/, "render-path wrapper owns the cache reset");
  // app.tsx only references it in the /clear fallback (when the boundary can't arm).
  const appResetCalls = appSource.match(/resetInkOutputForFreshFrame\(/g) ?? [];
  assert.equal(appResetCalls.length, 1, "app.tsx references reset once (handleClear fallback only)");
  assert.doesNotMatch(indexSource, /resetInkOutputForFreshFrame/);
  assert.doesNotMatch(layoutSource, /resetInkOutputForFreshFrame/);
});

test("Resize repaint uses the scrollback-inclusive transcript clear, not a viewport-only clear", () => {
  // A width grow re-exposes the pre-resize frame from scrollback; the resize repaint
  // must erase scrollback too (transcriptClear / \x1b[3J), matching the /clear path.
  // Otherwise the old frame stacks behind the new one on GNOME Terminal.
  assert.match(clearBoundarySource, /clearTranscript\(`\$\{source\}:resizeRefresh`\)/, "resize repaint clears the transcript (scrollback-inclusive)");
  assert.doesNotMatch(clearBoundarySource, /clearViewport\(`\$\{source\}/, "resize repaint must not use a viewport-only clear");
});

test("/clear fallback preserves clear-then-reset ordering when boundary cannot arm", () => {
  const handleClearMatch = appSource.match(/const handleClear = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/);
  assert.ok(handleClearMatch, "handleClear callback should exist");
  const body = handleClearMatch[1] ?? "";
  const fallbackIndex = body.indexOf("if (!clearBoundaryArmed) {");
  const clearIndex = body.indexOf('terminalControl.clearTranscript("src/app.tsx:handleClear:fallback")');
  const resetIndex = body.indexOf("resetInkOutputForFreshFrame({ instance: inkInstance");
  assert.ok(fallbackIndex >= 0, "fallback block should exist for unresolved Ink boundary");
  assert.ok(clearIndex > fallbackIndex, "fallback should physically clear the terminal");
  assert.ok(resetIndex > clearIndex, "fallback should reset Ink caches after physical clear");
});

test("/clear forces a deterministic post-clear repaint when the boundary signals readiness", () => {
  // Ink writes a frame during the React commit (resetAfterCommit), before passive
  // effects run, so the cleared frame is suppressed against the boundary's stale
  // gate. The syncRenderState effect must consume the boundary's readiness signal
  // and force exactly one more commit so the authoritative post-clear frame is
  // flushed deterministically instead of waiting on an incidental later render.
  assert.match(appSource, /const postClearRepaintPending = clearFrameBoundaryController\.syncRenderState\(/);
  assert.match(appSource, /if \(postClearRepaintPending\) \{[\s\S]*?bumpPostClearRepaint\(/);
});

test("Startup keeps a single resize listener and disables Ink's competing handler", () => {
  const resizeRegistrations = indexSource.match(/stdout\.on\("resize"/g) ?? [];
  assert.equal(resizeRegistrations.length, 1, "exactly one resize listener is registered");
  assert.match(indexSource, /inkInstance\?\.unsubscribeResize/);
  // onResize stays imperative-free: it must not force Ink renders or clears.
  const onResizeMatch = indexSource.match(/const onResize = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(onResizeMatch, "onResize handler should exist");
  assert.doesNotMatch(onResizeMatch[1] ?? "", /clearTranscript|clearViewport|resetInkOutputForFreshFrame|\.clear\(\)/);
});

test("Fix uses alternate-screen mode stably and has exactly one Ink root", () => {
  // index.tsx uses alternateScreen to enter alternate screen once on startup
  // and exit on cleanup.
  assert.match(indexSource, /setAlternateScreen/);
  // app.tsx must not bounce or use alternate screen mode
  assert.doesNotMatch(appSource, /\\x1b\[\?1049h/);
  assert.doesNotMatch(appSource, /alternateScreen|enterAlternativeScreen/);
  const renderRoots = indexSource.match(/renderApp\(<App /g) ?? [];
  assert.equal(renderRoots.length, 1, "exactly one Ink root is mounted");
});
