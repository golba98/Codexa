import { basename } from "node:path";
import {
  externalSourceLabel,
  type ExternalSessionSource,
  type ExternalSessionSummary,
} from "../../core/externalSessions/types.js";
import type { ConversationListEntry } from "../../core/workspace/conversationStore.js";

/** Sections of the /resume picker: Ubume's own conversations, then each native CLI. */
export type ResumePickerTab = "ubume" | ExternalSessionSource;
export type ExternalListScope = "workspace" | "all";

export interface ResumePickerPosition {
  tab: ResumePickerTab;
  scope: ExternalListScope;
  selectedId: string | null;
}

export const RESUME_PICKER_TABS: readonly ResumePickerTab[] = ["ubume", "claude", "codex", "antigravity"];

export function resumeTabLabel(tab: ResumePickerTab): string {
  return tab === "ubume" ? "Ubume" : externalSourceLabel(tab);
}

export function nextResumeTab(tab: ResumePickerTab, direction: 1 | -1): ResumePickerTab {
  const index = RESUME_PICKER_TABS.indexOf(tab);
  return RESUME_PICKER_TABS[(index + direction + RESUME_PICKER_TABS.length) % RESUME_PICKER_TABS.length]!;
}

export function activityLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function providerLabel(providerId: string | null): string {
  switch (providerId) {
    case "local": return "Local";
    case "anthropic": return "Anthropic";
    case "google": return "Google";
    case "mistral": return "Mistral";
    case "codexa-native": return "ubume-PyTorch";
    case "codexa-cupy": return "CuPy";
    case "antigravity": return "Antigravity";
    case "openai": return "OpenAI";
    default: return "Unavailable";
  }
}

function importedLabel(source: string): string {
  return source === "claude" || source === "codex" || source === "antigravity" ? externalSourceLabel(source) : source;
}

function displayTitle(title: string): string {
  // Composer attachment IDs are invisible, but Ink renders them as cells.
  // Remove only their paired suffix so existing saved titles stay intact.
  return title.replace(/\u2063[\uFE00-\uFE09]+\u2063/g, "");
}

export function ubumeRowText(conversation: ConversationListEntry, now = new Date()): string {
  const parts = [
    activityLabel(conversation.updatedAt, now),
    conversation.modelId,
    providerLabel(conversation.providerId),
    `${conversation.messageCount} messages`,
    ...(conversation.importedFrom ? [`from ${importedLabel(conversation.importedFrom.source)}`] : []),
  ];
  return `${displayTitle(conversation.title)} — ${parts.join(" · ")}`;
}

export function externalRowText(summary: ExternalSessionSummary, scope: ExternalListScope, now = new Date()): string {
  const parts = [
    activityLabel(summary.updatedAt, now),
    ...(summary.model ? [summary.model] : []),
    ...(scope === "all" && summary.cwd ? [basename(summary.cwd) || summary.cwd] : []),
  ];
  return `${displayTitle(summary.title)} — ${parts.join(" · ")}`;
}

export function matchesQuery(fields: readonly (string | null | undefined)[], query: string): boolean {
  const needle = query.toLowerCase();
  return !needle || fields.some((field) => field?.toLowerCase().includes(needle));
}
