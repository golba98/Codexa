import { formatReasoningLabel } from "../../config/settings.js";
import type {
  CodexModelCapabilities,
  CodexModelCapability,
  ReasoningEffortCapability,
} from "../models/codexModelCapabilities.js";
import type { ProviderModel } from "./types.js";

export const CLAUDE_CODE_EFFORT_LEVELS: readonly ReasoningEffortCapability[] = [
  { id: "low", label: "Low", description: "Claude Code low effort." },
  { id: "medium", label: "Medium", description: "Claude Code medium effort." },
  { id: "high", label: "High", description: "Claude Code high effort." },
  { id: "xhigh", label: "XHigh", description: "Claude Code extra-high effort." },
  { id: "max", label: "Max", description: "Claude Code maximum effort." },
] as const;

export const GEMINI_DEFAULT_MODEL_ID = "gemini-3-flash-preview";
/** Identity is authoritative: future versions and resource prefixes pass through. */
export function normalizeGeminiModelId(modelId: string | null | undefined): string {
  return modelId?.trim() || GEMINI_DEFAULT_MODEL_ID;
}

export function formatGeminiModelLabel(id: string, displayName?: string): string {
  const native = id.replace(/^models\//, "");
  const basis = /^gemini[-_]/i.test(native) ? native : displayName?.trim() || native;
  return basis
    .replace(/[_-]+/g, " ")
    .replace(
      /\b(?:preview|experimental)\b/gi,
      (word) => `(${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()})`,
    )
    .replace(
      /\b(gemini|flash|lite|pro|image|audio|thinking|fast|high|medium|low)\b/gi,
      (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase(),
    )
    .replace(/^(?:Gemini\s+)+/i, "Gemini ")
    .replace(/\s+/g, " ")
    .trim();
}

export const GEMINI_FALLBACK_MODELS: readonly ProviderModel[] = [
  {
    id: "gemini-3-flash-preview",
    modelId: "gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    source: "fallback",
    reasoningControl: { kind: "unknown" },
    description: "Unverified Gemini CLI Flash Preview route.",
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-3.1-pro-preview",
    modelId: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    source: "fallback",
    reasoningControl: { kind: "unknown" },
    description: "Unverified Gemini CLI Pro Preview route.",
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    modelId: "gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash Lite Preview",
    source: "fallback",
    reasoningControl: { kind: "unknown" },
    description: "Unverified Gemini CLI Flash Lite Preview route.",
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-2.5-pro",
    modelId: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    source: "fallback",
    reasoningControl: { kind: "unknown" },
    description: "Unverified Gemini CLI Pro route.",
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-2.5-flash",
    modelId: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    source: "fallback",
    reasoningControl: { kind: "unknown" },
    description: "Unverified Gemini CLI Flash route.",
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
  },
  {
    id: "gemini-2.5-flash-lite",
    modelId: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    source: "fallback",
    reasoningControl: { kind: "unknown" },
    description: "Unverified Gemini CLI Flash Lite route.",
    defaultReasoningLevel: null,
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
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
    reasoningControl: { kind: "unknown" },
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
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
    reasoningControl: { kind: "unknown" },
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
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
    reasoningControl: { kind: "unknown" },
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
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
    reasoningControl: { kind: "unknown" },
    source: "fallback",
    canonicalId: "haiku",
    family: "haiku",
    effortSource: "fallback",
    effortVerified: false,
  },
];

function isRuntimeSource(source: ProviderModel["source"]): boolean {
  return (
    source === "discovered" ||
    source === "claude-code" ||
    source === "claude-code-command" ||
    source === "claude-code-package" ||
    source === "claude-code-cache" ||
    source === "claude-code-config" ||
    source === "settings" ||
    source === "config"
  );
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
    available: model.available !== false,
    hidden: false,
    isDefault: model.modelId === currentModel || (!currentModel && index === 0),
    defaultReasoningLevel: model.defaultReasoningLevel,
    supportedReasoningLevels: model.supportedReasoningLevels,
    reasoningLevelCount: model.supportedReasoningLevels
      ? model.supportedReasoningLevels.length
      : null,
    source: isRuntimeSource(model.source) ? "runtime" : "fallback",
    raw: model,
    reasoningControl: model.reasoningControl,
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

export function getClaudeCodeEffortLevels(
  ids: readonly string[],
): readonly ReasoningEffortCapability[] {
  return ids.map(
    (id) =>
      CLAUDE_CODE_EFFORT_LEVELS.find((level) => level.id === id) ?? {
        id,
        label: formatReasoningLabel(id),
        description: null,
      },
  );
}
