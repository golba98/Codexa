import { MAX_CHAT_LINES } from "../config/settings.js";
import type { AvailableBackend } from "../config/settings.js";
import type { ResolvedRuntimeConfig } from "../config/runtimeConfig.js";
import type { BackendProgressUpdate } from "../core/providers/types.js";
import { summarizeRunActivity, type RunFileActivity } from "../core/workspaceActivity.js";
import type { RunEvent, RunProgressBlock, RunProgressEntry, RunToolActivity, TimelineEvent, UIState } from "./types.js";

export const RUN_OUTPUT_TRUNCATION_NOTICE = "Older output was truncated to keep the UI responsive.";
const ACTION_REQUIRED_BLOCK_PATTERN = /\*{0,2}=+\*{0,2}\s*\n\*{0,2}\[ACTION REQUIRED\]\*{0,2}\s*\n\*{0,2}Verification Question:\*{0,2}\s*\n([\s\S]*?)\n\*{0,2}=+\*{0,2}/i;

export type ConfigMutationKind = "backend" | "model" | "mode" | "reasoning" | "permissions" | "theme";
export type UIStateAction =
  | { type: "PROMPT_RUN_STARTED"; turnId: number }
  | { type: "FIRST_ASSISTANT_DELTA"; turnId: number }
  | { type: "RUN_COMPLETED"; turnId: number }
  | { type: "RUN_FAILED"; turnId: number; message: string }
  | { type: "RUN_CANCELED"; turnId: number }
  | { type: "AWAITING_USER_ACTION"; turnId: number; question: string }
  | { type: "DISMISS_TRANSIENT" }
  | { type: "SHELL_STARTED"; shellId: number }
  | { type: "SHELL_FINISHED"; shellId: number };

const BUSY_NOTICE_BY_KIND: Record<ConfigMutationKind, string> = {
  backend: "Finish the current run before changing the backend.",
  model: "Finish the current run before changing the model.",
  mode: "Finish the current run before changing the mode.",
  reasoning: "Finish the current run before changing the reasoning level.",
  permissions: "Finish the current run before changing permissions.",
  theme: "Finish the current run before changing the theme.",
};

// ─── Agent question detection ─────────────────────────────────────────────────
// Called on the final response text after a run completes.
// Returns the question string if detected, null otherwise.
//
// Detection order:
//   1. Explicit marker  [QUESTION]: <text>
//
// Ordinary assistant prose must never enter blocking-question mode just because it
// ends with a question mark. Only explicit hard-block markers should do that.

export function detectAgentQuestion(text: string): string | null {
  const explicit = text.match(/\[QUESTION\]:\s*(.+)/);
  if (explicit) return explicit[1]!.trim();

  return null;
}

function stripBoldMarkers(text: string): string {
  return text.replace(/\*\*/g, "").trim();
}

export function extractAssistantActionRequired(text: string): { content: string; question: string | null } {
  const normalized = text ?? "";
  const blockMatch = ACTION_REQUIRED_BLOCK_PATTERN.exec(normalized);

  if (blockMatch) {
    const question = stripBoldMarkers(blockMatch[1] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    const content = normalized.replace(blockMatch[0], "").trim();
    return {
      content,
      question: question || null,
    };
  }

  return {
    content: normalized,
    question: detectAgentQuestion(normalized),
  };
}

export function buildFollowUpPrompt(params: {
  originalPrompt: string;
  assistantQuestion: string;
  userAnswer: string;
}): string {
  return [
    "You are continuing an earlier task after pausing for one genuinely blocking clarification.",
    "",
    "Original task:",
    params.originalPrompt,
    "",
    "Your blocking question:",
    params.assistantQuestion,
    "",
    "User answer:",
    params.userAnswer,
    "",
    "Continue the task using that answer.",
    "Default to best-effort continuation instead of stopping for clarification.",
    "If another detail is missing but non-critical, make the most reasonable assumption and state it briefly.",
    "Only ask another blocking question if proceeding would likely use the wrong file, wrong command, destructive behavior, or produce fundamentally incorrect output.",
    "If you are still truly blocked on one critical missing fact, end the response with exactly one [QUESTION]: line.",
  ].join("\n");
}

export function reduceUIState(state: UIState, action: UIStateAction): UIState {
  switch (action.type) {
    case "PROMPT_RUN_STARTED":
      return { kind: "THINKING", turnId: action.turnId };
    case "FIRST_ASSISTANT_DELTA":
      if (state.kind === "THINKING" && state.turnId === action.turnId) {
        return { kind: "RESPONDING", turnId: action.turnId };
      }
      return state;
    case "RUN_COMPLETED":
      if (
        (state.kind === "THINKING" || state.kind === "RESPONDING" || state.kind === "ERROR")
        && state.turnId === action.turnId
      ) {
        return { kind: "IDLE" };
      }
      return state;
    case "RUN_FAILED":
      return { kind: "ERROR", turnId: action.turnId, message: action.message };
    case "RUN_CANCELED":
      if (
        (state.kind === "THINKING" || state.kind === "RESPONDING" || state.kind === "ERROR" || state.kind === "AWAITING_USER_ACTION")
        && state.turnId === action.turnId
      ) {
        return { kind: "IDLE" };
      }
      return state;
    case "AWAITING_USER_ACTION":
      return { kind: "AWAITING_USER_ACTION", turnId: action.turnId, question: action.question };
    case "DISMISS_TRANSIENT":
      if (state.kind === "ERROR" || state.kind === "AWAITING_USER_ACTION") {
        return { kind: "IDLE" };
      }
      return state;
    case "SHELL_STARTED":
      return { kind: "SHELL_RUNNING", shellId: action.shellId };
    case "SHELL_FINISHED":
      if (state.kind === "SHELL_RUNNING" && state.shellId === action.shellId) {
        return { kind: "IDLE" };
      }
      return state;
    default:
      return state;
  }
}

export function createRunEvent(params: {
  id: number;
  backendId: AvailableBackend;
  backendLabel: string;
  runtime: ResolvedRuntimeConfig;
  prompt: string;
  turnId: number;
}): RunEvent {
  const now = Date.now();
  return {
    id: params.id,
    type: "run",
    createdAt: now,
    startedAt: now,
    durationMs: null,
    backendId: params.backendId,
    backendLabel: params.backendLabel,
    runtime: params.runtime,
    prompt: params.prompt,
    progressEntries: [],
    status: "running",
    summary: "starting...",
    truncatedOutput: false,
    toolActivities: [],
    activity: [],
    touchedFileCount: 0,
    errorMessage: null,
    turnId: params.turnId,
  };
}

export function upsertRunToolActivity(event: RunEvent, activity: RunToolActivity): RunEvent {
  const existingIndex = event.toolActivities.findIndex((item) => item.id === activity.id);
  if (existingIndex < 0) {
    return {
      ...event,
      toolActivities: [...event.toolActivities, activity],
    };
  }

  const nextToolActivities = [...event.toolActivities];
  nextToolActivities[existingIndex] = { ...nextToolActivities[existingIndex]!, ...activity };
  return {
    ...event,
    toolActivities: nextToolActivities,
  };
}

function finalizePendingToolActivities(
  toolActivities: RunToolActivity[],
  finalStatus: "completed" | "failed" | "canceled",
): RunToolActivity[] {
  const fallbackStatus = finalStatus === "completed" ? "completed" : "failed";
  const fallbackSummary = finalStatus === "completed"
    ? "Completed"
    : finalStatus === "canceled"
      ? "Canceled"
      : "Failed";

  return toolActivities.map((item) => (
    item.status === "running"
      ? {
        ...item,
        status: fallbackStatus,
        completedAt: item.completedAt ?? Date.now(),
        summary: item.summary ?? fallbackSummary,
      }
      : item
  ));
}

function mergeRunActivity(existing: RunFileActivity[], additions: RunFileActivity[]): RunFileActivity[] {
  const merged = [...existing];

  for (const item of additions) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.path === item.path &&
      last.operation === item.operation &&
      item.operation === "modified"
    ) {
      merged[merged.length - 1] = item;
      continue;
    }

    merged.push(item);
  }

  return merged;
}

export function appendRunActivity(event: RunEvent, additions: RunFileActivity[]): RunEvent {
  if (additions.length === 0) return event;

  const activity = mergeRunActivity(event.activity, additions);
  const touchedFileCount = new Set(activity.map((item) => item.path)).size;

  return {
    ...event,
    activity,
    touchedFileCount,
    activitySummary: summarizeRunActivity(activity),
    summary: touchedFileCount > 0
      ? `${touchedFileCount} file${touchedFileCount === 1 ? "" : "s"} modified`
      : "working...",
  };
}

function trimProgressText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n");
}

function createProgressBlock(entryId: string, sequence: number, createdAt: number): RunProgressBlock {
  return {
    id: `${entryId}-block-${sequence}`,
    text: "",
    sequence,
    createdAt,
    updatedAt: createdAt,
    status: "active",
  };
}

function hasCommittedBlockText(blocks: RunProgressBlock[]): boolean {
  return blocks.some((block) => block.text.length > 0);
}

function appendDeltaToProgressEntry(
  entry: RunProgressEntry,
  delta: string,
  updatedAt: number,
): Pick<RunProgressEntry, "blocks" | "pendingNewlineCount"> {
  let blocks = entry.blocks.slice();
  let pendingNewlineCount = entry.pendingNewlineCount;

  const ensureActiveBlock = (): number => {
    const last = blocks[blocks.length - 1];
    if (last?.status === "active") {
      return blocks.length - 1;
    }

    const nextSequence = last?.sequence ?? 0;
    blocks.push(createProgressBlock(entry.id, nextSequence + 1, updatedAt));
    return blocks.length - 1;
  };

  const updateBlock = (index: number, updater: (block: RunProgressBlock) => RunProgressBlock) => {
    blocks[index] = updater(blocks[index]!);
  };

  for (const char of delta) {
    if (char === "\n") {
      pendingNewlineCount += 1;
      continue;
    }

    if (pendingNewlineCount >= 2) {
      const last = blocks[blocks.length - 1];
      if (last?.status === "active") {
        updateBlock(blocks.length - 1, (block) => ({ ...block, status: "completed", updatedAt }));
      }
    } else if (pendingNewlineCount === 1 && hasCommittedBlockText(blocks)) {
      const activeIndex = ensureActiveBlock();
      updateBlock(activeIndex, (block) => ({
        ...block,
        text: `${block.text}\n`,
        updatedAt,
      }));
    }

    pendingNewlineCount = 0;
    const activeIndex = ensureActiveBlock();
    updateBlock(activeIndex, (block) => ({
      ...block,
      text: `${block.text}${char}`,
      updatedAt,
    }));
  }

  if (pendingNewlineCount >= 2) {
    const last = blocks[blocks.length - 1];
    if (last?.status === "active") {
      updateBlock(blocks.length - 1, (block) => ({ ...block, status: "completed", updatedAt }));
    }
  }

  return { blocks, pendingNewlineCount };
}

function materializeProgressEntry(
  entry: RunProgressEntry,
  nextText: string,
  updatedAt: number,
  source: BackendProgressUpdate["source"],
): RunProgressEntry {
  if (nextText === entry.text) {
    return {
      ...entry,
      source,
      updatedAt,
    };
  }

  if (nextText.startsWith(entry.text)) {
    const delta = nextText.slice(entry.text.length);
    const next = appendDeltaToProgressEntry(entry, delta, updatedAt);
    return {
      ...entry,
      source,
      text: nextText,
      updatedAt,
      blocks: next.blocks,
      pendingNewlineCount: next.pendingNewlineCount,
    };
  }

  const rebuiltSeed: RunProgressEntry = {
    ...entry,
    source,
    text: "",
    updatedAt,
    blocks: [],
    pendingNewlineCount: 0,
  };
  const rebuilt = appendDeltaToProgressEntry(rebuiltSeed, nextText, updatedAt);

  const blocks = rebuilt.blocks.map((block, index) => {
    const existing = entry.blocks[index];
    if (
      existing
      && existing.sequence === block.sequence
      && existing.text === block.text
      && existing.status === block.status
    ) {
      return existing;
    }

    return {
      ...block,
      id: existing?.id ?? block.id,
      createdAt: existing?.createdAt ?? block.createdAt,
    };
  });

  return {
    ...entry,
    source,
    text: nextText,
    updatedAt,
    blocks,
    pendingNewlineCount: rebuilt.pendingNewlineCount,
  };
}

export function appendRunThinking(event: RunEvent, updates: BackendProgressUpdate[]): RunEvent {
  if (updates.length === 0) return event;

  let nextSequence = event.progressEntries[event.progressEntries.length - 1]?.sequence ?? 0;
  let progressEntries = [...event.progressEntries];
  let truncatedOutput = event.truncatedOutput;

  for (const update of updates) {
    const text = trimProgressText(update.text ?? "");
    if (!text.trim()) continue;
    const updatedAt = Date.now();

    const existingIndex = progressEntries.findIndex((entry) => entry.id === update.id);
    if (existingIndex >= 0) {
      const existing = progressEntries[existingIndex]!;
      progressEntries[existingIndex] = materializeProgressEntry(existing, text, updatedAt, update.source);
      continue;
    }

    nextSequence += 1;
    const createdAt = updatedAt;
    const seed: RunProgressEntry = {
      id: update.id,
      source: update.source,
      sequence: nextSequence,
      createdAt,
      updatedAt,
      text: "",
      blocks: [],
      pendingNewlineCount: 0,
    };
    progressEntries.push(materializeProgressEntry(seed, text, updatedAt, update.source));
  }

  if (progressEntries.length > MAX_CHAT_LINES) {
    progressEntries = progressEntries.slice(-MAX_CHAT_LINES);
    truncatedOutput = true;
  }

  return {
    ...event,
    progressEntries,
    truncatedOutput,
    summary: "processing...",
  };
}

export const appendRunOutput = appendRunThinking;

export function completeRunEvent(event: RunEvent): RunEvent {
  const touchedSuffix = event.touchedFileCount > 0
    ? ` · ${event.touchedFileCount} file${event.touchedFileCount === 1 ? "" : "s"} touched`
    : "";

  return {
    ...event,
    status: "completed",
    durationMs: Date.now() - event.startedAt,
    activitySummary: summarizeRunActivity(event.activity),
    toolActivities: finalizePendingToolActivities(event.toolActivities, "completed"),
    errorMessage: null,
    summary: event.progressEntries.length > 0 || event.activity.length > 0
      ? `Run completed successfully${touchedSuffix}`
      : "Run completed with no visible output",
  };
}

export function failRunEvent(event: RunEvent, summary = "Run failed", errorMessage?: string): RunEvent {
  return {
    ...event,
    status: "failed",
    durationMs: Date.now() - event.startedAt,
    activitySummary: summarizeRunActivity(event.activity),
    toolActivities: finalizePendingToolActivities(event.toolActivities, "failed"),
    errorMessage: errorMessage ?? summary,
    summary: event.touchedFileCount > 0
      ? `${summary} · ${event.touchedFileCount} file${event.touchedFileCount === 1 ? "" : "s"} touched`
      : summary,
  };
}

export function cancelRunEvent(event: RunEvent): RunEvent {
  return {
    ...event,
    status: "canceled",
    durationMs: Date.now() - event.startedAt,
    activitySummary: summarizeRunActivity(event.activity),
    toolActivities: finalizePendingToolActivities(event.toolActivities, "canceled"),
    errorMessage: null,
    summary: event.touchedFileCount > 0
      ? `Run canceled · ${event.touchedFileCount} file${event.touchedFileCount === 1 ? "" : "s"} touched`
      : "Run canceled",
  };
}

export function appendStaticEvents(events: TimelineEvent[], additions: TimelineEvent[]): TimelineEvent[] {
  return [...events, ...additions];
}

export function trimStaticEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events;
}

export function guardConfigMutation(kind: ConfigMutationKind, busy: boolean): { allowed: boolean; message?: string } {
  if (!busy) return { allowed: true };
  return { allowed: false, message: BUSY_NOTICE_BY_KIND[kind] };
}

export function isCurrentRun(activeRunId: number | null, runId: number): boolean {
  return activeRunId === runId;
}
