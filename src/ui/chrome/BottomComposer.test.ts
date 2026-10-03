import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Box, render, renderToString } from "ink";
import React from "react";
import type {
  PendingModelSpec,
  VerifiedModelSpec,
} from "../../core/providerRuntime/contextMetadata.js";
import {
  createInputRowWindow,
  createInputViewport,
  getComposerRowLayout,
} from "../input/inputBuffer.js";
import { createAtomicContentToken } from "../input/pastedContent.js";
import { getSlashCommandSuggestions } from "../input/slashCommands.js";
import { createLayoutSnapshot, getContentWidth } from "../layout.js";
import { getTextWidth } from "../render/textLayout.js";
import {
  areBottomComposerPropsEqual,
  BottomComposer,
  type BottomComposerProps,
  getCommandSuggestionState,
  getComposerPersona,
  getComposerToFooterGapRows,
  getTokenBarDisplay,
  getVisibleComposerStatusLine,
  measureBottomComposerRows,
} from "./BottomComposer.js";

test("maps the idle state to the idle composer persona", () => {
  assert.equal(getComposerPersona({ kind: "IDLE" }), "idle");
});

test("maps busy, answer, and error states to the right personas", () => {
  assert.equal(getComposerPersona({ kind: "THINKING", turnId: 1 }), "busy");
  assert.equal(getComposerPersona({ kind: "RESPONDING", turnId: 1 }), "busy");
  assert.equal(getComposerPersona({ kind: "SHELL_RUNNING", shellId: 7 }), "busy");
  assert.equal(
    getComposerPersona({ kind: "AWAITING_USER_ACTION", turnId: 2, question: "Need Redis?" }),
    "answer",
  );
  assert.equal(getComposerPersona({ kind: "ERROR", turnId: 3, message: "Boom" }), "error");
});

test("measures compact idle bottom chrome as metadata plus prompt border", () => {
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

  assert.equal(rows, 4);
});

test("keeps runtime footer directly attached to the composer", () => {
  assert.equal(getComposerToFooterGapRows(createLayoutSnapshot(120, 30)), 0);
  assert.equal(getComposerToFooterGapRows(createLayoutSnapshot(100, 24)), 0);
  assert.equal(getComposerToFooterGapRows(createLayoutSnapshot(39, 30)), 0);
});

test("keeps the composer status row visible in normal 24-row terminals", () => {
  const rows = measureBottomComposerRows({
    layout: createLayoutSnapshot(80, 24),
    uiState: { kind: "THINKING", turnId: 1 },
    value: "",
    cursor: 0,
  });

  assert.equal(rows, 5);
});

test("does not render an exact slash command draft as a suggestion row", () => {
  const exact = getCommandSuggestionState({
    value: "/clear",
    allowCommands: true,
    inputLocked: false,
  });

  assert.equal(exact.showSuggestions, true);
  assert.equal(exact.reserveSuggestionRow, true);
  assert.deepEqual(
    exact.suggestions.map((suggestion) => suggestion.cmd),
    [],
  );
});

test("keeps partial slash command suggestions visible", () => {
  const partial = getCommandSuggestionState({
    value: "/clea",
    allowCommands: true,
    inputLocked: false,
  });

  assert.equal(partial.showSuggestions, true);
  assert.equal(partial.reserveSuggestionRow, true);
  assert.deepEqual(
    partial.suggestions.map((suggestion) => suggestion.cmd),
    ["/clear"],
  );
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

  assert.ok(
    shortProviderSuggestions.suggestions.map((suggestion) => suggestion.cmd).includes("/providers"),
  );

  const prefixProviderSuggestions = getCommandSuggestionState({
    value: "/pr",
    allowCommands: true,
    inputLocked: false,
  });

  assert.ok(
    prefixProviderSuggestions.suggestions
      .map((suggestion) => suggestion.cmd)
      .includes("/providers"),
  );

  const providerSuggestions = getCommandSuggestionState({
    value: "/provider",
    allowCommands: true,
    inputLocked: false,
  });

  assert.equal(providerSuggestions.showSuggestions, true);
  assert.deepEqual(
    providerSuggestions.suggestions.map((suggestion) => suggestion.cmd),
    ["/providers"],
  );

  const exactProviderSuggestions = getCommandSuggestionState({
    value: "/providers",
    allowCommands: true,
    inputLocked: false,
  });

  assert.equal(exactProviderSuggestions.showSuggestions, true);
  assert.deepEqual(
    exactProviderSuggestions.suggestions.map((suggestion) => suggestion.cmd),
    ["/providers"],
  );

  const aliasMetadata = getSlashCommandSuggestions("/provider").find(
    (suggestion) => suggestion.cmd === "/providers",
  );
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
    "✧ Ubume response complete",
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
    "✧ Ubume is working",
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

test("shows Gemini is working status when RESPONDING with google provider", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "RESPONDING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
    }),
    "✧ Gemini is working",
  );
});

test("shows Claude is working status when RESPONDING with anthropic provider", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "RESPONDING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "anthropic",
    }),
    "✧ Claude is working",
  );
});

test("shows Codex is working status when RESPONDING with openai provider", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "RESPONDING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "openai",
    }),
    "✧ Codex is working",
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
    "✧ Ubume is working",
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
  assert.equal(display.usedText, "Context");
  assert.equal(display.limitText, "Unknown");
  assert.equal(display.isEstimatedLimit, false);
  assert.equal(display.hasKnownLimit, false);
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
  assert.equal(display.hasKnownLimit, true);
  assert.equal(
    display.usedText,
    "10,000",
    "usedText should be exact number with thousands separator",
  );
});

test("getTokenBarDisplay formats refreshed LM Studio context meter", () => {
  const spec: VerifiedModelSpec = {
    status: "verified",
    contextWindow: 32_000,
    maxOutputTokens: 32_000,
    sourceUrl: "lmstudio-api",
    verifiedAt: 0,
  };
  const display = getTokenBarDisplay(0, spec);
  assert.equal(display.usedText, "0");
  assert.equal(display.limitText, "32,000");
  assert.equal(display.percentage, 0);
  assert.equal(display.hasKnownLimit, true);
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

// ─── externalCliStatus: provider readiness gate ───────────────────────────────

test("shows 'Ubume is working' (not startup message) when provider is ready and THINKING — google", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 2 },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
      runElapsedSeconds: 0,
      externalCliStatus: "ready",
    }),
    "✧ Gemini is working",
  );
});

test("shows 'Ubume is working' even at 20 seconds elapsed when provider is ready — google", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 2 },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
      runElapsedSeconds: 20,
      externalCliStatus: "ready",
    }),
    "✧ Gemini is working",
  );
});

test("shows 'Ubume is working' (not startup message) when provider is ready and THINKING — anthropic", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 2 },
      value: "",
      allowCommands: true,
      activeProviderId: "anthropic",
      runElapsedSeconds: 0,
      externalCliStatus: "ready",
    }),
    "✧ Claude is working",
  );
});

test("shows 'Ubume is working' (not startup message) when provider is ready and THINKING — openai", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 2 },
      value: "",
      allowCommands: true,
      activeProviderId: "openai",
      runElapsedSeconds: 0,
      externalCliStatus: "ready",
    }),
    "✧ Codex is working",
  );
});

test("still shows startup messages when externalCliStatus is 'starting' — google at 0 seconds", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
      runElapsedSeconds: 0,
      externalCliStatus: "starting",
    }),
    "Starting Gemini CLI",
  );
});

test("still shows 'Still waiting' when externalCliStatus is 'starting' at 15 seconds — google", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
      runElapsedSeconds: 15,
      externalCliStatus: "starting",
    }),
    "Still waiting for Gemini CLI  00:15",
  );
});

test("still shows startup messages when externalCliStatus is 'idle' (first prompt, not yet starting)", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "THINKING", turnId: 1 },
      value: "",
      allowCommands: true,
      activeProviderId: "google",
      runElapsedSeconds: 0,
      externalCliStatus: "idle",
    }),
    "Starting Gemini CLI",
  );
});

test("regression: second prompt with ready provider never shows 'Still waiting for Gemini CLI'", () => {
  const statusLine = getVisibleComposerStatusLine({
    uiState: { kind: "THINKING", turnId: 2 },
    value: "",
    allowCommands: true,
    activeProviderId: "google",
    runElapsedSeconds: 20,
    externalCliStatus: "ready",
  });
  assert.ok(
    !/Still waiting for Gemini CLI|Starting Gemini CLI|Checking Gemini/i.test(statusLine),
    `Expected no startup text but got: "${statusLine}"`,
  );
});

// ─── getTokenBarDisplay — new format ─────────────────────────────────────────

test("getTokenBarDisplay(0, 64k spec) shows '0' usedText and '64,000' limitText, not Unknown", () => {
  const spec: VerifiedModelSpec = {
    status: "verified",
    contextWindow: 64_000,
    maxOutputTokens: 64_000,
    sourceUrl: "",
    verifiedAt: 0,
  };
  const display = getTokenBarDisplay(0, spec);
  assert.equal(display.hasKnownLimit, true, "64k verified spec must have known limit");
  assert.equal(display.usedText, "0", "0 tokens used renders as '0'");
  assert.equal(display.limitText, "64,000");
  assert.equal(display.percentage, 0);
});

test("getTokenBarDisplay uses Math.floor — 1999/200000 rounds down to 0%", () => {
  const spec: VerifiedModelSpec = {
    status: "verified",
    contextWindow: 200_000,
    maxOutputTokens: 200_000,
    sourceUrl: "",
    verifiedAt: 0,
  };
  const display = getTokenBarDisplay(1_999, spec);
  // floor(1999/200000*100) = floor(0.9995) = 0; Math.round would give 1
  assert.equal(display.percentage, 0, "percentage must use Math.floor, not Math.round");
});

test("getTokenBarDisplay unknown spec regression — hasKnownLimit is false", () => {
  const spec: PendingModelSpec = {
    status: "unknown",
    contextWindow: null,
    maxOutputTokens: null,
    sourceUrl: "",
    verifiedAt: null,
    error: null,
  };
  assert.equal(getTokenBarDisplay(99_999, spec).hasKnownLimit, false);
});

// ─── getTokenBarDisplay — estimated specs ─────────────────────────────────────

test("getTokenBarDisplay with isEstimated spec returns limitText with ~ prefix and compact format", () => {
  const spec: VerifiedModelSpec = {
    status: "verified",
    contextWindow: 400_000,
    maxOutputTokens: 400_000,
    sourceUrl: "known-registry",
    verifiedAt: 0,
    isEstimated: true,
  };
  const display = getTokenBarDisplay(0, spec);
  assert.equal(display.limitText, "~400K");
  assert.equal(display.isEstimatedLimit, true);
  assert.equal(display.hasKnownLimit, true);
});

test("getTokenBarDisplay with isEstimated spec still has correct percentage", () => {
  const spec: VerifiedModelSpec = {
    status: "verified",
    contextWindow: 400_000,
    maxOutputTokens: 400_000,
    sourceUrl: "known-registry",
    verifiedAt: 0,
    isEstimated: true,
  };
  const display = getTokenBarDisplay(40_000, spec);
  assert.equal(display.percentage, 10);
  assert.equal(display.hasKnownLimit, true);
});

test("getTokenBarDisplay with isEstimated uses compact M suffix for 1M context", () => {
  const spec: VerifiedModelSpec = {
    status: "verified",
    contextWindow: 1_048_576,
    maxOutputTokens: 1_048_576,
    sourceUrl: "known-registry",
    verifiedAt: 0,
    isEstimated: true,
  };
  const display = getTokenBarDisplay(0, spec);
  assert.equal(display.limitText, "~1.0M");
  assert.equal(display.isEstimatedLimit, true);
});

test("getTokenBarDisplay with isEstimated: false uses comma format (regression guard)", () => {
  const spec: VerifiedModelSpec = {
    status: "verified",
    contextWindow: 400_000,
    maxOutputTokens: 400_000,
    sourceUrl: "",
    verifiedAt: 0,
    isEstimated: false,
  };
  const display = getTokenBarDisplay(0, spec);
  assert.equal(display.limitText, "400,000");
  assert.equal(display.isEstimatedLimit, false);
});

test("keeps the working row alongside command suggestions during a run", () => {
  const layout = createLayoutSnapshot(100, 30);
  const busy = { kind: "THINKING", turnId: 1 } as const;
  const plainDraft = measureBottomComposerRows({
    layout,
    uiState: busy,
    value: "hello",
    cursor: 5,
  });
  const commandDraft = measureBottomComposerRows({
    layout,
    uiState: busy,
    value: "/model",
    cursor: 6,
  });

  assert.equal(
    getVisibleComposerStatusLine({ uiState: busy, value: "/model", allowCommands: true }),
    "✧ Ubume is working",
  );
  assert.equal(commandDraft, plainDraft + 1);
});

function composerProps(overrides: Partial<BottomComposerProps> = {}): BottomComposerProps {
  const noop = () => undefined;
  return {
    layout: createLayoutSnapshot(100, 30),
    uiState: { kind: "THINKING", turnId: 1 },
    value: "",
    cursor: 0,
    onChangeInput: noop,
    onSubmit: noop,
    onCancel: noop,
    onChangeValue: noop,
    onChangeCursor: noop,
    onHistoryUp: noop,
    onHistoryDown: noop,
    onOpenBackendPicker: noop,
    onOpenModelPicker: noop,
    onOpenModePicker: noop,
    onOpenThemePicker: noop,
    onOpenAuthPanel: noop,
    onTogglePlanMode: noop,
    onClear: noop,
    onCycleMode: noop,
    onQuit: noop,
    activeProviderId: "openai",
    externalCliStatus: "starting",
    ...overrides,
  };
}

test("memoized composer re-renders when a busy run moves from THINKING to RESPONDING", () => {
  const prev = composerProps();
  const next = composerProps({ layout: prev.layout, uiState: { kind: "RESPONDING", turnId: 1 } });
  assert.equal(areBottomComposerPropsEqual(prev, next), false);
});

test("memoized composer re-renders when the provider CLI becomes ready", () => {
  const prev = composerProps();
  const next = composerProps({
    layout: prev.layout,
    uiState: prev.uiState,
    externalCliStatus: "ready",
  });
  assert.equal(areBottomComposerPropsEqual(prev, next), false);
});

test("memoized composer skips re-render for unchanged busy props", () => {
  const prev = composerProps();
  const next = { ...prev, uiState: { kind: "THINKING", turnId: 1 } as const };
  assert.equal(areBottomComposerPropsEqual(prev, next), true);
});

for (const [providerId, label] of [
  ["openai", "Codex CLI"],
  ["anthropic", "Claude Code"],
  ["google", "Gemini CLI"],
] as const) {
  test(`reports ${label} as waiting only until it produces output`, () => {
    const uiState = { kind: "THINKING", turnId: 1 } as const;
    const base = {
      uiState,
      value: "",
      allowCommands: true,
      activeProviderId: providerId,
      runElapsedSeconds: 30,
    };
    assert.equal(
      getVisibleComposerStatusLine({ ...base, externalCliStatus: "starting" }),
      `Still waiting for ${label}  00:30`,
    );
    assert.equal(
      getVisibleComposerStatusLine({ ...base, externalCliStatus: "ready" }),
      `✧ ${providerId === "openai" ? "Codex" : providerId === "anthropic" ? "Claude" : "Gemini"} is working`,
    );
  });
}

test("stopping status stays truthful while a command draft is present", () => {
  assert.equal(
    getVisibleComposerStatusLine({
      uiState: { kind: "IDLE" },
      value: "/model",
      allowCommands: true,
      stopping: true,
    }),
    "✧ Stopping · Ctrl+C again to exit",
  );
});

test("memoized composer re-renders when its container width changes without a terminal resize", () => {
  const props = composerProps({ width: 120 });
  assert.equal(areBottomComposerPropsEqual(props, { ...props, width: 115 }), false);
});

test("rendered composer rows fit the supplied width including pasted content and cursor", () => {
  const token = createAtomicContentToken("[Pasted Content 22,703 chars]");
  const layout = createLayoutSnapshot(120, 24);
  for (const width of [20, 40, getContentWidth(layout.cols), layout.cols]) {
    const editorWidth = getComposerRowLayout(width).editorWidth;
    const cases = [
      "",
      "hello",
      token + " short",
      token + " " + "abcdefghij".repeat(20),
      "x".repeat(editorWidth),
      "字".repeat(editorWidth),
      "e\u0301👩‍💻字".repeat(10),
    ];
    for (const value of cases) {
      for (const cursor of [0, Math.floor(value.length / 2), value.length]) {
        const props = composerProps({ layout, width, uiState: { kind: "IDLE" }, value, cursor });
        const frame = renderToString(
          React.createElement(Box, { width }, React.createElement(BottomComposer, props)),
          { columns: layout.cols },
        );
        const plain = frame.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
        const lines = plain.split("\n");
        const top = lines.findIndex((line) => line.startsWith("╭"));
        const bottom = lines.findIndex((line, index) => index > top && line.startsWith("╰"));
        assert.ok(top >= 0 && bottom > top);
        for (const line of lines.slice(top, bottom + 1)) {
          assert.equal(getTextWidth(line), width, JSON.stringify({ width, value, cursor, line }));
          assert.ok(/[│╮╯]$/.test(line), `right boundary missing: ${line}`);
        }
        assert.equal(lines[top + 1]!.startsWith("│ ❯ "), true);
        assert.equal(
          bottom - top + 1 + 1,
          measureBottomComposerRows(props),
          "measurement must match prompt and metadata rows",
        );
        if (value) {
          const viewport = createInputViewport({
            text: value,
            cursorOffset: cursor,
            width: editorWidth,
            maxVisibleRows: 5,
          });
          const rowIndex = viewport.cursorRow - viewport.scrollRow;
          const row = viewport.visibleRows[rowIndex]!;
          const window = createInputRowWindow(row.text, editorWidth, viewport.cursorColumn);
          const expected = (
            (rowIndex === 0 ? "│ ❯ " : "│   ") +
            window.before +
            window.current +
            window.after
          ).replace(/[\u2063\uFE00-\uFE09]/g, "");
          assert.ok(
            lines[top + 1 + rowIndex]!.startsWith(expected),
            JSON.stringify({ expected, actual: lines[top + 1 + rowIndex] }),
          );
        }
      }
    }
  }
});

test("focused input retains pasted tokens, typed text and submission through terminal resize", async () => {
  class Input extends PassThrough {
    isTTY = true;
    setRawMode() {
      return this;
    }
    ref() {
      return this;
    }
    unref() {
      return this;
    }
  }
  class Output extends PassThrough {
    isTTY = true;
    columns = 120;
    rows = 24;
  }
  const stdin = new Input();
  const stdout = new Output();
  let output = "";
  stdout.on("data", (chunk) => {
    output += chunk.toString() + "\n";
  });
  const token = createAtomicContentToken("[Pasted Content 22,703 chars]");
  let draft = token + " ";
  let submitted = "";
  function Editor({ width }: { width: number }) {
    const [value, setValue] = React.useState(draft);
    const [cursor, setCursor] = React.useState(draft.length);
    return React.createElement(
      BottomComposer,
      composerProps({
        layout: createLayoutSnapshot(stdout.columns, stdout.rows),
        width,
        uiState: { kind: "IDLE" },
        value,
        cursor,
        onChangeInput: (nextValue, nextCursor) => {
          draft = nextValue;
          setValue(nextValue);
          setCursor(nextCursor);
        },
        onSubmit: () => {
          submitted = value;
        },
      }),
    );
  }
  const instance = render(React.createElement(Editor, { width: stdout.columns }), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  try {
    await instance.waitUntilRenderFlush();
    for (const columns of [120, 40, 20, 80, 120]) {
      output = "";
      stdout.columns = columns;
      stdout.emit("resize");
      instance.rerender(React.createElement(Editor, { width: columns }));
      await instance.waitUntilRenderFlush();
      stdin.write("xyz");
      await new Promise((resolve) => setTimeout(resolve, 80));
      await instance.waitUntilRenderFlush();
      const plain = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
      const lines = plain.split("\n");
      const top = lines.findLastIndex((line) => line.startsWith("╭"));
      const bottom = lines.findIndex((line, index) => index > top && line.startsWith("╰"));
      assert.ok(top >= 0 && bottom > top);
      for (const line of lines.slice(top, bottom + 1)) assert.equal(getTextWidth(line), columns);
      assert.ok(
        draft.startsWith(token),
        "display filtering must preserve the token's invisible ID",
      );
      assert.ok(
        lines.slice(top, bottom).some((line) => line.includes("xyz")),
        JSON.stringify({ columns, draft, frame: lines.slice(top, bottom + 1) }),
      );
    }
    assert.equal(draft, token + " " + "xyz".repeat(5));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(submitted, draft);
  } finally {
    instance.cleanup();
  }
});
