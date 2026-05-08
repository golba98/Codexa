import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "app.tsx"), "utf8");
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
  assert.match(appSource, /const mouseCapture = mouseOverride \?\? \(terminalMouseMode === "wheel"\)/);
  assert.doesNotMatch(appSource, /mouseOverride \?\? false/);
});
