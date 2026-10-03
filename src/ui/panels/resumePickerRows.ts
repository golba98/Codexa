import { basename } from "node:path";
import {
  type ExternalSessionSummary,
  externalSourceLabel,
} from "../../core/externalSessions/types.js";
import type { LocalBackendId } from "../../core/providerLauncher/types.js";
import type { ConversationListEntry } from "../../core/workspace/conversationStore.js";
import type { SessionSummary } from "../../session/sessionCatalog.js";

export type ResumePickerTab =
  | "all"
  | "openai"
  | "anthropic"
  | "mistral"
  | "local"
  | "antigravity"
  | "codexa-native"
  | "codexa-cupy";
export type ExternalListScope = "workspace" | "all";

export interface ResumePickerPosition {
  tab: ResumePickerTab;
  scope: ExternalListScope;
  selectedId: string | null;
  backend?: LocalBackendId | "all";
  model?: string;
  query?: string;
}

export const RESUME_PICKER_TABS: readonly ResumePickerTab[] = [
  "all",
  "openai",
  "anthropic",
  "mistral",
  "local",
  "antigravity",
];

export function resumeTabLabel(tab: ResumePickerTab): string {
  return tab === "all" ? "All" : providerLabel(tab);
}

export function nextResumeTab(
  tab: ResumePickerTab,
  direction: 1 | -1,
  tabs: readonly ResumePickerTab[] = RESUME_PICKER_TABS,
): ResumePickerTab {
  const index = Math.max(0, tabs.indexOf(tab));
  return tabs[(index + direction + tabs.length) % tabs.length]!;
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

function providerLabel(providerId: string | null): string {
  switch (providerId) {
    case "local":
      return "Local";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google";
    case "mistral":
      return "Mistral";
    case "codexa-native":
      return "ubume-PyTorch";
    case "codexa-cupy":
      return "CuPy";
    case "antigravity":
      return "Antigravity";
    case "openai":
      return "OpenAI";
    default:
      return "Unavailable";
  }
}

function importedLabel(source: string): string {
  return source === "claude" || source === "codex" || source === "antigravity" || source === "vibe"
    ? externalSourceLabel(source)
    : source;
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
    ...(conversation.localBackend
      ? [conversation.localBackend === "unsloth" ? "Unsloth" : "LM Studio"]
      : []),
    `${conversation.messageCount} messages`,
    ...(conversation.importedFrom
      ? [`from ${importedLabel(conversation.importedFrom.source)}`]
      : []),
  ];
  return `${displayTitle(conversation.title)} — ${parts.join(" · ")}`;
}

export function externalRowText(
  summary: ExternalSessionSummary,
  scope: ExternalListScope,
  now = new Date(),
): string {
  const parts = [
    activityLabel(summary.updatedAt, now),
    externalSourceLabel(summary.source),
    ...(summary.model ? [summary.model] : []),
    ...(scope === "all" && summary.cwd ? [basename(summary.cwd) || summary.cwd] : []),
  ];
  return `${displayTitle(summary.title)} — ${parts.join(" · ")}`;
}

export function matchesQuery(
  fields: readonly (string | null | undefined)[],
  query: string,
): boolean {
  const needle = query.toLowerCase();
  return !needle || fields.some((field) => field?.toLowerCase().includes(needle));
}

export function sessionRowText(session: SessionSummary, scope: ExternalListScope): string {
  if (session.native) return externalRowText(session.native, scope);
  if (!session.conversation) return session.title;
  const text = ubumeRowText(session.conversation);
  return scope === "all"
    ? `${text} · ${session.workspaceRoot ? basename(session.workspaceRoot) : "Folder unknown"}`
    : text;
}
