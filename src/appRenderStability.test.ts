import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "app.tsx"), "utf8");
const appShellSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ui", "AppShell.tsx"), "utf8");
const composerSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ui", "BottomComposer.tsx"), "utf8");

test("App does not start a terminal title guard during busy rendering", () => {
  assert.doesNotMatch(appSource, /acquireTerminalTitleGuard/);
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
  assert.match(appSource, /reassertTerminalTitle\(terminalTitleLabel, write\)/);
});

test("Terminal title effect is keyed by terminal title, not workspace display", () => {
  const match = appSource.match(/useEffect\(\(\) => \{\s*const write = \(chunk: string\) => \{ stdout\.write\(chunk\); \};[\s\S]*?reassertTerminalTitle\(terminalTitleLabel, write\);[\s\S]*?\n  \}, \[([^\]]+)\]\);/);
  assert.ok(match, "terminal title effect should exist");
  const deps = match[1] ?? "";
  assert.match(deps, /terminalTitleLabel/);
  assert.doesNotMatch(deps, /workspaceDisplayMode|workspaceLabel|sessionState\.clearCount/);
});

test("Terminal title effect has one idempotent post-mount refresh", () => {
  assert.match(appSource, /postMountTerminalTitleRefreshRef/);
  assert.match(appSource, /setTimeout\(\(\) => \{\s*reassertTerminalTitle\(terminalTitleLabel, write\);/);
  assert.doesNotMatch(appSource, /retryDelaysMs/);
});
