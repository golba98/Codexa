import type { RuntimeSummary } from "../../config/runtimeConfig.js";
import type { Theme } from "../../config/settings.js";
import { formatModeLabel, formatReasoningLabel } from "../../config/settings.js";
import type { CodexModelCapability } from "../../core/models/codexModelCapabilities.js";
import { reconcileReasoning } from "../../core/models/reasoningControl.js";
import { getAntigravityModelLabel } from "../../core/providerRuntime/antigravity.js";
import { CODEXA_NATIVE_MODEL_ID } from "../../core/providerRuntime/codexaNative.js";
import type {
  ModelContextMetadata,
  ModelSpec,
} from "../../core/providerRuntime/contextMetadata.js";
import {
  contextMetadataToModelSpec,
  formatContextCompact,
} from "../../core/providerRuntime/contextMetadata.js";
import { formatGeminiModelLabel } from "../../core/providerRuntime/models.js";
import type { ActiveProviderRoute } from "../../core/providerRuntime/types.js";

interface ActiveRuntimeDisplayInput {
  route: ActiveProviderRoute;
  reasoningLevel: string;
  mode: string;
  tokensUsed: number;
  modelCapability?: CodexModelCapability | null;
  contextMetadata?: ModelContextMetadata | null;
  isLocalRuntime?: boolean;
}

interface ActiveRuntimeDisplay {
  providerLabel: string;
  modelDisplay: string;
  footerModelDisplay: string;
  contextDisplay: string;
  showContext: boolean;
  modeLabel: string;
  modelSpec: ModelSpec;
}

const PROVIDER_DISPLAY: Record<string, string> = {
  openai: "OpenAI Codex CLI",
  anthropic: "Claude Code CLI",
  google: "Gemini CLI",
  mistral: "Mistral Vibe CLI",
  local: "Local",
  "codexa-native": "Codexa Native",
  "codexa-cupy": "Codexa Native",
  antigravity: "Antigravity CLI",
};

function formatContextLimit(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return Number.isInteger(millions) || Math.abs(millions - 1.048576) < 0.000001
      ? `${Math.round(millions)}M`
      : `${millions.toFixed(1)}M`;
  }
  return formatContextCompact(value);
}

function formatUsedTokens(value: number): string {
  return formatContextCompact(value).replace(/k$/, "K");
}

function isContextForRoute(
  metadata: ModelContextMetadata | null | undefined,
  route: ActiveProviderRoute,
): metadata is ModelContextMetadata {
  return metadata?.providerId === route.providerId && metadata.modelId === route.modelId;
}

function getModelLabel(
  route: ActiveProviderRoute,
  capability?: CodexModelCapability | null,
): string {
  if (capability?.label) return capability.label;
  if (route.providerId === "google") return formatGeminiModelLabel(route.modelId);
  if (route.providerId === "anthropic") {
    return capability?.label ?? route.modelId;
  }
  if (route.providerId === "antigravity") {
    return getAntigravityModelLabel(route.modelId);
  }
  if (route.providerId === "codexa-native") {
    // Older persisted routes may still contain the 900M checkpoint directory
    // name; the user-facing Codexa Native model is the canonical 1B SFT v2 ID.
    return CODEXA_NATIVE_MODEL_ID;
  }
  if (route.providerId === "codexa-cupy") {
    return route.modelId;
  }
  return route.modelId;
}

export function buildActiveRuntimeDisplay({
  route,
  reasoningLevel,
  mode,
  tokensUsed,
  modelCapability = null,
  contextMetadata = null,
  isLocalRuntime = false,
}: ActiveRuntimeDisplayInput): ActiveRuntimeDisplay {
  const providerLabel = PROVIDER_DISPLAY[route.providerId] ?? route.providerId;
  const rawReasoning =
    route.providerId === "antigravity" ? route.reasoning : (route.reasoning ?? reasoningLevel);
  // Local runtimes own their reasoning behavior; Ubume cannot adjust it.
  // Do not present the global fallback as if it were an active Local setting.
  const supported =
    modelCapability?.supportedReasoningLevels?.some((level) => level.id === rawReasoning) ||
    modelCapability?.reasoningControl?.kind === "budget";
  const effectiveReasoning = modelCapability?.reasoningControl
    ? reconcileReasoning(modelCapability.reasoningControl, rawReasoning ?? "")
    : supported
      ? rawReasoning
      : modelCapability?.defaultReasoningLevel;
  const reasoning = effectiveReasoning
    ? formatReasoningLabel(effectiveReasoning)
    : !modelCapability && route.providerId === "openai" && rawReasoning
      ? formatReasoningLabel(rawReasoning)
      : null;
  const modelLabel = getModelLabel(route, modelCapability);
  const validContextMetadata = isContextForRoute(contextMetadata, route) ? contextMetadata : null;
  const contextDisplay =
    validContextMetadata?.contextLength != null
      ? `${formatUsedTokens(tokensUsed)} / ${validContextMetadata.confidence === "estimated" ? "~" : ""}${formatContextLimit(validContextMetadata.contextLength)}`
      : "Unknown";
  const modelSpec = contextMetadataToModelSpec(
    validContextMetadata ?? {
      providerId: route.providerId,
      modelId: route.modelId,
      contextLength: null,
      source: "unknown",
      confidence: "unknown",
      error: "Context length unavailable for this model.",
    },
  );

  return {
    providerLabel,
    modelDisplay: reasoning
      ? `${providerLabel} / ${modelLabel} / reasoning: ${reasoning}`
      : `${providerLabel} / ${modelLabel}`,
    footerModelDisplay: reasoning
      ? `${providerLabel} / ${modelLabel} (${reasoning})`
      : `${providerLabel} / ${modelLabel}`,
    contextDisplay: isLocalRuntime ? contextDisplay : "",
    showContext: isLocalRuntime,
    modeLabel: formatModeLabel(mode),
    modelSpec,
  };
}

export function runtimeDisplayToSummary(
  display: ActiveRuntimeDisplay,
  base: RuntimeSummary,
): RuntimeSummary {
  return {
    ...base,
    providerLabel: display.providerLabel,
    modelLabel: display.modelDisplay,
    contextLabel: display.contextDisplay,
  };
}

interface ModeDisplaySpec {
  label: string;
  ringGlyph: string;
  ringColor: string;
  ringFill: string;
  iconColor: string;
  labelColor: string;
  labelBold: boolean;
  ringBold: boolean;
}

export function getModeDisplaySpec(mode: string, theme: Theme): ModeDisplaySpec {
  switch (mode) {
    case "full-auto":
      return {
        label: formatModeLabel(mode),
        ringGlyph: "◉",
        ringColor: theme.warning,
        ringFill: theme.border,
        iconColor: theme.warning,
        labelColor: theme.text,
        labelBold: true,
        ringBold: true,
      };
    case "auto-edit":
      return {
        label: formatModeLabel(mode),
        ringGlyph: "◎",
        ringColor: theme.borderFocused,
        ringFill: theme.surfaceMuted,
        iconColor: theme.prompt,
        labelColor: theme.text,
        labelBold: true,
        ringBold: false,
      };
    case "suggest":
    default:
      return {
        label: formatModeLabel(mode),
        ringGlyph: "○",
        ringColor: theme.success,
        ringFill: theme.surfaceMuted,
        iconColor: theme.success,
        labelColor: theme.textMuted,
        labelBold: false,
        ringBold: false,
      };
  }
}
