import assert from "node:assert/strict";
import test from "node:test";
import {
  getCommandSuggestionState,
  getComposerPersona,
  getTokenBarDisplay,
  getVisibleComposerStatusLine,
  measureBottomComposerRows,
} from "./BottomComposer.js";
import { createLayoutSnapshot } from "./layout.js";
import { getSlashCommandSuggestions } from "./slashCommands.js";
import type { PendingModelSpec, VerifiedModelSpec } from "../core/models/modelSpecs.js";

test("maps the idle state to the idle composer persona", () => {
  assert.equal(getComposerPersona({ kind: "IDLE" }), "idle");
});

test("maps busy, answer, and error states to the right personas", () => {
  assert.equal(getComposerPersona({ kind: "THINKING", turnId: 1 }), "busy");
  assert.equal(getComposerPersona({ kind: "RESPONDING", turnId: 1 }), "busy");
  assert.equal(getComposerPersona({ kind: "SHELL_RUNNING", shellId: 7 }), "busy");
  assert.equal(getComposerPersona({ kind: "AWAITING_USER_ACTION", turnId: 2, question: "Need Redis?" }), "answer");
  assert.equal(getComposerPersona({ kind: "ERROR", turnId: 3, message: "Boom" }), "error");
});

test("measures the standard composer rows from the rendered prompt state", () => {
  const rows = measureBottomComposerRows({
    layout: createLayoutSnapshot(100, 30),
    uiState: { kind: "IDLE" },
    mode: "auto-edit",
    model: "gpt-5.4",
    reasoningLevel: "medium",
    tokensUsed: 1200,
    value: "",
    cursor: 0,
  });

  assert.equal(rows, 6);
});

test("uses the run footer row budget in cramped busy viewports", () => {
  const rows = measureBottomComposerRows({
    layout: createLayoutSnapshot(80, 24),
    uiState: { kind: "THINKING", turnId: 1 },
    value: "",
    cursor: 0,
  });

  assert.equal(rows, 4);
});

test("does not render an exact slash command draft as a suggestion row", () => {
  const exact = getCommandSuggestionState({
    value: "/clear",
    allowCommands: true,
    inputLocked: false,
  });

  assert.equal(exact.showSuggestions, true);
  assert.equal(exact.reserveSuggestionRow, true);
  assert.deepEqual(exact.suggestions.map((suggestion) => suggestion.cmd), []);
});

test("keeps partial slash command suggestions visible", () => {
  const partial = getCommandSuggestionState({
    value: "/clea",
    allowCommands: true,
    inputLocked: false,
  });

  assert.equal(partial.showSuggestions, true);
  assert.equal(partial.reserveSuggestionRow, true);
  assert.deepEqual(partial.suggestions.map((suggestion) => suggestion.cmd), ["/clear"]);
});

test("surfaces the provider picker suggestion for root prefixes and alias input", () => {
  const rootSuggestions = getCommandSuggestionState({
    value: "/",
    allowCommands: true,
    inputLocked: false,
  });

  assert.equal(rootSuggestions.showSuggestions, true);
  assert.ok(rootSuggestions.suggestions.map((suggestion) => suggestion.cmd).includes("/providers"));

  const pSuggestions = getCommandSuggestionState({
    value: "/p",
    allowCommands: true,
    inputLocked: false,
  });

  assert.ok(pSuggestions.suggestions.map((suggestion) => suggestion.cmd).includes("/providers"));

  const shortProviderSuggestions = getCommandSuggestionState({
    value: "/pro",
    allowCommands: true,
    inputLocked: false,
  });

  assert.ok(shortProviderSuggestions.suggestions.map((suggestion) => suggestion.cmd).includes("/providers"));

  const prefixProviderSuggestions = getCommandSuggestionState({
    value: "/pr",
    allowCommands: true,
    inputLocked: false,
  });

  assert.ok(prefixProviderSuggestions.suggestions.map((suggestion) => suggestion.cmd).includes("/providers"));

  const providerSuggestions = getCommandSuggestionState({
    value: "/provider",
    allowCommands: true,
    inputLocked: false,
  });

  assert.equal(providerSuggestions.showSuggestions, true);
  assert.deepEqual(providerSuggestions.suggestions.map((suggestion) => suggestion.cmd), ["/providers"]);

  const exactProviderSuggestions = getCommandSuggestionState({
    value: "/providers",
    allowCommands: true,
    inputLocked: false,
  });

  assert.equal(exactProviderSuggestions.showSuggestions, true);
  assert.deepEqual(exactProviderSuggestions.suggestions.map((suggestion) => suggestion.cmd), ["/providers"]);

  const aliasMetadata = getSlashCommandSuggestions("/provider").find((suggestion) => suggestion.cmd === "/providers");
  assert.deepEqual(aliasMetadata?.aliases, ["/provider"]);
});

test("keeps exact and partial slash command row budgets stable", () => {
  const layout = createLayoutSnapshot(100, 30);
  const base = {
    layout,
    uiState: { kind: "IDLE" } as const,
    value: "",
    cursor: 0,
  };

  const partialRows = measureBottomComposerRows({
    ...base,
    value: "/clea",
    cursor: "/clea".length,
  });
  const exactRows = measureBottomComposerRows({
    ...base,
    value: "/clear",
    cursor: "/clear".length,
  });

  assert.equal(exactRows, partialRows);
});

test("suppresses completed response status while a slash command draft is active", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "ANSWER_VISIBLE", turnId: 1 },
      value: "/clear",
      allowCommands: true,
    }),
    "",
  );

  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "ANSWER_VISIBLE", turnId: 1 },
      value: "next prompt",
      allowCommands: true,
    }),
    "✧ Codexa response complete",
  );
});

test("shows Gemini-specific status when THINKING with google provider at 0 seconds", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
      runElapsedSeconds: 0,
    }),
    "Starting Gemini CLI",
  );
});

test("includes elapsed timer in Gemini status after first second", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
      runElapsedSeconds: 3,
    }),
    "Starting Gemini CLI  00:03",
  );
});

test("shows reassurance message in Gemini status at 5 seconds", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
      runElapsedSeconds: 5,
    }),
    "Gemini CLI is still starting. The upstream CLI can take a moment  00:05",
  );
});

test("shows still waiting message in Gemini status at 15 seconds", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
      runElapsedSeconds: 15,
    }),
    "Still waiting for Gemini CLI  00:15",
  );
});

test("shows generic thinking status for unknown/local provider", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "local",
      runElapsedSeconds: 10,
    }),
    "✧ Codexa is thinking",
  );
});

test("shows Starting Claude Code at 0 seconds for anthropic provider", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "anthropic",
      runElapsedSeconds: 0,
    }),
    "Starting Claude Code",
  );
});

test("includes elapsed timer in Claude Code status after first second", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "anthropic",
      runElapsedSeconds: 3,
    }),
    "Starting Claude Code  00:03",
  );
});

test("shows reassurance message at 5 seconds for Claude Code", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "anthropic",
      runElapsedSeconds: 5,
    }),
    "Claude Code is still starting. The upstream CLI can take a moment  00:05",
  );
});

test("shows still waiting message at 15 seconds for Claude Code", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "anthropic",
      runElapsedSeconds: 15,
    }),
    "Still waiting for Claude Code  00:15",
  );
});

test("shows Starting Codex CLI at 0 seconds for openai provider", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "openai",
      runElapsedSeconds: 0,
    }),
    "Starting Codex CLI",
  );
});

test("includes elapsed timer in Codex CLI status after first second", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "openai",
      runElapsedSeconds: 3,
    }),
    "Starting Codex CLI  00:03",
  );
});

test("shows Gemini ready status when RESPONDING with google provider", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "RESPONDING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
    }),
    "✧ Gemini ready",
  );
});

test("shows Claude ready status when RESPONDING with anthropic provider", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "RESPONDING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "anthropic",
    }),
    "✧ Claude ready",
  );
});

test("shows Codex ready status when RESPONDING with openai provider", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "RESPONDING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "openai",
    }),
    "✧ Codex ready",
  );
});

test("shows generic thinking status when RESPONDING with unknown provider", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "RESPONDING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "local",
    }),
    "✧ Codexa is thinking",
  );
});

test("shows error message in status for google provider in ERROR state regardless of elapsed time", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "ERROR", turnId: 1, message: "Gemini CLI failed to start" },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
      runElapsedSeconds: 30,
    }),
    "Gemini CLI failed to start",
  );
});

test("shows error message in status for anthropic provider in ERROR state regardless of elapsed time", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "ERROR", turnId: 1, message: "Claude Code failed to start" },
      value: "",
      allowCommands: true,
      activeProviderId: "anthropic",
      runElapsedSeconds: 30,
    }),
    "Claude Code failed to start",
  );
});

test("getTokenBarDisplay returns null percentage (not 0) for an unknown spec", () => {
  const spec: PendingModelSpec = {
    status: "unknown",
    contextWindow: null,
    maxOutputTokens: null,
    sourceUrl: "",
    verifiedAt: null,
    error: null,
  };
  const display = getTokenBarDisplay(5_000, spec);
  assert.equal(display.percentage, null, "percentage must be null, not 0, for unknown specs");
  assert.equal(display.limitText, "unknown");
  assert.equal(display.isEstimatedLimit, false);
});

test("getTokenBarDisplay returns correct non-null percentage for a verified spec", () => {
  const spec: VerifiedModelSpec = {
    status: "verified",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    sourceUrl: "",
    verifiedAt: 0,
  };
  const display = getTokenBarDisplay(10_000, spec);
  assert.equal(display.percentage, 5);
  assert.notEqual(display.percentage, null);
  assert.equal(display.isEstimatedLimit, false);
});

test("getTokenBarDisplay marks estimated context windows with ~ prefix in limitText", () => {
  const spec: VerifiedModelSpec = {
    status: "verified",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    contextWindowStatus: "estimated",
    sourceUrl: "",
    verifiedAt: 0,
  };
  const display = getTokenBarDisplay(10_000, spec);
  assert.equal(display.isEstimatedLimit, true);
  assert.ok(display.limitText.startsWith("~"), "estimated limitText must start with ~");
  assert.equal(display.percentage, 1);
});

test("getTokenBarDisplay does not add ~ prefix for a documented verified context window", () => {
  const spec: VerifiedModelSpec = {
    status: "verified",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    sourceUrl: "",
    verifiedAt: 0,
  };
  const display = getTokenBarDisplay(10_000, spec);
  assert.equal(display.isEstimatedLimit, false);
  assert.ok(!display.limitText.startsWith("~"), "verified limitText must not start with ~");
});
