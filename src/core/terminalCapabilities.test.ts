import assert from "node:assert/strict";
import test from "node:test";
import { getTerminalCapability } from "./terminalCapabilities.js";

test("allows a modern Windows VT terminal", () => {
  const result = getTerminalCapability({
    stdinIsTTY: true,
    stdoutIsTTY: true,
    platform: "win32",
    env: { WT_SESSION: "1", TERM: "xterm-256color" },
  });

  assert.equal(result.supported, true);
  assert.equal(result.reason, "supported");
});

test("rejects an unsupported Windows terminal", () => {
  const result = getTerminalCapability({
    stdinIsTTY: true,
    stdoutIsTTY: true,
    platform: "win32",
    env: {},
  });

  assert.equal(result.supported, false);
  assert.equal(result.reason, "unsupported-terminal");
  assert.match(result.message, /VT control sequences/i);
});

test("rejects a dumb terminal even when it is interactive", () => {
  const result = getTerminalCapability({
    stdinIsTTY: true,
    stdoutIsTTY: true,
    platform: "linux",
    env: { TERM: "dumb" },
  });

  assert.equal(result.supported, false);
  assert.equal(result.reason, "unsupported-terminal");
});

test("rejects redirected or non-interactive output", () => {
  const result = getTerminalCapability({
    stdinIsTTY: true,
    stdoutIsTTY: false,
    platform: "linux",
    env: { TERM: "xterm-256color" },
  });

  assert.equal(result.supported, false);
  assert.equal(result.reason, "notty");
  assert.match(result.message, /interactive terminal/i);
});
