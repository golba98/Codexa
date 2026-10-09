import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConversationStore } from "../core/workspace/conversationStore.js";
import {
  assessSavedRoute,
  createSessionWorkspaceRelaunch,
  importNativeConversation,
} from "./sessionCatalog.js";

test("saved routes keep model, reasoning and backend and require explicit choice for missing routes", () => {
  const saved = {
    version: 1 as const,
    id: "chat_a",
    title: "chat",
    createdAt: "",
    updatedAt: "",
    messageCount: 2,
    providerId: "local",
    modelId: "fixture",
    backendKind: "local-openai-compatible",
    localBackend: "unsloth" as const,
    reasoning: "high",
  };
  const discovery = {
    providerId: "local" as const,
    backendKind: "local-openai-compatible" as const,
    status: "ready" as const,
    models: [
      {
        id: "fixture",
        modelId: "fixture",
        label: "fixture",
        description: "",
        defaultReasoningLevel: null,
        supportedReasoningLevels: null,
      },
    ],
  };
  const ready = assessSavedRoute(saved, discovery);
  assert.equal(ready.status, "ready");
  if (ready.status === "ready") {
    assert.equal(ready.route.localBackend, "unsloth");
    assert.equal(ready.route.reasoning, "high");
  }
  assert.equal(assessSavedRoute(saved, discovery, false).status, "unavailable");
  assert.equal(
    assessSavedRoute({ ...saved, localBackend: undefined }, discovery).status,
    "unavailable",
  );
  assert.equal(
    assessSavedRoute(saved, { ...discovery, status: "not-configured", models: [] }).status,
    "unavailable",
  );
  assert.equal(assessSavedRoute({ ...saved, modelId: "removed" }, discovery).status, "unavailable");
  assert.equal(assessSavedRoute({ ...saved, providerId: "unknown" }, null).status, "unavailable");
  // Antigravity was removed: its saved chats ask for an explicit provider instead of running.
  assert.equal(
    assessSavedRoute({ ...saved, providerId: "antigravity", localBackend: undefined }, null).status,
    "unavailable",
  );
});

test("native imports reuse provenance, retain new owned turns, and workspace relaunch carries a single resume target", () => {
  const root = mkdtempSync(join(tmpdir(), "ubume-import-"));
  try {
    const store = new ConversationStore(root, { rootDir: join(root, "chats") });
    const transcript = {
      summary: {
        source: "vibe" as const,
        id: "native",
        title: "Mistral chat",
        cwd: root,
        model: "chosen",
        updatedAt: "",
      },
      entries: [
        { id: "1", kind: "user" as const, title: "You", text: "first" },
        { id: "2", kind: "assistant" as const, title: "Vibe", text: "reply" },
      ],
    };
    const record = importNativeConversation(store, transcript, "fallback");
    record.messages.push({ role: "user", content: "owned continuation" });
    store.save(record);
    const again = importNativeConversation(store, transcript, "fallback");
    assert.equal(again.metadata.id, record.metadata.id);
    assert.equal(again.messages.length, 3);
    assert.equal(again.metadata.modelId, "chosen");
    const plan = createSessionWorkspaceRelaunch(
      root,
      {
        workspaceRoot: "/current",
        packageRoot: "/package",
        launchKind: "installed-bin",
        relaunchExecutable: "/bin/bun",
        relaunchArgs: ["/package/bin/ubume.js"],
      },
      { conversationId: record.metadata.id },
    );
    assert.equal(plan.ok, true);
    if (plan.ok) {
      assert.equal(plan.plan.cwd, root);
      assert.deepEqual(plan.plan.args.slice(-2), ["--resume", record.metadata.id]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
