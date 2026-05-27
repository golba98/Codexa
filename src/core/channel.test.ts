import assert from "node:assert/strict";
import test from "node:test";
import { formatCodexaBrandLabel, formatCodexaVersionLabel, isLocalDevChannel } from "./channel.js";

test("local-dev channel formats an obvious dev version label", () => {
  const env = { CODEXA_CHANNEL: "local-dev" };

  assert.equal(isLocalDevChannel(env), true);
  assert.equal(formatCodexaVersionLabel("1.0.2", env), "1.0.2-dev local");
  assert.equal(formatCodexaBrandLabel(env), "Codexa v1.0.1-dev local");
});

test("published channel keeps normal version label", () => {
  const env = {};

  assert.equal(isLocalDevChannel(env), false);
  assert.equal(formatCodexaVersionLabel("1.0.2", env), "1.0.2");
});
