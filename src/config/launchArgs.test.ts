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

  assert.equal(parsed.value.help, false);
  assert.equal(parsed.value.version, false);
  assert.equal(parsed.value.initialPrompt, null);
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

test("parses inline profile and config assignments", () => {
  const parsed = parseLaunchArgs([
    "--profile=review",
    "--config=model=\"gpt-5.4-mini\"",
    "-c=codexa.mode=\"auto-edit\"",
  ]);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.profile, "review");
  assert.deepEqual(parsed.value.configOverrides, [
    "model=\"gpt-5.4-mini\"",
    "codexa.mode=\"auto-edit\"",
  ]);
  assert.deepEqual(parsed.value.passthroughArgs, [
    "--profile=review",
    "--config=model=\"gpt-5.4-mini\"",
    "-c=codexa.mode=\"auto-edit\"",
  ]);
});

test("parses help and version flags without passthrough", () => {
  const parsed = parseLaunchArgs(["--help", "-v"]);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.help, true);
  assert.equal(parsed.value.version, true);
  assert.equal(parsed.value.initialPrompt, null);
  assert.deepEqual(parsed.value.passthroughArgs, []);
});

test("parses positional arguments as an initial prompt", () => {
  const parsed = parseLaunchArgs(["--profile", "review", "explain", "this", "repo"]);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.profile, "review");
  assert.equal(parsed.value.initialPrompt, "explain this repo");
  assert.deepEqual(parsed.value.passthroughArgs, ["--profile", "review"]);
});

test("parses arguments after -- as an initial prompt", () => {
  const parsed = parseLaunchArgs(["--", "--help", "as", "text"]);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.value.help, false);
  assert.equal(parsed.value.initialPrompt, "--help as text");
  assert.deepEqual(parsed.value.passthroughArgs, []);
});
