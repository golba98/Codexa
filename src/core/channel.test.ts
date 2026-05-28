import assert from "node:assert/strict";
import test from "node:test";
import { formatCodexaBrandLabel, formatCodexaVersionLabel, isLocalDevChannel } from "./channel.js";
import { APP_VERSION } from "../config/settings.js";

test("local-dev channel formats an obvious dev version label", () => {
  const env = { CODEXA_CHANNEL: "local-dev" };

  assert.equal(isLocalDevChannel(env), true);
  assert.equal(formatCodexaVersionLabel(APP_VERSION, env), `${APP_VERSION}-dev local`);
  assert.equal(formatCodexaBrandLabel(env), `Codexa v${APP_VERSION}-dev local`);
});

test("published channel keeps normal version label", () => {
  const env = {};

  assert.equal(isLocalDevChannel(env), false);
  assert.equal(formatCodexaVersionLabel("1.0.2", env), "1.0.2");
});
