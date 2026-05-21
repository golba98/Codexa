import type { ModelSpec } from "../models/modelSpecs.js";
import type { ProviderId, ProviderWorkspaceOverride } from "../providerLauncher/types.js";

export type ContextLengthSource = "api" | "cli" | "config" | "known-registry" | "lmstudio-api" | "unknown";
export type ContextConfidence = "verified" | "configured" | "known" | "unknown";

export interface ModelContextMetadata {
  providerId: ProviderId;
  modelId: string;
  contextLength: number | null;
  source: ContextLengthSource;
  confidence: ContextConfidence;
  raw?: unknown;
  rawField?: string;
  error?: string;
}

export interface ResolveModelContextLengthOptions {
  providerId: ProviderId;
  modelId: string;
  providerConfig?: ProviderWorkspaceOverride | null;
  rawMetadata?: unknown;
}

interface KnownContextRegistryEntry {
  contextLength: number;
  sourceUrl: string;
  note: string;
}

const KNOWN_CONTEXT_REGISTRY: Record<string, KnownContextRegistryEntry> = {
  // Exact documented Gemini API model IDs only.
  // Source: https://ai.google.dev/gemini-api/docs/models
  "google:gemini-2.5-pro": {
    contextLength: 1_048_576,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/models",
    note: "Gemini API documented input token limit for this exact model ID.",
  },
  "google:gemini-2.5-flash": {
    contextLength: 1_048_576,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/models",
    note: "Gemini API documented input token limit for this exact model ID.",
  },
  "google:gemini-2.5-flash-lite": {
    contextLength: 1_048_576,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/models",
    note: "Gemini API documented input token limit for this exact model ID.",
  },
  // Gemini 3 preview model IDs — verified route IDs from GEMINI_VERIFIED_MODEL_IDS.
  // Source: https://ai.google.dev/gemini-api/docs/models
  "google:gemini-3-flash-preview": {
    contextLength: 1_048_576,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/models",
    note: "Gemini 3 Flash Preview — 1M token input limit.",
  },
  "google:gemini-3.1-pro-preview": {
    contextLength: 1_048_576,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/models",
    note: "Gemini 3.1 Pro Preview — 1M token input limit.",
  },
  "google:gemini-3.1-flash-lite-preview": {
    contextLength: 1_048_576,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/models",
    note: "Gemini 3.1 Flash Lite Preview — 1M token input limit.",
  },
  // Exact documented Anthropic model IDs only. Provider aliases such as
  // "haiku" remain unknown unless configured or discovered by CLI metadata.
  // Source: https://docs.anthropic.com/en/docs/about-claude/models
  "anthropic:claude-opus-4-7": {
    contextLength: 200_000,
    sourceUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
    note: "Anthropic documented context window for this exact model ID.",
  },
  "anthropic:claude-sonnet-4-6": {
    contextLength: 200_000,
    sourceUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
    note: "Anthropic documented context window for this exact model ID.",
  },
  "anthropic:claude-haiku-4-5": {
    contextLength: 200_000,
    sourceUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
    note: "Anthropic documented context window for this exact model ID.",
  },
};

// Short alias IDs used by ANTHROPIC_FALLBACK_MODELS → canonical versioned IDs in the registry.
const ANTHROPIC_MODEL_ALIAS_MAP: Record<string, string> = {
  opus:   "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku:  "claude-haiku-4-5",
};

const CONTEXT_FIELD_CANDIDATES = [
  "loaded_context_length",
  "context_length",
  "contextLength",
  "max_context_length",
  "maxContextLength",
  "n_ctx",
  "ctx_len",
  "max_tokens",
  "max_input_tokens",
] as const;

const NESTED_METADATA_KEYS = [
  "model_info",
  "modelInfo",
  "metadata",
  "details",
  "config",
  "raw",
] as const;

const contextCache = new Map<string, ModelContextMetadata>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validContextLength(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function cacheKey(options: ResolveModelContextLengthOptions): string {
  return JSON.stringify({
    providerId: options.providerId,
    modelId: options.modelId,
    models: options.providerConfig?.models ?? null,
  });
}

export function clearModelContextMetadataCache(): void {
  contextCache.clear();
}

export function formatContextLength(value: number | null): string {
  return value === null ? "Unknown" : value.toLocaleString("en-US");
}

export function formatContextMeter(
  usedTokens: number | null | undefined,
  contextLimit: number | null,
): string {
  if (contextLimit === null || contextLimit === undefined) return "Unknown";
  const used = usedTokens ?? 0;
  const pct = contextLimit > 0
    ? Math.min(100, Math.floor((used / contextLimit) * 100))
    : 0;
  return `${used.toLocaleString("en-US")} / ${contextLimit.toLocaleString("en-US")} · ${pct}%`;
}

export function contextMetadataToModelSpec(metadata: ModelContextMetadata): ModelSpec {
  if (metadata.contextLength === null) {
    return {
      status: "unknown",
      contextWindow: null,
      maxOutputTokens: null,
      sourceUrl: "",
      verifiedAt: null,
      error: metadata.error ?? null,
    };
  }

  return {
    status: "verified",
    contextWindow: metadata.contextLength,
    maxOutputTokens: metadata.contextLength,
    sourceUrl: metadata.source,
    verifiedAt: Date.now(),
  };
}

function unknownMetadata(
  providerId: ProviderId,
  modelId: string,
  error = "Context length metadata is unavailable for this provider/model.",
): ModelContextMetadata {
  return {
    providerId,
    modelId,
    contextLength: null,
    source: "unknown",
    confidence: "unknown",
    error,
  };
}

function findContextField(raw: unknown): { value: number; field: string } | null {
  if (!isRecord(raw)) return null;

  for (const field of CONTEXT_FIELD_CANDIDATES) {
    const value = validContextLength(raw[field]);
    if (value !== null) return { value, field };
  }

  for (const nestedKey of NESTED_METADATA_KEYS) {
    const nested = raw[nestedKey];
    if (!isRecord(nested)) continue;
    for (const field of CONTEXT_FIELD_CANDIDATES) {
      const value = validContextLength(nested[field]);
      if (value !== null) return { value, field: `${nestedKey}.${field}` };
    }
  }

  return null;
}

function resolveFromRawMetadata(providerId: ProviderId, modelId: string, raw: unknown): ModelContextMetadata | null {
  const found = findContextField(raw);
  if (!found) return null;
  const source: ContextLengthSource =
    found.field === "loaded_context_length" || found.field.endsWith(".loaded_context_length")
      ? "lmstudio-api"
      : providerId === "local" ? "api" : "cli";
  return {
    providerId,
    modelId,
    contextLength: found.value,
    source,
    confidence: "verified",
    raw,
    rawField: found.field,
  };
}

function resolveFromConfig(
  providerId: ProviderId,
  modelId: string,
  providerConfig?: ProviderWorkspaceOverride | null,
): ModelContextMetadata | null {
  const value = providerConfig?.models?.[modelId]?.contextLength;
  if (value === undefined) return null;
  const contextLength = validContextLength(value);
  if (contextLength === null) {
    return {
      providerId,
      modelId,
      contextLength: null,
      source: "unknown",
      confidence: "unknown",
      error: `Invalid configured contextLength for ${modelId}. Expected a positive integer.`,
    };
  }
  return {
    providerId,
    modelId,
    contextLength,
    source: "config",
    confidence: "configured",
  };
}

function resolveFromKnownRegistry(providerId: ProviderId, modelId: string): ModelContextMetadata | null {
  const lookupId = providerId === "anthropic"
    ? (ANTHROPIC_MODEL_ALIAS_MAP[modelId] ?? modelId)
    : modelId;
  const entry = KNOWN_CONTEXT_REGISTRY[`${providerId}:${lookupId}`];
  if (!entry) return null;
  return {
    providerId,
    modelId,
    contextLength: entry.contextLength,
    source: "known-registry",
    confidence: "known",
    raw: {
      sourceUrl: entry.sourceUrl,
      note: entry.note,
    },
  };
}

export async function resolveModelContextLength(
  options: ResolveModelContextLengthOptions,
): Promise<ModelContextMetadata> {
  const key = cacheKey(options);
  const cached = contextCache.get(key);
  if (cached && !(options.rawMetadata !== undefined && cached.source === "unknown")) {
    return cached;
  }

  const rawMetadata = options.rawMetadata ?? null;
  const resolved =
    resolveFromRawMetadata(options.providerId, options.modelId, rawMetadata)
    ?? resolveFromConfig(options.providerId, options.modelId, options.providerConfig)
    ?? resolveFromKnownRegistry(options.providerId, options.modelId)
    ?? unknownMetadata(
      options.providerId,
      options.modelId,
      options.providerId === "local"
        ? "/v1/models did not include context length metadata."
        : "Provider metadata did not include context length.",
    );

  contextCache.set(key, resolved);
  return resolved;
}

export function resolveModelContextLengthCached(
  options: ResolveModelContextLengthOptions,
): ModelContextMetadata {
  const key = cacheKey(options);
  const cached = contextCache.get(key);
  if (cached && !(options.rawMetadata !== undefined && cached.source === "unknown")) return cached;

  const raw = resolveFromRawMetadata(options.providerId, options.modelId, options.rawMetadata);
  if (raw) {
    contextCache.set(key, raw);
    return raw;
  }

  const config = resolveFromConfig(options.providerId, options.modelId, options.providerConfig);
  if (config) {
    contextCache.set(key, config);
    return config;
  }

  const registry = resolveFromKnownRegistry(options.providerId, options.modelId);
  if (registry) {
    contextCache.set(key, registry);
    return registry;
  }

  return unknownMetadata(options.providerId, options.modelId);
}
