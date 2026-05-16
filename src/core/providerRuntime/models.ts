import type { CodexModelCapability, CodexModelCapabilities } from "../codexModelCapabilities.js";
import type { ProviderModel } from "./types.js";

export const GEMINI_FALLBACK_MODELS: readonly ProviderModel[] = [
  {
    id: "gemini-3.1-pro",
    modelId: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    description: "Configured Gemini Pro route placeholder.",
    defaultReasoningLevel: "high",
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-3-flash",
    modelId: "gemini-3-flash",
    label: "Gemini 3 Flash",
    description: "Configured Gemini Flash route placeholder.",
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-2.5-pro",
    modelId: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "Gemini 2.5 Pro route placeholder.",
    defaultReasoningLevel: "high",
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-2.5-flash",
    modelId: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Gemini 2.5 Flash route placeholder.",
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: null,
  },
] as const;

export const ANTHROPIC_FALLBACK_MODELS: readonly ProviderModel[] = [
  {
    id: "opus",
    modelId: "opus",
    label: "Opus 4.7",
    description: "Claude Opus 4.7 — Claude Code CLI",
    defaultReasoningLevel: "high",
    supportedReasoningLevels: null,
    source: "fallback",
  },
  {
    id: "sonnet",
    modelId: "sonnet",
    label: "Sonnet 4.6",
    description: "Claude Sonnet 4.6 — Claude Code CLI",
    defaultReasoningLevel: "high",
    supportedReasoningLevels: null,
    source: "fallback",
  },
  {
    id: "haiku",
    modelId: "haiku",
    label: "Haiku 4.5",
    description: "Claude Haiku 4.5 — Claude Code CLI",
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: null,
    source: "fallback",
  },
] as const;

export function providerModelsToCodexCapabilities(
  models: readonly ProviderModel[],
  currentModel: string,
): CodexModelCapabilities {
  const capabilities: readonly CodexModelCapability[] = models.map((model, index) => ({
      id: model.id,
      model: model.modelId,
      label: model.label,
      description: model.description,
      available: true,
      hidden: false,
      isDefault: model.modelId === currentModel || (!currentModel && index === 0),
      defaultReasoningLevel: model.defaultReasoningLevel,
      supportedReasoningLevels: model.supportedReasoningLevels,
      reasoningLevelCount: model.supportedReasoningLevels ? model.supportedReasoningLevels.length : null,
      source: model.source === "discovered" || model.source === "config" ? "runtime" : "fallback",
      raw: model,
    }));

  const anyDiscovered = models.some((m) => m.source === "discovered" || m.source === "config");
  return {
    status: "ready",
    source: anyDiscovered ? "runtime" : "fallback",
    models: capabilities,
    discoveredAt: Date.now(),
    executable: null,
    error: null,
  };
}
