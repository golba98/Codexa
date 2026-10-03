import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeTerminalInput,
  sanitizeTerminalLines,
  sanitizeTerminalOutput,
} from "./terminalSanitize.js";

test("sanitizeTerminalOutput strips ANSI/OSC/control bytes and normalizes line breaks", () => {
  const raw = "A\u001B[31mred\u001B[0m\u001B]0;title\u0007\r\nB\rC\u0007";
  assert.equal(sanitizeTerminalOutput(raw), "Ared\nB\nC");
});

test("sanitizeTerminalInput removes layout-breaking escapes", () => {
  const raw = "hello\u001B[2J\u001B[H\tworld";
  assert.equal(sanitizeTerminalInput(raw), "hello  world");
});

test("sanitizeTerminalLines sanitizes and drops empty lines", () => {
  const lines = ["\u001B[32mok\u001B[0m", " \u0007", "next\rline"];
  assert.deepEqual(sanitizeTerminalLines(lines), ["ok", "next\nline"]);
});
