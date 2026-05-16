import type { CodexModelCapability, CodexModelCapabilities } from "../codexModelCapabilities.js";
import type { ProviderModel } from "./types.js";
import { getClaudeCodeEffortLevels } from "./reasoning.js";

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
    description: "Claude Opus 4.7 - Fallback defaults",
    defaultReasoningLevel: "xhigh",
    supportedReasoningLevels: getClaudeCodeEffortLevels(["low", "medium", "high", "xhigh", "max"]),
    source: "fallback",
    canonicalId: "claude-opus-4-7",
    family: "opus",
    effortSource: "fallback",
    effortVerified: false,
  },
  {
    id: "sonnet",
    modelId: "sonnet",
    label: "Sonnet 4.6",
    description: "Claude Sonnet 4.6 - Fallback defaults",
    defaultReasoningLevel: "high",
    supportedReasoningLevels: getClaudeCodeEffortLevels(["low", "medium", "high", "max"]),
    source: "fallback",
    canonicalId: "claude-sonnet-4-6",
    family: "sonnet",
    effortSource: "fallback",
    effortVerified: false,
  },
  {
    id: "haiku",
    modelId: "haiku",
    label: "Haiku 4.5",
    description: "Claude Haiku 4.5 - Fallback defaults; effort metadata unverified",
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: getClaudeCodeEffortLevels(["low", "medium", "high"]),
    source: "fallback",
    canonicalId: "claude-haiku-4-5",
    family: "haiku",
    effortSource: "fallback",
    effortVerified: false,
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
      source: model.source === "discovered" || model.source === "claude-code" || model.source === "settings" || model.source === "config" ? "runtime" : "fallback",
      raw: model,
    }));

  const anyDiscovered = models.some((m) => m.source === "discovered" || m.source === "claude-code" || m.source === "settings" || m.source === "config");
  return {
    status: "ready",
    source: anyDiscovered ? "runtime" : "fallback",
    models: capabilities,
    discoveredAt: Date.now(),
    executable: null,
    error: null,
  };
}
