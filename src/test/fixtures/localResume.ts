import { normalizeRuntimeConfig, resolveRuntimeConfig } from "../../config/runtimeConfig.js";
import type { LocalBackendId } from "../../core/providerLauncher/types.js";
import { localRuntime } from "../../core/providerRuntime/local.js";
import { shutdownLocalHarness } from "../../core/providerRuntime/localHarness/runtime.js";
import { ConversationStore } from "../../core/workspace/conversationStore.js";

const backend = process.argv[2] as LocalBackendId;
const turn = Number(process.argv[3]);
const store = new ConversationStore(process.cwd());
const route = {
  providerId: "local" as const,
  modelId: "fixture",
  backendKind: "local-openai-compatible" as const,
  localBackend: backend,
};
const record = turn === 1 ? store.createConversation(route) : store.load(store.list()[0]!.id)!;
try {
  const prompt = `turn ${turn}`;
  const answer = await new Promise<string>((resolve, reject) => {
    localRuntime.run!(
      {
        prompt,
        workspaceRoot: process.cwd(),
        route,
        conversationHistory: record.messages,
        localHarnessSession: record.metadata.localHarnessSession,
        runtime: resolveRuntimeConfig(
          normalizeRuntimeConfig({ mode: "full-auto", model: "fixture" }),
        ),
      },
      {
        onResponse: resolve,
        onError: (error) => reject(new Error(error)),
        onLocalHarnessSession: (metadata) => {
          if (metadata) record.metadata.localHarnessSession = metadata;
        },
      },
    );
  });
  record.messages.push({ role: "user", content: prompt }, { role: "assistant", content: answer });
  store.save(record);
  console.log(
    JSON.stringify({
      id: record.metadata.id,
      harness: record.metadata.localHarnessSession,
      answer,
    }),
  );
} finally {
  await shutdownLocalHarness();
  store.release();
}
