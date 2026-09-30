import { createWorkspaceRelaunchPlan, type LaunchContext } from "../core/workspace/launchContext.js";
import { externalTranscriptToConversationMessages, externalProviderId, type ExternalTranscript } from "../core/externalSessions/index.js";
import { ConversationStore, type ConversationMetadata, type ConversationRecord } from "../core/workspace/conversationStore.js";
import { buildResumedProviderRoute } from "./conversation.js";
import { isKnownProviderId } from "../core/providerLauncher/registry.js";
import { getProviderRuntime, isProviderRoutableInUbume } from "../core/providerRuntime/registry.js";
import type { ProviderModelDiscoveryResult, ProviderRoute } from "../core/providerRuntime/types.js";

export type SavedRouteAssessment = { status: "ready"; route: ProviderRoute } | { status: "unavailable"; message: string; route?: ProviderRoute };

export function assessSavedRoute(metadata: ConversationMetadata, discovery: ProviderModelDiscoveryResult | null, enabled = true): SavedRouteAssessment {
  const id = metadata.providerId;
  if (typeof id !== "string" || !isKnownProviderId(id) || id === "google" || !isProviderRoutableInUbume(id)) return { status: "unavailable", message: "The saved provider is unavailable. Select a provider and model explicitly before sending." };
  const route = buildResumedProviderRoute(metadata, id, getProviderRuntime(id).backendKind);
  if (!enabled) return { status: "unavailable", route, message: "The saved provider is disabled in this workspace. Enable it or select a working provider explicitly before sending." };
  if (id === "local" && !metadata.localBackend) return { status: "unavailable", route, message: "This older Local chat has no recorded backend. Select LM Studio or Unsloth and a model before sending." };
  if (discovery?.status === "not-configured") return { status: "unavailable", route, message: discovery.message ?? "The saved route is not configured. Select a working provider and model before sending." };
  if (discovery?.status === "ready" && discovery.models.length > 0 && !discovery.models.some((model) => model.modelId === route.modelId || model.id === route.modelId)) {
    return { status: "unavailable", route, message: `The saved model ${route.modelId} is unavailable. Select a model explicitly before sending.` };
  }
  return { status: "ready", route };
}

/** Provenance is workspace-scoped; repeated imports reuse the owned conversation. */
export function importNativeConversation(store: ConversationStore, transcript: ExternalTranscript, modelId: string): ConversationRecord {
  const { summary } = transcript;
  const previous = store.list().find((entry) => entry.importedFrom?.source === summary.source && entry.importedFrom.sessionId === summary.id);
  if (previous) {
    const loaded = store.load(previous.id);
    if (!loaded) throw new Error("The previously imported conversation could not be loaded.");
    return loaded;
  }
  const messages = externalTranscriptToConversationMessages(transcript);
  if (!messages.length) throw new Error("This session has no readable dialogue to import.");
  const providerId = externalProviderId(summary.source);
  const record = store.createConversation({ providerId, modelId: summary.model ?? modelId, backendKind: getProviderRuntime(providerId).backendKind });
  record.metadata.title = summary.title;
  record.metadata.importedFrom = { source: summary.source, sessionId: summary.id };
  record.messages = messages;
  store.save(record);
  return record;
}

/** Reuse the installed/dev launcher, while avoiding replay of startup arguments. */
export function createSessionWorkspaceRelaunch(target: string, context: LaunchContext, resume: { conversationId: string } | { source: string; sessionId: string }) {
  const result = createWorkspaceRelaunchPlan(target, context);
  if (!result.ok) return result;
  const args = [...result.plan.args, ...("conversationId" in resume ? ["--resume", resume.conversationId] : ["--import-session", `${resume.source}:${resume.sessionId}`])];
  return { ok: true as const, plan: { ...result.plan, args } };
}
