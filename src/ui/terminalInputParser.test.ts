import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalInputParser } from "./terminalInputParser.js";

test("passes plain printable text through unchanged", () => {
  const parser = createTerminalInputParser();

  assert.deepEqual(parser.push("hello"), [{ type: "text", text: "hello" }]);
});

test("buffers incomplete CSI sequences until the final byte arrives", () => {
  const parser = createTerminalInputParser();

  assert.deepEqual(parser.push("\u001b[67;46;99;1:0:1"), []);
  assert.deepEqual(parser.push("u"), [
    {
      type: "control",
      control: "ignored_sequence",
      leakedText: "[67;46;99;1:0:1u",
    },
  ]);
});

test("buffers incomplete OSC sequences until a terminator arrives", () => {
  const parser = createTerminalInputParser();

  assert.deepEqual(parser.push("\u001b]0;Codexa"), []);
  assert.deepEqual(parser.push("\u0007tail"), [
    {
      type: "control",
      control: "ignored_sequence",
      leakedText: "]0;Codexa\u0007",
    },
    { type: "text", text: "tail" },
  ]);
});

test("buffers OSC sequences terminated by ST across chunk boundaries", () => {
  const parser = createTerminalInputParser();

  assert.deepEqual(parser.push("head\u001b]52;c;abc"), [
    { type: "text", text: "head" },
  ]);
  assert.deepEqual(parser.push("\u001b"), []);
  assert.deepEqual(parser.push("\\tail"), [
    {
      type: "control",
      control: "ignored_sequence",
      leakedText: "]52;c;abc\u001b\\",
    },
    { type: "text", text: "tail" },
  ]);
});

test("drops unknown CSI keyboard protocol sequences safely", () => {
  const parser = createTerminalInputParser();

  assert.deepEqual(parser.push("\u001b[65;2u"), [
    {
      type: "control",
      control: "ignored_sequence",
      leakedText: "[65;2u",
    },
  ]);
});

test("drops SS3 sequences safely, including split chunks", () => {
  const parser = createTerminalInputParser();

  assert.deepEqual(parser.push("\u001b"), []);
  assert.deepEqual(parser.push("OPtext"), [
    { type: "control", control: "ignored_sequence", leakedText: "OP" },
    { type: "text", text: "text" },
  ]);
});

test("classifies delete, shift+tab, ctrl+m, mouse, and focus events as controls", () => {
  const parser = createTerminalInputParser();

  assert.deepEqual(parser.push("\u001b[3~"), [
    { type: "control", control: "delete", leakedText: "[3~" },
  ]);
  assert.deepEqual(parser.push("\u001b[Z"), [
    { type: "control", control: "shift_tab", leakedText: "[Z" },
  ]);
  assert.deepEqual(parser.push("\u001b[109;5u"), [
    { type: "control", control: "ctrl_m", leakedText: "[109;5u" },
  ]);
  assert.deepEqual(parser.push("\u001b[<64;12;9M"), [
    { type: "control", control: "mouse", leakedText: "[<64;12;9M" },
  ]);
  assert.deepEqual(parser.push("\u001b[MABC"), [
    { type: "control", control: "mouse", leakedText: "[MABC" },
  ]);
  assert.deepEqual(parser.push("\u001b[I\u001b[O"), [
    { type: "control", control: "focus", leakedText: "[I" },
    { type: "control", control: "focus", leakedText: "[O" },
  ]);
});

test("keeps bracketed paste payload while swallowing the wrappers", () => {
  const parser = createTerminalInputParser();

  assert.deepEqual(parser.push("\u001b[200~alpha\nbeta\u001b[201~"), [
    { type: "control", control: "ignored_sequence", leakedText: "[200~" },
    { type: "paste", text: "alpha\nbeta" },
    { type: "control", control: "ignored_sequence", leakedText: "[201~" },
  ]);
});

test("buffers incomplete bracketed paste until the closing wrapper arrives", () => {
  const parser = createTerminalInputParser();

  assert.deepEqual(parser.push("\u001b[200~alpha"), [
    { type: "control", control: "ignored_sequence", leakedText: "[200~" },
  ]);
  assert.deepEqual(parser.push("\nbe"), []);
  assert.deepEqual(parser.push("ta\u001b[201~"), [
    { type: "paste", text: "alpha\nbeta" },
    { type: "control", control: "ignored_sequence", leakedText: "[201~" },
  ]);
});

test("preserves only printable text when control sequences are mixed into a chunk", () => {
  const parser = createTerminalInputParser();

  assert.deepEqual(parser.push("alpha\u001b[<0;26;24Mbeta\u001b]0;title\u0007gamma\u001bOPdelta"), [
    { type: "text", text: "alpha" },
    { type: "control", control: "mouse", leakedText: "[<0;26;24M" },
    { type: "text", text: "beta" },
    { type: "control", control: "ignored_sequence", leakedText: "]0;title\u0007" },
    { type: "text", text: "gamma" },
    { type: "control", control: "ignored_sequence", leakedText: "OP" },
    { type: "text", text: "delta" },
  ]);
});
