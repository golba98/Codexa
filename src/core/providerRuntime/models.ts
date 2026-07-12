import type { CodexModelCapability, CodexModelCapabilities } from "../models/codexModelCapabilities.js";
import type { ProviderModel } from "./types.js";
import { getClaudeCodeEffortLevels } from "./reasoning.js";

export const GEMINI_DEFAULT_MODEL_ID = "gemini-3-flash-preview";
export const GEMINI_VERIFIED_MODEL_IDS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

export function isVerifiedGeminiModelId(modelId: string | null | undefined): modelId is typeof GEMINI_VERIFIED_MODEL_IDS[number] {
  return typeof modelId === "string" && GEMINI_VERIFIED_MODEL_IDS.includes(modelId as typeof GEMINI_VERIFIED_MODEL_IDS[number]);
}

export function normalizeGeminiModelId(modelId: string | null | undefined): string {
  // "gemini-3-flash" is an older shorthand; remap it to the canonical preview ID.
  if (modelId === "gemini-3-flash") return "gemini-3-flash-preview";
  return isVerifiedGeminiModelId(modelId) ? modelId : GEMINI_DEFAULT_MODEL_ID;
}

export const GEMINI_FALLBACK_MODELS: readonly ProviderModel[] = [
  {
    id: "gemini-3-flash-preview",
    modelId: "gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    description: "Verified Gemini CLI Flash Preview route.",
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-3.1-pro-preview",
    modelId: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    description: "Verified Gemini CLI Pro Preview route.",
    defaultReasoningLevel: "high",
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    modelId: "gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash Lite Preview",
    description: "Verified Gemini CLI Flash Lite Preview route.",
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-2.5-pro",
    modelId: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "Verified Gemini CLI Pro route.",
    defaultReasoningLevel: "high",
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-2.5-flash",
    modelId: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Verified Gemini CLI Flash route.",
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-2.5-flash-lite",
    modelId: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    description: "Verified Gemini CLI Flash Lite route.",
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: null,
  },
] as const;

function fallbackModelDescription(family: string): string {
  return `Claude ${family} alias — version unknown because model discovery is unavailable`;
}

export const ANTHROPIC_FALLBACK_MODELS: readonly ProviderModel[] = [
  {
    id: "fable",
    modelId: "fable",
    label: "Claude Fable (version unknown)",
    description: fallbackModelDescription("Fable"),
    defaultReasoningLevel: "xhigh",
    supportedReasoningLevels: getClaudeCodeEffortLevels(["low", "medium", "high", "xhigh", "max"]),
    source: "fallback",
    canonicalId: "fable",
    family: "fable",
    effortSource: "fallback",
    effortVerified: false,
  },
  {
    id: "opus",
    modelId: "opus",
    label: "Claude Opus (version unknown)",
    description: fallbackModelDescription("Opus"),
    defaultReasoningLevel: "xhigh",
    supportedReasoningLevels: getClaudeCodeEffortLevels(["low", "medium", "high", "xhigh", "max"]),
    source: "fallback",
    canonicalId: "opus",
    family: "opus",
    effortSource: "fallback",
    effortVerified: false,
  },
  {
    id: "sonnet",
    modelId: "sonnet",
    label: "Claude Sonnet (version unknown)",
    description: fallbackModelDescription("Sonnet"),
    defaultReasoningLevel: "high",
    supportedReasoningLevels: getClaudeCodeEffortLevels(["low", "medium", "high", "max"]),
    source: "fallback",
    canonicalId: "sonnet",
    family: "sonnet",
    effortSource: "fallback",
    effortVerified: false,
  },
  {
    id: "haiku",
    modelId: "haiku",
    label: "Claude Haiku (version unknown)",
    description: fallbackModelDescription("Haiku"),
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: getClaudeCodeEffortLevels(["low", "medium", "high"]),
    source: "fallback",
    canonicalId: "haiku",
    family: "haiku",
    effortSource: "fallback",
    effortVerified: false,
  },
];

function isRuntimeSource(source: ProviderModel["source"]): boolean {
  return source === "discovered"
    || source === "claude-code"
    || source === "claude-code-command"
    || source === "claude-code-package"
    || source === "claude-code-cache"
    || source === "claude-code-config"
    || source === "settings"
    || source === "config";
}

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
    source: isRuntimeSource(model.source) ? "runtime" : "fallback",
    raw: model,
  }));

  const anyDiscovered = models.some((m) => isRuntimeSource(m.source));
  return {
    status: "ready",
    source: anyDiscovered ? "runtime" : "fallback",
    models: capabilities,
    discoveredAt: Date.now(),
    executable: null,
    error: null,
  };
}
