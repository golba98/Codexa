import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_NAME,
  APP_VERSION,
  CODEXA_CHANNEL_ENV,
  LOCAL_DEV_CHANNEL,
  formatBrandLabel,
  formatDisplayVersion,
  getAppBuildInfo,
  isDevBuild,
} from "./buildInfo.js";

test("published build metadata formats the release version", () => {
  const env = {};
  const info = getAppBuildInfo(env);

  assert.equal(APP_NAME, "Codexa");
  assert.equal(APP_VERSION, "1.1.0");
  assert.equal(isDevBuild(env), false);
  assert.equal(info.displayVersion, "1.1.0");
  assert.equal(info.brandLabel, "Codexa v1.1.0");
  assert.equal(formatDisplayVersion(APP_VERSION, env), "1.1.0");
  assert.equal(formatBrandLabel(env), "Codexa v1.1.0");
});

test("local-dev build metadata uses dev suffix without legacy local branding", () => {
  const env = { [CODEXA_CHANNEL_ENV]: LOCAL_DEV_CHANNEL };
  const info = getAppBuildInfo(env);

  assert.equal(isDevBuild(env), true);
  assert.equal(info.displayVersion, "1.1.0-dev");
  assert.equal(info.brandLabel, "Codexa v1.1.0-dev");
  assert.doesNotMatch(info.brandLabel, new RegExp("dev " + "local"));
  assert.equal(formatDisplayVersion(APP_VERSION, env), "1.1.0-dev");
  assert.equal(formatBrandLabel(env), "Codexa v1.1.0-dev");
});
