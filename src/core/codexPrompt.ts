import type { AvailableMode } from "../config/settings.js";

const WRITE_INTENT_PATTERNS = [
  /\b(create|make|build|implement|add|generate|write|scaffold|fix|edit|update|refactor)\b/i,
  /\b(file|files|app|component|script|cli|project|test|tests|bug|feature)\b/i,
  /\b(py|python|ts|tsx|js|jsx|json|md|html|css|sql|yaml|yml|toml)\b/i,
];

export interface ExecutionModeDecision {
  mode: AvailableMode;
  autoUpgraded: boolean;
}

export function promptHasWriteIntent(prompt: string): boolean {
  const normalized = prompt.trim();
  if (!normalized) return false;

  const hits = WRITE_INTENT_PATTERNS.reduce(
    (count, pattern) => (pattern.test(normalized) ? count + 1 : count),
    0,
  );

  return hits >= 2;
}

export function resolveExecutionMode(
  requestedMode: AvailableMode,
  prompt: string,
): ExecutionModeDecision {
  if (requestedMode !== "suggest") {
    return { mode: requestedMode, autoUpgraded: false };
  }

  if (promptHasWriteIntent(prompt)) {
    return { mode: "auto-edit", autoUpgraded: true };
  }

  return { mode: requestedMode, autoUpgraded: false };
}

export function buildCodexPrompt(prompt: string, mode: AvailableMode): string {
  if (mode === "suggest") {
    return [
      "The user request below is the task to handle now.",
      "Do not reply with generic readiness or ask what they want changed if the request is already specific.",
      "You are in read-only mode, so inspect files and answer carefully, but do not claim to have edited files unless you actually could.",
      "Default to best-effort continuation instead of stopping for clarification.",
      "If a detail is missing but non-critical, make the most reasonable assumption and state it briefly.",
      "If multiple paths are possible, choose one sensible path and continue.",
      "Only ask a blocking follow-up question if proceeding would likely use the wrong file, wrong command, destructive behavior, or produce fundamentally incorrect output.",
      "If you are truly blocked on one critical missing fact, end the response with exactly one line in this format: [QUESTION]: <your question>",
      "",
      "Task:",
      prompt,
    ].join("\n");
  }

  const autonomyLine =
    mode === "full-auto"
      ? "Act with strong autonomy: inspect the repo, create or update files directly, and run checks when helpful."
      : "Act like a coding agent: inspect the repo, create or update files directly, and prefer real workspace edits over large pasted code blocks.";

  return [
    "The user request below is the task to handle now.",
    "Do not reply with generic readiness or ask what they want changed if the request is already specific.",
    "If the request is actionable, make the change in the workspace before responding.",
    "You are running inside the user's current workspace with write access.",
    autonomyLine,
    "Default to best-effort continuation instead of stopping for clarification.",
    "If a detail is missing but non-critical, make the most reasonable assumption and state it briefly.",
    "If multiple paths are possible, choose one sensible path and continue.",
    "Only ask a blocking follow-up question if proceeding would likely use the wrong file, wrong command, destructive behavior, or produce fundamentally incorrect output.",
    "If you are truly blocked on one critical missing fact, end the response with exactly one line in this format: [QUESTION]: <your question>",
    "After doing the work, summarize what changed.",
    "",
    "Task:",
    prompt,
  ].join("\n");
}
