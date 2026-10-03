import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { workspaceStorageKey } from "../core/workspace/appData.js";
import { ConversationStore } from "../core/workspace/conversationStore.js";
import {
  conversationSummary,
  filterSessionCatalog,
  listSessionCatalog,
  mergeSessionSummaries,
} from "./sessionCatalog.js";

const route = {
  providerId: "local",
  modelId: "fixture",
  backendKind: "local-openai-compatible",
  localBackend: "unsloth",
} as const;

test("legacy chat migration preserves identity and artifacts, never changes the original, and ignores an empty failed migration", () => {
  const root = mkdtempSync(join(tmpdir(), "ubume-migration-"));
  try {
    const oldRoot = join(root, "old");
    const newRoot = join(root, "new");
    const legacy = new ConversationStore("/work", { rootDir: oldRoot, idFactory: () => "legacy" });
    const record = legacy.createConversation(route);
    record.messages = [
      { role: "user", content: "persist me", submittedContent: "expanded input", turnId: 17 },
    ];
    record.metadata.nativeSessions = [{ source: "vibe", sessionId: "native-1" }];
    legacy.save(record);
    const original = readFileSync(join(oldRoot, record.metadata.id, "snapshot.json"));
    mkdirSync(join(newRoot, record.metadata.id), { recursive: true });
    const migrated = new ConversationStore("/work", { rootDir: newRoot, legacyRootDir: oldRoot });
    assert.equal(migrated.list()[0]?.id, record.metadata.id);
    const loaded = migrated.load(record.metadata.id)!;
    assert.equal(loaded.messages[0]?.turnId, 17);
    assert.match(migrated.location(record.metadata.id), /old/);
    assert.equal(
      existsSync(join(newRoot, record.metadata.id, "snapshot.json")),
      false,
      "listing is read-only",
    );
    migrated.save(loaded);
    assert.deepEqual(readFileSync(join(oldRoot, record.metadata.id, "snapshot.json")), original);
    assert.deepEqual(
      migrated.load(record.metadata.id)?.metadata.nativeSessions,
      record.metadata.nativeSessions,
    );
    assert.match(migrated.location(record.metadata.id), /new/);
    writeFileSync(join(newRoot, record.metadata.id, "summary.json"), "broken cache");
    assert.equal(migrated.list()[0]?.id, record.metadata.id);
    writeFileSync(
      join(newRoot, record.metadata.id, "snapshot.json"),
      "corrupt authoritative generation",
    );
    assert.equal(
      migrated.load(record.metadata.id),
      null,
      "corruption must not resurrect an old generation",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("catalog merges owned and native histories by provenance and workspace, isolates provider failures, and filters local routes", async () => {
  const root = mkdtempSync(join(tmpdir(), "ubume-catalog-"));
  try {
    const workspace = "/work/one";
    const other = "/work/two";
    const key = workspaceStorageKey(workspace);
    const store = new ConversationStore(workspace, {
      rootDir: join(root, "chats", key, "conversations"),
      idFactory: () => "owned",
    });
    const record = store.createConversation(route);
    record.messages = [{ role: "user", content: "local chat" }];
    store.save(record);
    const native = {
      source: "codex" as const,
      id: "native-1",
      title: "native chat",
      cwd: other,
      updatedAt: "2026-10-01T12:00:00.000Z",
    };
    const result = await listSessionCatalog(workspace, "all", {
      dataDir: root,
      legacyDataDir: join(root, "legacy"),
      sources: ["claude", "codex"],
      loadExternal: async (source) => {
        if (source === "claude") throw new Error("unreadable store");
        return [native];
      },
    });
    assert.equal(result.sessions.length, 2);
    assert.match(result.errors.join(" "), /unreadable store/);
    assert.equal(
      filterSessionCatalog(result.sessions, {
        provider: "local",
        backend: "unsloth",
        model: "fixture",
        query: "local",
      }).length,
      1,
    );
    assert.equal(filterSessionCatalog(result.sessions, { backend: "lm-studio" }).length, 0);
    const owned = conversationSummary(
      { ...record.metadata, importedFrom: { source: "codex", sessionId: native.id } },
      workspace,
      key,
    );
    assert.equal(
      mergeSessionSummaries([owned], [{ ...native, cwd: workspace + "/" }, native, native]).length,
      2,
    );
    const unknownKey = workspaceStorageKey("/unrecorded");
    const old = new ConversationStore("", {
      rootDir: join(root, "legacy", "workspaces", unknownKey, "conversations"),
      idFactory: () => "unknown",
    });
    const unknown = old.createConversation(route);
    delete unknown.metadata.workspaceRoot;
    unknown.messages = [{ role: "user", content: "old chat" }];
    old.save(unknown);
    const all = await listSessionCatalog(workspace, "all", {
      dataDir: root,
      legacyDataDir: join(root, "legacy"),
      sources: [],
    });
    assert.equal(all.sessions.find((entry) => entry.title === "old chat")?.workspaceRoot, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
