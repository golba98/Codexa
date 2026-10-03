import type { ProviderId } from "../providerLauncher/types.js";
import type { ConversationMessage } from "../workspace/conversationStore.js";
import {
  type ExternalSessionSource,
  type ExternalTranscript,
  externalSourceLabel,
} from "./types.js";

/** Imported history is replayed to the provider on every turn, so keep it bounded. */
const DEFAULT_MAX_CHARS = 200_000;

export function externalProviderId(source: ExternalSessionSource): ProviderId {
  switch (source) {
    case "claude":
      return "anthropic";
    case "codex":
      return "openai";
    case "antigravity":
      return "antigravity";
    case "vibe":
      return "mistral";
  }
}

function toolName(title: string): string {
  return title.split(" · ")[0]?.trim() || "Tool";
}

function formatToolCounts(counts: Map<string, number>): string {
  return `Tools used: ${[...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(", ")}`;
}

/**
 * Converts a native transcript into Ubume conversation messages: prompts and
 * replies become alternating user/assistant messages, tool calls are folded
 * into the reply's activity summary, and command notes are dropped.
 */
export function externalTranscriptToConversationMessages(
  transcript: ExternalTranscript,
  options: { maxChars?: number } = {},
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  let tools = new Map<string, number>();
  const flushTools = () => {
    if (tools.size === 0) return;
    const last = messages.at(-1);
    if (last?.role === "assistant") last.activitySummary = formatToolCounts(tools);
    else
      messages.push({
        role: "assistant",
        content: "[No reply text; tool activity only]",
        activitySummary: formatToolCounts(tools),
      });
    tools = new Map();
  };

  for (const entry of transcript.entries) {
    if (entry.kind === "user") {
      flushTools();
      const last = messages.at(-1);
      if (last?.role === "user") last.content = `${last.content}\n\n${entry.text}`;
      else messages.push({ role: "user", content: entry.text });
    } else if (entry.kind === "assistant") {
      const last = messages.at(-1);
      if (last?.role === "assistant") last.content = `${last.content}\n\n${entry.text}`;
      else messages.push({ role: "assistant", content: entry.text });
    } else if (entry.kind === "tool") {
      const name = toolName(entry.title);
      tools.set(name, (tools.get(name) ?? 0) + 1);
    }
  }
  flushTools();

  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  let total = messages.reduce((sum, message) => sum + message.content.length, 0);
  let omitted = 0;
  // Drop whole turns from the front so the kept history still starts with a prompt.
  while (total > maxChars && messages.length > 2) {
    const dropped = messages.shift()!;
    total -= dropped.content.length;
    omitted += 1;
    while (messages.length > 1 && messages[0]?.role !== "user") {
      total -= messages.shift()!.content.length;
      omitted += 1;
    }
  }
  if (omitted > 0 && messages[0]) {
    messages[0] = {
      ...messages[0],
      content: `[Imported from ${externalSourceLabel(transcript.summary.source)} session ${transcript.summary.id}; ${omitted} earlier messages omitted]\n\n${messages[0].content}`,
    };
  }
  return messages;
}
