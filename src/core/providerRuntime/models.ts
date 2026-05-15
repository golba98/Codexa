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
] as const;

export const ANTHROPIC_FALLBACK_MODELS: readonly ProviderModel[] = [
  {
    id: "claude-sonnet-4-20250514",
    modelId: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    description: "Anthropic Claude Sonnet 4 API model.",
    defaultReasoningLevel: "high",
    supportedReasoningLevels: null,
  },
  {
    id: "claude-opus-4-1-20250805",
    modelId: "claude-opus-4-1-20250805",
    label: "Claude Opus 4.1",
    description: "Anthropic Claude Opus 4.1 API model.",
    defaultReasoningLevel: "high",
    supportedReasoningLevels: null,
  },
  {
    id: "claude-3-5-haiku-20241022",
    modelId: "claude-3-5-haiku-20241022",
    label: "Claude Haiku 3.5",
    description: "Anthropic Claude Haiku 3.5 API model.",
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: null,
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
      source: "fallback",
      raw: model,
    }));

  return {
    status: "ready",
    source: "fallback",
    models: capabilities,
    discoveredAt: Date.now(),
    executable: null,
    error: null,
  };
}
