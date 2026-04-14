import assert from "node:assert/strict";
import test from "node:test";
import { parseLaunchArgs } from "./launchArgs.js";

test("parses profile and repeated config overrides", () => {
  const parsed = parseLaunchArgs([
    "--profile",
    "review",
    "--config",
    "model=\"gpt-5.4\"",
    "-c",
    "codexa.mode=\"suggest\"",
  ]);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.profile, "review");
  assert.deepEqual(parsed.value.configOverrides, [
    "model=\"gpt-5.4\"",
    "codexa.mode=\"suggest\"",
  ]);
  assert.deepEqual(parsed.value.passthroughArgs, [
    "--profile",
    "review",
    "--config",
    "model=\"gpt-5.4\"",
    "-c",
    "codexa.mode=\"suggest\"",
  ]);
});

test("rejects missing profile values", () => {
  const parsed = parseLaunchArgs(["--profile"]);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /--profile/i);
});

test("rejects malformed config payloads", () => {
  const parsed = parseLaunchArgs(["--config", "model"]);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /key=value/i);
});
