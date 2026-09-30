import assert from "node:assert/strict";
import test from "node:test";
import { activityLabel, externalRowText, matchesQuery, nextResumeTab, ubumeRowText } from "./resumePickerRows.js";
import { createAtomicContentToken } from "../input/pastedContent.js";

const now = new Date(2026, 8, 30, 15, 0);

test("resume rows hide attachment IDs without changing visible titles or stored metadata", () => {
  for (const label of ["[Pasted Content 22,703 chars]", "[Image: photo.png]", "[File: notes.txt]"]) {
    const title = `${createAtomicContentToken(label)} · café ❤️`;
    const conversation = { version: 1 as const, id: "chat_a", title, createdAt: "", updatedAt: "not a date", providerId: "local", modelId: "qwen", backendKind: null, messageCount: 9 };
    assert.equal(ubumeRowText(conversation, now), `${label} · café ❤️ — Unknown time · qwen · Local · 9 messages`);
    assert.equal(externalRowText({ source: "claude", id: "abc", title, cwd: "/work/app", updatedAt: "not a date" }, "workspace", now), `${label} · café ❤️ — Unknown time · Claude Code`);
    assert.equal(conversation.title, title);
  }
});

test("activityLabel describes recent activity relative to now", () => {
  assert.match(activityLabel(new Date(2026, 8, 30, 9, 5).toISOString(), now), /^Today, /);
  assert.match(activityLabel(new Date(2026, 8, 29, 9, 5).toISOString(), now), /^Yesterday, /);
  assert.equal(activityLabel("not a date", now), "Unknown time");
});

test("ubumeRowText shows route, size and where an imported conversation came from", () => {
  const base = { version: 1 as const, id: "chat_a", title: "Fix picker", createdAt: "", updatedAt: "not a date", providerId: "anthropic", modelId: "sonnet", backendKind: null, messageCount: 4 };
  assert.equal(ubumeRowText(base, now), "Fix picker — Unknown time · sonnet · Anthropic · 4 messages");
  assert.equal(ubumeRowText({ ...base, importedFrom: { source: "codex", sessionId: "x" } }, now), "Fix picker — Unknown time · sonnet · Anthropic · 4 messages · from Codex");
});

test("externalRowText adds the folder name only when listing every project", () => {
  const summary = { source: "claude" as const, id: "abc", title: "Rename package", cwd: "/work/my app", updatedAt: "not a date", model: "claude-opus-5-5" };
  assert.equal(externalRowText(summary, "workspace", now), "Rename package — Unknown time · Claude Code · claude-opus-5-5");
  assert.equal(externalRowText({ ...summary, model: undefined }, "all", now), "Rename package — Unknown time · Claude Code · my app");
});

test("matchesQuery is case-insensitive across every field", () => {
  assert.equal(matchesQuery(["Rename package", "/work/app"], "WORK"), true);
  assert.equal(matchesQuery(["Rename package"], "missing"), false);
  assert.equal(matchesQuery(["anything"], ""), true);
});

test("nextResumeTab wraps in both directions", () => {
  assert.equal(nextResumeTab("all", 1), "openai");
  assert.equal(nextResumeTab("antigravity", 1), "all");
  assert.equal(nextResumeTab("all", -1), "antigravity");
});
