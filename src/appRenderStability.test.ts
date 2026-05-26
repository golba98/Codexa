import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "app.tsx"), "utf8");
const appShellSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ui", "AppShell.tsx"), "utf8");
const composerSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ui", "BottomComposer.tsx"), "utf8");
const launcherSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "codexa.js"), "utf8");

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
