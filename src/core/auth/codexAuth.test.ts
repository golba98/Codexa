import assert from "node:assert/strict";
import test from "node:test";
import {
  getRunGateDecision,
  inferAuthStateFromProbe,
  isLikelyAuthFailure,
} from "./codexAuth.js";

test("infers authenticated from successful probe exit", () => {
  const state = inferAuthStateFromProbe(0, "", "");
  assert.equal(state, "authenticated");
});

test("infers unauthenticated from signed-out probe output", () => {
  const state = inferAuthStateFromProbe(
    1,
    "No active session. Please login.",
    "",
  );
  assert.equal(state, "unauthenticated");
});

test("infers unknown from ambiguous probe output", () => {
  const state = inferAuthStateFromProbe(
    2,
    "Usage: codex login status [OPTIONS]",
    "unexpected argument '--json'",
  );
  assert.equal(state, "unknown");
});

test("blocks runs when unauthenticated", () => {
  const decision = getRunGateDecision("unauthenticated");
  assert.equal(decision.allowRun, false);
  assert.match(decision.blockMessage ?? "", /codex login/i);
});

test("warns but allows runs when auth state is unknown", () => {
  const decision = getRunGateDecision("unknown");
  assert.equal(decision.allowRun, true);
  assert.match(decision.warningMessage ?? "", /unknown/i);
});

test("allows runs when authenticated", () => {
  const decision = getRunGateDecision("authenticated");
  assert.equal(decision.allowRun, true);
  assert.equal(decision.warningMessage, undefined);
});

test("detects runtime auth failure messages", () => {
  const detected = isLikelyAuthFailure("Unauthorized (401): token expired. Run codex login.");
  assert.equal(detected, true);
});
