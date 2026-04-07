import assert from "node:assert/strict";
import test from "node:test";
import {
  fitLeftRightRow,
  getDisplayWidth,
  stripAnsi,
  truncateEnd,
  truncateMiddle,
  truncatePath,
} from "./displayText.js";

test("strips ansi codes before measuring display width", () => {
  const styled = "\u001b[31mALERT\u001b[39m MODE";

  assert.equal(stripAnsi(styled), "ALERT MODE");
  assert.equal(getDisplayWidth(styled), "ALERT MODE".length);
});

test("truncates text by visible width rather than raw byte length", () => {
  assert.equal(truncateEnd("⚡⚡ ready", 5), "⚡⚡…");
  assert.equal(truncateMiddle("C:\\Users\\Jordan\\Projects\\Codexa", 14), "C:\\User…Codexa");
});

test("keeps right-aligned labels within the width budget", () => {
  const fitted = fitLeftRightRow({
    left: "Workspace: C:\\Users\\Jordan\\Development\\13-Custom CLI",
    right: "done",
    width: 24,
  });

  assert.equal(fitted.right, "done");
  assert.ok(getDisplayWidth(`${fitted.left}${fitted.gap}${fitted.right}`) <= 24);
});

test("middle truncates paths while preserving the useful tail", () => {
  const value = truncatePath("C:\\Users\\Jordan\\Projects\\13-Custom CLI", 20);

  assert.match(value, /^C:\\/);
  assert.match(value, /13-Custom CLI$/);
  assert.match(value, /…/);
});
