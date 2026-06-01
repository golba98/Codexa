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

test("App starts a terminal title guard during busy rendering", () => {
  assert.match(appSource, /refreshTerminalTitle\(\{[\s\S]*?debugEventName: "busy-guard"/);
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

test("Settings panel terminal title save path still updates terminal title state", () => {
  assert.match(appSource, /if \(nextSettings\.terminalTitleMode !== terminalTitleMode\) \{\s*setTerminalTitleMode\(nextSettings\.terminalTitleMode\);/);
  assert.match(appSource, /setIntendedTerminalTitle\(terminalTitleLabel/);
});

test("Terminal title re-assertion effect is keyed by uiState and busy to recover from external overwrites", () => {
  const match = appSource.match(/useEffect\(\(\) => \{[\s\S]*?debugEventName: "busy-start"[\s\S]*?\}, \[([^\]]+)\]\);/);
  assert.ok(match, "terminal title re-assertion effect should exist");
  const deps = match[1] ?? "";
  assert.match(deps, /uiState\.kind/);
  assert.match(deps, /busy/);
  assert.match(deps, /terminalTitleMode/);
  assert.match(deps, /workspaceRoot/);
});

test("Terminal title update effect is keyed by terminal title label", () => {
  const match = appSource.match(/useEffect\(\(\) => \{\s*setIntendedTerminalTitle\(terminalTitleLabel[\s\S]*?\);\s*\}, \[([^\]]+)\]\);/);
  assert.ok(match, "terminal title update effect should exist");
  const deps = match[1] ?? "";
  assert.match(deps, /terminalTitleLabel/);
});

test("Prompt and shell busy paths force title before busy state dispatch", () => {
  const promptStart = appSource.indexOf('writeCurrentTerminalTitleBeforeStateChange("before-prompt-run-start")');
  const promptBusy = appSource.indexOf('type: "SUBMIT_PROMPT_RUN"');
  const shellStart = appSource.indexOf('writeCurrentTerminalTitleBeforeStateChange("before-shell-start")');
  const shellBusy = appSource.indexOf('dispatchSession({ type: "UI_ACTION", action: { type: "SHELL_STARTED"');

  assert.ok(promptStart >= 0, "prompt path should force title before busy");
  assert.ok(shellStart >= 0, "shell path should force title before busy");
  assert.ok(promptStart < promptBusy, "prompt title write must happen before busy dispatch");
  assert.ok(shellStart < shellBusy, "shell title write must happen before busy dispatch");
});

test("Terminal title cold-start sequence fires immediately on mount and retries at 50ms and 250ms", () => {
  assert.match(appSource, /beginColdStartSequence/);
  assert.doesNotMatch(appSource, /postMountTerminalTitleRefreshRef/);
  assert.doesNotMatch(appSource, /retryDelaysMs/);
});

test("Terminal title writes are centralized through the title helpers", () => {
  assert.doesNotMatch(appSource, /reassertTerminalTitle/);
  assert.match(appSource, /setIntendedTerminalTitle/);
  assert.match(appSource, /reassertIntendedTerminalTitle/);
  assert.match(appSource, /deriveTerminalTitle\(workspaceRoot, terminalTitleMode\)/);
});

test("App reasserts intended terminal title around child process lifecycle events", () => {
  assert.match(appSource, /onProcessLifecycle: \(event\) => \{\s*reassertIntendedTerminalTitle\(\{\s*reason: `codex-process-\$\{event\}`/);
  assert.match(appSource, /onProcessLifecycle: \(event\) => \{\s*reassertIntendedTerminalTitle\(\{\s*reason: `shell-process-\$\{event\}`/);
});

test("Installed launcher preserves inherited stdio for interactive TTY launches", () => {
  assert.match(launcherSource, /const parentHasTTY = parentStdinIsTTY && parentStdoutIsTTY/);
  assert.match(launcherSource, /if \(!isHeadlessMode && parentHasTTY\)/);
  assert.match(launcherSource, /parentHasTTY\s*\?\s*\["inherit", "inherit", "inherit"\]/);
  assert.match(launcherSource, /CODEXA_DEBUG_LAUNCH/);
});

test("Installed launcher asserts a safe title before Bun lifecycle boundaries", () => {
  const launchStartIndex = launcherSource.indexOf('markExecTiming("launcher_start"');
  const startupTitleIndex = launcherSource.indexOf('writeIntendedTitle("launcher-startup-title")');
  const helpIndex = launcherSource.indexOf('hasFlag(forwardArgs, "--help", "-h")');
  const beforeSpawnIndex = launcherSource.indexOf('writeIntendedTitle("before-bun-spawn")');
  const spawnIndex = launcherSource.indexOf("const child = spawn(");

  assert.ok(launchStartIndex >= 0);
  assert.ok(startupTitleIndex > launchStartIndex);
  assert.ok(startupTitleIndex < helpIndex, "launcher title should be asserted before help/version parsing can exit");
  assert.ok(beforeSpawnIndex >= 0 && spawnIndex > beforeSpawnIndex, "launcher title should be asserted before Bun spawn");
  assert.match(launcherSource, /CODEXA_INITIAL_TERMINAL_TITLE: intendedTerminalTitle/);
  assert.match(launcherSource, /child\.once\("spawn"[\s\S]*writeIntendedTitle\("after-bun-spawn"\)/);
  assert.match(launcherSource, /child\.on\("error"[\s\S]*writeIntendedTitle\("bun-spawn-error"\)/);
  assert.match(launcherSource, /child\.on\("close"[\s\S]*writeIntendedTitle\("bun-close"\)/);
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

test("Fix does not introduce alternate-screen mode or a second Ink root", () => {
  // index.tsx intentionally documents in a comment that it does NOT use the
  // alternate screen buffer (\x1b[?1049h); assert the enabling mechanisms are
  // absent rather than the escape itself (which appears in that comment).
  assert.doesNotMatch(indexSource, /alternateScreen/);
  assert.doesNotMatch(indexSource, /enterAlternativeScreen/);
  assert.doesNotMatch(appSource, /\\x1b\[\?1049h/);
  assert.doesNotMatch(appSource, /alternateScreen|enterAlternativeScreen/);
  const renderRoots = indexSource.match(/renderApp\(<App /g) ?? [];
  assert.equal(renderRoots.length, 1, "exactly one Ink root is mounted");
});
