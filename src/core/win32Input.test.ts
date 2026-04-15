import assert from "node:assert/strict";
import test from "node:test";
import {
  createWin32InputTranslator,
  ENABLE_WIN32_INPUT_MODE,
  DISABLE_WIN32_INPUT_MODE,
  translateWin32InputSequence,
} from "./win32Input.js";

test("exports the Win32 input mode sequences used for Windows Terminal", () => {
  assert.equal(ENABLE_WIN32_INPUT_MODE, "\u001b[?9001h");
  assert.equal(DISABLE_WIN32_INPUT_MODE, "\u001b[?9001l");
});

test("translates ctrl+m into a distinct sequence", () => {
  assert.equal(
    translateWin32InputSequence("\u001b[77;50;13;1;8;1_"),
    "\u001b[109;5u",
  );
});

test("translates plain enter without changing submit behavior", () => {
  assert.equal(
    translateWin32InputSequence("\u001b[13;28;13;1;0;1_"),
    "\r",
  );
});

test("translates text input and ignores the key-up record", () => {
  const translator = createWin32InputTranslator();

  assert.deepEqual(translator.push("\u001b[65;30;97;1;0;1_\u001b[65;30;97;0;0;1_"), ["a"]);
});

test("translates navigation keys back into the standard VT sequences", () => {
  assert.equal(
    translateWin32InputSequence("\u001b[38;72;0;1;0;1_"),
    "\u001b[A",
  );
  assert.equal(
    translateWin32InputSequence("\u001b[46;83;0;1;0;1_"),
    "\u001b[3~",
  );
});

test("buffers incomplete Win32 sequences until the final byte arrives", () => {
  const translator = createWin32InputTranslator();

  assert.deepEqual(translator.push("\u001b[77;50;13;1;8"), []);
  assert.deepEqual(translator.push(";1_"), ["\u001b[109;5u"]);
});
