import assert from "node:assert/strict";
import test from "node:test";
import type { Screen } from "../session/types.js";
import { getRenderModeForScreen } from "./renderMode.js";

test("main screen uses terminal scrollback mode", () => {
  assert.equal(getRenderModeForScreen("main"), "terminal-scrollback");
});

test("overlay screens use fullscreen tui mode", () => {
  const overlayScreens: Screen[] = [
    "model-picker",
    "mode-picker",
    "backend-picker",
    "provider-picker",
    "auth-panel",
    "reasoning-picker",
    "theme-picker",
    "settings-panel",
    "permissions-panel",
    "permissions-approval-picker",
    "permissions-sandbox-picker",
    "permissions-network-picker",
    "permissions-add-writable-root",
    "permissions-remove-writable-root",
    "import-confirmation",
    "update-prompt",
  ];

  for (const screen of overlayScreens) {
    assert.equal(getRenderModeForScreen(screen), "fullscreen-tui", screen);
  }
});
