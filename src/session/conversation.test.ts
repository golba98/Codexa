import assert from "node:assert/strict";
import test from "node:test";
import { conversationMessagesToTimeline, formatConversationHistory, selectConversationContext } from "./conversation.js";

test("conversation context restores dialogue as normal user and assistant timeline events", () => {
    let nextId = 0;
    const events = conversationMessagesToTimeline([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ], () => ++nextId);
    assert.deepEqual(events.map((event) => event.type), ["user", "assistant"]);
    assert.equal(events[0]?.type === "user" ? events[0].turnId : null, 1);
    assert.equal(events[1]?.type === "assistant" ? events[1].turnId : null, 1);
});

test("conversation context keeps complete history while selecting only a request tail", () => {
    const messages = [
      { role: "user" as const, content: "old" },
      { role: "assistant" as const, content: "old answer" },
      { role: "user" as const, content: "new" },
      { role: "assistant" as const, content: "new answer" },
    ];
    assert.deepEqual(selectConversationContext(messages, 13).map((message) => message.content), ["new", "new answer"]);
    assert.equal(messages.length, 4);
});

test("conversation context serializes prior turns without credentials or provider state", () => {
    assert.equal(formatConversationHistory([
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
    ]), "User:\nQuestion\n\nAssistant:\nAnswer");
});
