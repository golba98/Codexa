import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalModeController, TERMINAL_SEQUENCES } from "./terminalControl.js";

test("mouse reporting enables only normal mouse tracking with SGR coordinates", () => {
  let writes = "";
  const controller = createTerminalModeController((chunk) => {
    writes += chunk;
  });

  controller.setMouseReporting(true, "test");

  assert.equal(writes, "\x1b[?1000h\x1b[?1006h");
  assert.equal(TERMINAL_SEQUENCES.mouseEnable, "\x1b[?1000h\x1b[?1006h");
  assert.doesNotMatch(writes, /\x1b\[\?1002h|\x1b\[\?1003h|\x1b\[\?1004h|\x1b\[\?1005h|\x1b\[\?1015h/);
  assert.doesNotMatch(writes, /\x1b\[\?1049h|\x1b\[\?1049l|\x1b\[3J/);
});

test("mouse reporting cleanup disables broad modes defensively", () => {
  let writes = "";
  const controller = createTerminalModeController((chunk) => {
    writes += chunk;
  });

  controller.setMouseReporting(false, "test");

  assert.match(writes, /\x1b\[\?1000l/);
  assert.match(writes, /\x1b\[\?1002l/);
  assert.match(writes, /\x1b\[\?1003l/);
  assert.match(writes, /\x1b\[\?1006l/);
  assert.match(writes, /\x1b\[\?1015l/);
});
