import assert from "node:assert/strict";
import test from "node:test";
import type { Key } from "ink";
import { composerKeymap } from "./composerKeymap.js";

type ComposerKeyContext = Parameters<typeof composerKeymap>[2];

const IDLE_CONTEXT: ComposerKeyContext = {
  mouseEvent: false,
  backtabEvent: false,
  ctrlMEvent: false,
  ctrlAltPEvent: false,
  searchQuery: null,
  fileSuggestionCount: 0,
  fileQuery: undefined,
  showSuggestions: false,
  suggestionCount: 0,
  chord: false,
};

function key(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

// Ctrl+O is the documented model picker shortcut. It was rebound to the transcript once
// (v0.1.3–v0.1.12); keep this guard so a future rebind fails loudly instead of shipping.
test("Ctrl+O opens the model picker", () => {
  assert.equal(composerKeymap("o", key({ ctrl: true }), IDLE_CONTEXT), "model-picker");
});

test("Ctrl+O never opens the transcript", () => {
  assert.notEqual(composerKeymap("o", key({ ctrl: true }), IDLE_CONTEXT), "transcript");
});

test("Alt+P remains a model picker alias", () => {
  assert.equal(composerKeymap("p", key({ meta: true }), IDLE_CONTEXT), "model-picker");
});

test("Ctrl+T opens the transcript", () => {
  assert.equal(composerKeymap("t", key({ ctrl: true }), IDLE_CONTEXT), "transcript");
});

test("plain o and t are still typed as text", () => {
  assert.equal(composerKeymap("o", key(), IDLE_CONTEXT), "text");
  assert.equal(composerKeymap("t", key(), IDLE_CONTEXT), "text");
});
