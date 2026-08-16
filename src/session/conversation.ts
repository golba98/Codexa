import type { ConversationMessage } from "../core/workspace/conversationStore.js";
import type { AssistantEvent, TimelineEvent, UserPromptEvent } from "./types.js";

export function conversationMessagesToTimeline(
  messages: readonly ConversationMessage[],
  createEventId: () => number,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let turnId = 0;
  for (const message of messages) {
    if (message.role === "user") {
      turnId += 1;
      const user: UserPromptEvent = {
        id: createEventId(),
        type: "user",
        createdAt: Date.now(),
        prompt: message.content,
        turnId,
      };
      events.push(user);
      continue;
    }
    const assistant: AssistantEvent = {
      id: createEventId(),
      type: "assistant",
      createdAt: Date.now(),
      content: message.content,
      contentChunks: [],
      turnId,
    };
    events.push(assistant);
  }
  return events;
}

export function formatConversationHistory(messages: readonly ConversationMessage[]): string {
  return messages.map((message) => {
    const label = message.role === "user" ? "User" : "Assistant";
    return `${label}:\n${message.content}`;
  }).join("\n\n");
}

export function selectConversationContext(
  messages: readonly ConversationMessage[],
  maxCharacters?: number,
): ConversationMessage[] {
  if (!maxCharacters || maxCharacters <= 0) return [...messages];
  const selected: ConversationMessage[] = [];
  let total = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const cost = message.content.length;
    if (selected.length > 0 && total + cost > maxCharacters) break;
    selected.unshift(message);
    total += cost;
  }
  return selected;
}
