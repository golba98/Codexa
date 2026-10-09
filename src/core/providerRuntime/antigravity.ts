import { formatConversationHistory } from "../../session/conversation.js";
import {
  buildSpawnSpec,
  resetAgyExecutableCacheForTests,
  resolveAgyExecutable,
} from "../executables/executableResolver.js";
import type { ReasoningEffortCapability } from "../models/codexModelCapabilities.js";
import { loadCachedProviderModels } from "../models/modelCache.js";
import { providerCatalog } from "../models/modelCatalog.js";
import { runCommand } from "../process/commandRunner.js";
import { createRunControl } from "../providers/runControl.js";
import type { BackendRunHandlers } from "../providers/types.js";
import { errorMessage } from "../shared/values.js";
import { sanitizeTerminalOutput } from "../terminal/terminalSanitize.js";
import type {
  ProviderChatRequest,
  ProviderModel,
  ProviderModelDiscoveryResult,
  ProviderRouteValidationResult,
  ProviderRuntime,
} from "./types.js";

const ANTIGRAVITY_TIMEOUT_MS = 120_000;
const ANTIGRAVITY_VALIDATION_TIMEOUT_MS = 10_000;
const ANTIGRAVITY_ROUTE_SETUP_MESSAGE =
  "`agy` command not found. Install Antigravity CLI or set AGY_EXECUTABLE to the full path.";

export const ANTIGRAVITY_DEFAULT_MODEL_ID = "gemini-3.5-flash";
export const ANTIGRAVITY_DEFAULT_REASONING = "high";

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------

interface AgySelectorMetadata {
  provider: "antigravity";
  selectors: Record<string, string>;
}

function formatAgyVariantLabel(value: string): string {
  return (
    value
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
      .join(" ") || value
  );
}

function readAgySelectorMetadata(model: ProviderModel): AgySelectorMetadata | null {
  if (!model.raw || typeof model.raw !== "object" || Array.isArray(model.raw)) return null;
  const raw = model.raw as Partial<AgySelectorMetadata>;
  if (raw.provider !== "antigravity" || !raw.selectors || typeof raw.selectors !== "object")
    return null;
  return { provider: "antigravity", selectors: raw.selectors };
}

function normalizeAgyId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function preferredAgyDefault(modelId: string, efforts: readonly string[]): string {
  if (
    (modelId === "gemini-3.5-flash" || modelId === "gemini-3.1-pro") &&
    efforts.includes(ANTIGRAVITY_DEFAULT_REASONING)
  ) {
    return ANTIGRAVITY_DEFAULT_REASONING;
  }
  return efforts[0] ?? ANTIGRAVITY_DEFAULT_REASONING;
}

const AGY_REASONING_DISPLAY_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

function sortAgyReasoningLevels(
  levels: readonly ReasoningEffortCapability[],
): ReasoningEffortCapability[] {
  const rank = new Map<string, number>(AGY_REASONING_DISPLAY_ORDER.map((id, index) => [id, index]));
  return levels
    .map((level, index) => ({ level, index }))
    .sort(
      (left, right) =>
        (rank.get(left.level.id) ?? AGY_REASONING_DISPLAY_ORDER.length + left.index) -
        (rank.get(right.level.id) ?? AGY_REASONING_DISPLAY_ORDER.length + right.index),
    )
    .map(({ level }) => level);
}

function parseLegacyAgyModelsOutput(stdout: string): ProviderModel[] {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = lines.map((line) => {
    // Current `agy models` output is a two-column table:
    //   gemini-3.7-flash-high  Gemini 3.7 Flash (High)
    // The first column is the exact CLI selector and the second is display text.
    // Older versions emitted display text only, so retain that as a fallback.
    const columns = line.match(/^(\S+)\s{2,}(.+)$/);
    const selector = columns?.[1] ?? line;
    const label = columns?.[2]?.trim() ?? line;
    const match = label.match(/^(.*?)\s+\(([^()]+)\)$/);
    return {
      selector,
      label,
      base: match?.[1]?.trim() ?? label,
      variant: match?.[2]?.trim() ?? null,
    };
  });
  const baseCounts = new Map<string, number>();
  for (const item of parsed) baseCounts.set(item.base, (baseCounts.get(item.base) ?? 0) + 1);

  const models: ProviderModel[] = [];
  const grouped = new Map<string, ProviderModel>();
  for (const item of parsed) {
    const isVariantGroup = item.variant !== null && (baseCounts.get(item.base) ?? 0) > 1;
    if (!isVariantGroup) {
      const modelId = normalizeAgyId(item.selector);
      models.push({
        id: modelId,
        modelId,
        label: item.label,
        description: `Discovered from agy models: ${item.label}`,
        defaultReasoningLevel: null,
        supportedReasoningLevels: null,
        source: "discovered",
        raw: {
          provider: "antigravity",
          selectors: { "": item.selector },
        } satisfies AgySelectorMetadata,
      });
      continue;
    }

    const effortId = normalizeAgyId(item.variant ?? "");
    const selectorFamily = item.selector.match(new RegExp(`^(.*?)-${effortId}$`, "i"))?.[1];
    const modelId = normalizeAgyId(selectorFamily ?? item.base);
    const existing = grouped.get(item.base);
    if (existing) {
      const metadata = readAgySelectorMetadata(existing);
      const levels = sortAgyReasoningLevels([
        ...(existing.supportedReasoningLevels ?? []),
        {
          id: effortId,
          label: formatAgyVariantLabel(item.variant ?? effortId),
          description: null,
        },
      ]);
      const selectors = { ...(metadata?.selectors ?? {}), [effortId]: item.selector };
      const updated = {
        ...existing,
        defaultReasoningLevel: preferredAgyDefault(
          modelId,
          levels.map((level) => level.id),
        ),
        supportedReasoningLevels: levels,
        raw: { provider: "antigravity", selectors } satisfies AgySelectorMetadata,
      };
      grouped.set(item.base, updated);
      models[models.indexOf(existing)] = updated;
      continue;
    }

    const level: ReasoningEffortCapability = {
      id: effortId,
      label: formatAgyVariantLabel(item.variant ?? effortId),
      description: null,
    };
    const model: ProviderModel = {
      id: modelId,
      modelId,
      label: item.base,
      description: `Discovered from agy models. Select an advertised variant with ←/→.`,
      defaultReasoningLevel: preferredAgyDefault(modelId, [effortId]),
      supportedReasoningLevels: [level],
      source: "discovered",
      raw: {
        provider: "antigravity",
        selectors: { [effortId]: item.selector },
      } satisfies AgySelectorMetadata,
    };
    grouped.set(item.base, model);
    models.push(model);
  }
  return models;
}

/** Parse provider-advertised selectors without rewriting their identities. */
export function parseAgyModelsOutput(stdout: string): ProviderModel[] {
  if (!stdout.split(/\r?\n/).some((line) => /^(\S+)(?:\t+| {2,})(.+)$/.test(line.trim()))) {
    const legacyLines = sanitizeTerminalOutput(stdout)
      .split(/\r?\n/)
      .filter((line) => /^(Gemini|Claude|GPT)[a-z0-9 .()_-]+$/i.test(line.trim()));
    return parseLegacyAgyModelsOutput(legacyLines.join("\n"));
  }
  const models = new Map<string, ProviderModel>();
  for (const line of sanitizeTerminalOutput(stdout).split(/\r?\n/)) {
    const row = line.trim();
    if (!row || /^(?:fetching|available models|model\s+|[-─═]+$)/i.test(row)) continue;
    const columns = row.match(/^(\S+)(?:\t+| {2,})(.+)$/);
    const selector = columns?.[1] ?? row;
    const label = columns?.[2]?.trim() ?? row;
    if (!columns && !/^(?:gemini|claude|gpt|[a-z]+-)[a-z0-9 .()_-]+$/i.test(row)) continue;
    const variant = selector.match(/-(low|medium|high|xhigh|max)$/i)?.[1]?.toLowerCase();
    const levels = variant
      ? [{ id: variant, label: formatAgyVariantLabel(variant), description: null }]
      : null;
    models.set(selector, {
      id: selector,
      modelId: selector,
      label,
      description: null,
      providerId: "antigravity",
      deployment: "remote",
      source: "discovered",
      available: true,
      defaultReasoningLevel: variant ?? null,
      supportedReasoningLevels: levels,
      reasoningControl: variant
        ? { kind: "levels", levels: levels!, default: variant, transport: "variant" }
        : { kind: "unknown" },
      raw: {
        provider: "antigravity",
        selectors: { "": selector, ...(variant ? { [variant]: selector } : {}) },
      } satisfies AgySelectorMetadata,
    });
  }
  return [...models.values()].map((model) => {
    const family = model.modelId.replace(/-(low|medium|high|xhigh|max)$/i, "");
    const siblings = [...models.values()].filter(
      (item) => item.modelId.replace(/-(low|medium|high|xhigh|max)$/i, "") === family,
    );
    if (model.reasoningControl?.kind === "levels" && siblings.length === 1)
      return {
        ...model,
        supportedReasoningLevels: null,
        defaultReasoningLevel: null,
        reasoningControl: { kind: "fixed" as const, label: model.label },
      };
    if (model.reasoningControl?.kind === "levels" && siblings.length > 1) {
      const levels = sortAgyReasoningLevels(
        siblings.flatMap((item) => item.supportedReasoningLevels ?? []),
      );
      const selectors = Object.fromEntries(
        siblings.map((item) => [item.defaultReasoningLevel!, item.modelId]),
      );
      return {
        ...model,
        supportedReasoningLevels: levels,
        reasoningControl: { ...model.reasoningControl, levels },
        raw: { provider: "antigravity" as const, selectors: { "": model.modelId, ...selectors } },
      };
    }
    return model;
  });
}

function normalizeCachedAgyModels(models: readonly ProviderModel[]): readonly ProviderModel[] {
  const legacyRows = models.map((model) => {
    const metadata = readAgySelectorMetadata(model);
    return metadata?.selectors[""] ?? null;
  });
  if (!legacyRows.some((row) => row && /^(\S+)(?:\t+| {2,})(.+)$/.test(row))) return models;

  const normalized = parseAgyModelsOutput(
    legacyRows.filter((row): row is string => Boolean(row)).join("\n"),
  );
  return normalized.length > 0 ? normalized : models;
}

// Resolve persisted model/reasoning state to the exact selector advertised by `agy models`.
export function getAgyModelSelector(
  modelId: string,
  reasoning: string | null | undefined,
  models: readonly ProviderModel[] = getActiveAgyModels(),
): string | null {
  const model = models.find((item) => item.modelId === modelId || item.id === modelId);
  if (!model) return null;
  const metadata = readAgySelectorMetadata(model);
  if (!metadata) return null;
  if (!model.supportedReasoningLevels?.length) return metadata.selectors[""] ?? null;
  if (reasoning) return metadata.selectors[reasoning] ?? null;
  const effort = model.defaultReasoningLevel;
  return effort ? (metadata.selectors[effort] ?? null) : null;
}

export function getAntigravityModelLabel(modelId: string): string {
  const discovered = getActiveAgyModels().find((m) => m.id === modelId || m.modelId === modelId);
  if (discovered) return discovered.label;

  const normalizedId = migrateAntigravityLegacyModelId(modelId).modelId;
  const knownLabels: Record<string, string> = {
    "gemini-3.5-flash": "Gemini 3.5 Flash",
    "gemini-3.1-pro": "Gemini 3.1 Pro",
    "claude-sonnet-4.6-thinking": "Claude Sonnet 4.6 (Thinking)",
    "claude-opus-4.6-thinking": "Claude Opus 4.6 (Thinking)",
    "gpt-oss-120b-medium": "GPT-OSS 120B",
  };
  return knownLabels[normalizedId] ?? modelId;
}

// ---------------------------------------------------------------------------
// Legacy model ID migration
// ---------------------------------------------------------------------------

/**
 * Migrates legacy compound Antigravity model IDs (from feat/antigravity-cli-provider)
 * to the new family + reasoning format.
 *
 * Old IDs encoded effort in the model ID (e.g., "gemini-3.5-flash-high").
 * New IDs use the base family ("gemini-3.5-flash") with reasoning stored separately.
 */
export function migrateAntigravityLegacyModelId(modelId: string): {
  modelId: string;
  reasoning?: string;
} {
  const legacy: Record<string, { modelId: string; reasoning?: string }> = {
    "gemini-3.5-flash-high": { modelId: "gemini-3.5-flash", reasoning: "high" },
    "gemini-3.5-flash-medium": { modelId: "gemini-3.5-flash", reasoning: "medium" },
    "gemini-3.5-flash-low": { modelId: "gemini-3.5-flash", reasoning: "low" },
    "gemini-3.1-pro-high": { modelId: "gemini-3.1-pro", reasoning: "high" },
    "gemini-3.1-pro-low": { modelId: "gemini-3.1-pro", reasoning: "low" },
    "claude-sonnet-4-6-think": { modelId: "claude-sonnet-4.6-thinking" },
    "claude-opus-4-6-think": { modelId: "claude-opus-4.6-thinking" },
    "gpt-oss-120b": { modelId: "gpt-oss-120b-medium" },
  };
  return legacy[modelId] ?? { modelId };
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let agyRouteValidated = false;
let resolvedAgyExecutable: string = "agy";
let discoveredAgyModels: readonly ProviderModel[] | null = null;

function getActiveAgyModels(): readonly ProviderModel[] {
  if (discoveredAgyModels !== null) return discoveredAgyModels;
  return normalizeCachedAgyModels(loadCachedProviderModels("antigravity")?.models ?? []);
}

export async function discoverAgyModels(options: {
  executable: string;
  cwd: string;
  runCommandImpl: typeof runCommand;
  platform: NodeJS.Platform;
  signal?: AbortSignal;
}): Promise<ProviderModelDiscoveryResult> {
  const spawnSpec = buildSpawnSpec(options.executable, ["models"], options.platform);
  const runner = options.runCommandImpl({
    executable: spawnSpec.executable,
    args: spawnSpec.args,
    cwd: options.cwd,
    timeoutMs: ANTIGRAVITY_VALIDATION_TIMEOUT_MS,
  });
  const cancel = () => runner.cancel();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const result = await runner.result.finally(() =>
    options.signal?.removeEventListener("abort", cancel),
  );
  const models =
    result.status === "completed" && result.exitCode === 0
      ? parseAgyModelsOutput(result.stdout)
      : [];
  if (
    result.status === "completed" &&
    result.exitCode === 0 &&
    (models.length > 0 || !result.stdout.trim())
  ) {
    if (!options.signal?.aborted) discoveredAgyModels = models;
    return {
      status: "ready",
      providerId: "antigravity",
      backendKind: "antigravity-cli-auth",
      models,
      message: `Loaded ${models.length} models from agy models.`,
      diagnostics: {
        modelSource: "agy-models-command",
        modelsExitCode: result.exitCode,
        modelsStatus: result.status,
      },
    };
  }
  const cached = normalizeCachedAgyModels(loadCachedProviderModels("antigravity")?.models ?? []);
  return {
    status: cached.length > 0 ? "ready" : "not-configured",
    providerId: "antigravity",
    backendKind: cached.length > 0 ? "antigravity-cli-auth" : "unavailable",
    models: cached,
    freshness: "unverified",
    refreshState: /auth|login|unauthorized|401/i.test(result.stderr) ? "auth-required" : "failed",
    message:
      cached.length > 0
        ? "Live agy model metadata is unavailable; using the last successful discovery."
        : "Antigravity model metadata is unavailable. Run Refresh models after checking `agy models`.",
    diagnostics: {
      modelSource: cached.length > 0 ? "cache" : "unavailable",
      modelsExitCode: result.exitCode,
      modelsStatus: result.status,
    },
  };
}

function isAntigravityRouteConfigured(): boolean {
  return agyRouteValidated;
}

export function resetAntigravityRouteValidationCacheForTests(): void {
  agyRouteValidated = false;
  resolvedAgyExecutable = "agy";
  discoveredAgyModels = null;
  resetAgyExecutableCacheForTests();
}

// ---------------------------------------------------------------------------
// Route validation
// ---------------------------------------------------------------------------

export async function validateAntigravityRoute(options: {
  cwd?: string;
  configuredPath?: string | null;
  runCommandImpl?: typeof runCommand;
  platform?: NodeJS.Platform;
}): Promise<ProviderRouteValidationResult> {
  // Already validated this session: skip the executable probe and model
  // re-discovery so re-activating antigravity is instant. "Refresh models"
  // bypasses this via runtime.refreshModels, so a stale catalog stays
  // user-recoverable.
  if (agyRouteValidated && discoveredAgyModels?.length) {
    return {
      status: "ready",
      providerId: "antigravity",
      backendKind: "antigravity-cli-auth",
      message: `Antigravity CLI found at: ${resolvedAgyExecutable}`,
      diagnostics: {
        resolvedCommand: resolvedAgyExecutable,
        modelSource: "session-cache",
        discoveredModelCount: discoveredAgyModels.length,
      },
    };
  }

  let resolved: string;
  try {
    resolved = await resolveAgyExecutable({
      cwd: options.cwd,
      configuredPath: options.configuredPath,
      runCommandImpl: options.runCommandImpl,
    });
  } catch {
    return {
      status: "not-configured",
      providerId: "antigravity",
      backendKind: "unavailable",
      message: ANTIGRAVITY_ROUTE_SETUP_MESSAGE,
      diagnostics: { resolvedCommand: null },
    };
  }

  // Probe the binary to confirm it's actually installed. Running --help has no
  // auth side effects and exits 0 when agy is present. buildSpawnSpec wraps
  // .cmd/.bat shims in `cmd.exe /d /s /c call` on Windows (no-op elsewhere) so
  // the probe can actually launch the resolved executable.
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const probeSpec = buildSpawnSpec(resolved, ["--help"], options.platform ?? process.platform);
  const probe = runCommandImpl({
    executable: probeSpec.executable,
    args: probeSpec.args,
    cwd: options.cwd ?? process.cwd(),
    timeoutMs: ANTIGRAVITY_VALIDATION_TIMEOUT_MS,
  });
  const probeResult = await probe.result;

  if (probeResult.status === "spawn_error") {
    return {
      status: "not-configured",
      providerId: "antigravity",
      backendKind: "unavailable",
      message: ANTIGRAVITY_ROUTE_SETUP_MESSAGE,
      diagnostics: { resolvedCommand: resolved },
    };
  }

  resolvedAgyExecutable = resolved;
  agyRouteValidated = true;
  const modelDiscovery = await discoverAgyModels({
    executable: resolved,
    cwd: options.cwd ?? process.cwd(),
    runCommandImpl,
    platform: options.platform ?? process.platform,
  });

  return {
    status: "ready",
    providerId: "antigravity",
    backendKind: "antigravity-cli-auth",
    message: `Antigravity CLI found at: ${resolved}`,
    diagnostics: {
      resolvedCommand: resolved,
      modelSource: modelDiscovery.diagnostics?.modelSource ?? "unavailable",
      discoveredModelCount: modelDiscovery.models.length,
    },
  };
}

// ---------------------------------------------------------------------------
// run()
// ---------------------------------------------------------------------------

export function runAntigravityWithRunner(
  request: ProviderChatRequest,
  handlers: BackendRunHandlers,
  runCommandImpl: typeof runCommand = runCommand,
  executable: string = resolvedAgyExecutable,
  platform: NodeJS.Platform = process.platform,
  models: readonly ProviderModel[] = getActiveAgyModels(),
): () => void {
  if (request.modelDescriptor) models = [request.modelDescriptor];
  const selector = getAgyModelSelector(request.route.modelId, request.route.reasoning, models);
  if (!selector) {
    handlers.onError(
      `Antigravity has no verified selector for ${request.route.modelId}${request.route.reasoning ? ` / ${request.route.reasoning}` : ""}. Refresh models and try again.`,
    );
    return () => undefined;
  }
  const prompt = request.conversationHistory?.length
    ? `Previous conversation:\n${formatConversationHistory(request.conversationHistory)}\n\nCurrent request:\n${request.prompt}`
    : request.prompt;
  const selected = models.find(
    (item) => item.modelId === request.route.modelId || item.id === request.route.modelId,
  );
  const effort =
    selected?.reasoningControl?.kind === "levels" &&
    selected.reasoningControl.transport === "parameter" &&
    request.route.reasoning &&
    selected.reasoningControl.levels.some((level) => level.id === request.route.reasoning)
      ? ["--effort", request.route.reasoning]
      : [];
  const spawnSpec = buildSpawnSpec(
    executable,
    ["--model", selector, ...effort, "-p", prompt],
    platform,
  );

  const runner = runCommandImpl({
    executable: spawnSpec.executable,
    args: spawnSpec.args,
    cwd: request.workspaceRoot,
    env: { ...process.env },
    timeoutMs: ANTIGRAVITY_TIMEOUT_MS,
  });

  const control = createRunControl(handlers);
  control.track(runner.stopped ?? runner.result.then(() => undefined));
  runner.result
    .then((result) => {
      control.finish();
      if (result.status === "canceled") return;

      if (result.status !== "completed" || result.exitCode !== 0) {
        const message = result.userMessage || result.stderr || "Antigravity CLI execution failed.";
        handlers.onError(
          message,
          `agy command: ${JSON.stringify([spawnSpec.executable, ...spawnSpec.args])}`,
        );
        return;
      }

      const text = sanitizeTerminalOutput(result.stdout).trim();
      if (text) {
        handlers.onAssistantDelta?.(text);
      }
      handlers.onFinalAnswerObserved?.(text);
      handlers.onResponse(text);
    })
    .catch((error) => {
      control.finish();
      const message = errorMessage(error, "Antigravity CLI execution failed.");
      handlers.onError(message);
    });

  return () => {
    runner.cancel();
    control.finish();
  };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export function applyAgyEffortMetadata(model: ProviderModel, output: string): ProviderModel {
  try {
    const body = JSON.parse(output);
    const data = body.command?.name === "effort" ? body.command.data : null;
    if (data?.adjustable === false)
      return {
        ...model,
        supportedReasoningLevels: null,
        defaultReasoningLevel: null,
        reasoningControl: { kind: "fixed", label: "Thinking (provider-managed)" },
      };
    if (
      data?.adjustable !== true ||
      !Array.isArray(data.available) ||
      !data.available.every((id: unknown) => typeof id === "string" && /^[a-z]+$/.test(id))
    )
      return model;
    const levels = data.available.map((id: string) => ({
      id,
      label: formatAgyVariantLabel(id),
      description: null,
    }));
    if (!levels.length) return model;
    const selected = levels.some((level: ReasoningEffortCapability) => level.id === data.current)
      ? data.current
      : levels[0].id;
    return {
      ...model,
      supportedReasoningLevels: levels,
      defaultReasoningLevel: selected,
      reasoningControl: { kind: "levels", levels, default: selected, transport: "parameter" },
      raw: {
        provider: "antigravity",
        selectors: {
          "": model.modelId,
          ...Object.fromEntries(
            levels.map((level: ReasoningEffortCapability) => [level.id, model.modelId]),
          ),
        },
      },
    };
  } catch {
    return model;
  }
}

export async function resolveAgyReasoningCapability(
  model: ProviderModel,
  options: {
    executable: string;
    cwd: string;
    signal?: AbortSignal;
    runCommandImpl?: typeof runCommand;
  },
): Promise<ProviderModel> {
  if (model.reasoningControl && model.reasoningControl.kind !== "unknown") return model;
  const probe = (options.runCommandImpl ?? runCommand)({
    ...buildSpawnSpec(
      options.executable,
      ["--model", model.modelId, "-p", "/effort", "--output-format", "json"],
      process.platform,
    ),
    cwd: options.cwd,
    timeoutMs: 10_000,
    signal: options.signal,
  });
  const response = await probe.result;
  return !options.signal?.aborted && response.status === "completed" && response.exitCode === 0
    ? applyAgyEffortMetadata(model, response.stdout)
    : model;
}

export const antigravityRuntime: ProviderRuntime = {
  providerId: "antigravity",
  label: "Antigravity CLI",
  modelPickerLabel: "Antigravity",
  backendKind: "antigravity-cli-auth",
  routeAvailable: true,
  routeStatus: "Routes through the Antigravity CLI (`agy`) when installed.",
  routeSetupMessage: ANTIGRAVITY_ROUTE_SETUP_MESSAGE,
  launchAvailable: true,
  isRouteConfigured: isAntigravityRouteConfigured,
  validateRoute: async ({ workspaceRoot, antigravityCommandPath, route }) => {
    const result = await validateAntigravityRoute({
      cwd: workspaceRoot,
      configuredPath: antigravityCommandPath ?? null,
    });
    if (result.status !== "ready") return result;
    const model = (providerCatalog.get("antigravity")?.models ?? getActiveAgyModels()).find(
      (item) => item.modelId === route.modelId,
    );
    if (model && (!model.reasoningControl || model.reasoningControl.kind === "unknown")) {
      const hydrated = await resolveAgyReasoningCapability(model, {
        executable: antigravityCommandPath ?? resolvedAgyExecutable,
        cwd: workspaceRoot,
      });
      if (
        hydrated !== model &&
        providerCatalog.amendModel("antigravity", model.modelId, () => hydrated, model)
      )
        discoveredAgyModels = getActiveAgyModels().map((item) =>
          item.modelId === model.modelId ? hydrated : item,
        );
    }
    return result;
  },
  discoverModels: (): ProviderModelDiscoveryResult => {
    const models = getActiveAgyModels();
    return {
      status: models.length > 0 ? "ready" : "not-configured",
      providerId: "antigravity",
      backendKind: models.length > 0 ? "antigravity-cli-auth" : "unavailable",
      models,
      ...(models.length === 0
        ? { message: "Antigravity model metadata is unavailable. Run Refresh models." }
        : {}),
    };
  },
  refreshModels: async ({ cwd, providerConfig, signal }): Promise<ProviderModelDiscoveryResult> => {
    let executable = resolvedAgyExecutable;
    try {
      executable = await resolveAgyExecutable({
        cwd,
        configuredPath: providerConfig?.antigravityCommandPath,
      });
      resolvedAgyExecutable = executable;
    } catch {
      const cached = normalizeCachedAgyModels(
        loadCachedProviderModels("antigravity")?.models ?? [],
      );
      return {
        status: cached.length > 0 ? "ready" : "not-configured",
        providerId: "antigravity",
        backendKind: cached.length > 0 ? "antigravity-cli-auth" : "unavailable",
        models: cached,
        freshness: "unverified",
        refreshState: "unavailable",
        message:
          cached.length > 0
            ? "Antigravity CLI is unavailable; using the last successful model discovery."
            : ANTIGRAVITY_ROUTE_SETUP_MESSAGE,
        diagnostics: {
          modelSource: cached.length > 0 ? "cache" : "unavailable",
          resolvedCommand: null,
        },
      };
    }
    const result = await discoverAgyModels({
      executable,
      cwd,
      runCommandImpl: runCommand,
      platform: process.platform,
      signal,
    });
    if (result.status !== "ready" || result.freshness === "unverified" || signal?.aborted)
      return result;
    const models = await Promise.all(
      result.models.map(async (model) => {
        if (
          signal?.aborted ||
          (!/\(Thinking\)/i.test(model.label) && model.modelId !== providerConfig?.currentModel)
        )
          return model;
        return resolveAgyReasoningCapability(model, { executable, cwd, signal });
      }),
    );
    if (!signal?.aborted) discoveredAgyModels = models;
    return { ...result, models };
  },
  run: (request: ProviderChatRequest, handlers: BackendRunHandlers) => {
    handlers.onProgress?.({
      id: "antigravity-route",
      source: "stdout",
      text: "Starting Antigravity CLI",
    });
    const control = createRunControl(handlers);
    let cancelled = false;
    let cancelChild: (() => void) | undefined;
    const lookup = resolveAgyExecutable({
      cwd: request.workspaceRoot,
      configuredPath: request.antigravityCommandPath,
    })
      .then((executable) => {
        if (cancelled) {
          control.finish();
          return;
        }
        if (!executable) {
          control.finish();
          handlers.onError(ANTIGRAVITY_ROUTE_SETUP_MESSAGE);
          return;
        }
        cancelChild = runAntigravityWithRunner(
          request,
          {
            ...handlers,
            onRunControl: (child) => {
              control.track(child.stopped);
            },
            onResponse: (text) => {
              control.finish();
              handlers.onResponse(text);
            },
            onError: (message, detail) => {
              control.finish();
              handlers.onError(message, detail);
            },
          },
          runCommand,
          executable,
        );
      })
      .catch((error) => {
        control.finish();
        if (!cancelled) handlers.onError(errorMessage(error));
      });
    control.track(lookup);
    return () => {
      cancelled = true;
      cancelChild?.();
      control.finish();
    };
  },
};
