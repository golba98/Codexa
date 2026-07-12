import { runCommand } from "../process/CommandRunner.js";
import { sanitizeTerminalOutput } from "../terminal/terminalSanitize.js";
import type { ReasoningEffortCapability } from "../models/codexModelCapabilities.js";
import { loadCachedProviderModels } from "../models/providerModelCache.js";
import type { BackendRunHandlers } from "../providers/types.js";
import type {
  ProviderBackendKind,
  ProviderChatRequest,
  ProviderModel,
  ProviderModelDiscoveryResult,
  ProviderRouteValidationResult,
  ProviderRuntime,
} from "./types.js";
import {
  resolveAgyExecutable,
  resetAgyExecutableCacheForTests,
} from "../executables/antigravityExecutable.js";
import { buildSpawnSpec } from "../executables/executableResolver.js";

export { resetAgyExecutableCacheForTests };

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

function normalizeAgyId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatAgyVariantLabel(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ") || value;
}

function readAgySelectorMetadata(model: ProviderModel): AgySelectorMetadata | null {
  if (!model.raw || typeof model.raw !== "object" || Array.isArray(model.raw)) return null;
  const raw = model.raw as Partial<AgySelectorMetadata>;
  if (raw.provider !== "antigravity" || !raw.selectors || typeof raw.selectors !== "object") return null;
  return { provider: "antigravity", selectors: raw.selectors };
}

function preferredAgyDefault(modelId: string, efforts: readonly string[]): string {
  if ((modelId === "gemini-3.5-flash" || modelId === "gemini-3.1-pro") && efforts.includes(ANTIGRAVITY_DEFAULT_REASONING)) {
    return ANTIGRAVITY_DEFAULT_REASONING;
  }
  return efforts[0] ?? ANTIGRAVITY_DEFAULT_REASONING;
}

export function parseAgyModelsOutput(stdout: string): ProviderModel[] {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed = lines.map((selector) => {
    const match = selector.match(/^(.*?)\s+\(([^()]+)\)$/);
    return { selector, base: match?.[1]?.trim() ?? selector, variant: match?.[2]?.trim() ?? null };
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
        label: item.selector,
        description: `Discovered from agy models: ${item.selector}`,
        defaultReasoningLevel: null,
        supportedReasoningLevels: null,
        source: "discovered",
        raw: { provider: "antigravity", selectors: { "": item.selector } } satisfies AgySelectorMetadata,
      });
      continue;
    }

    const modelId = normalizeAgyId(item.base);
    const effortId = normalizeAgyId(item.variant ?? "");
    const existing = grouped.get(item.base);
    if (existing) {
      const metadata = readAgySelectorMetadata(existing);
      const levels = [...(existing.supportedReasoningLevels ?? []), {
        id: effortId,
        label: formatAgyVariantLabel(item.variant ?? effortId),
        description: null,
      }];
      const selectors = { ...(metadata?.selectors ?? {}), [effortId]: item.selector };
      const updated = {
        ...existing,
        defaultReasoningLevel: preferredAgyDefault(modelId, levels.map((level) => level.id)),
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
      raw: { provider: "antigravity", selectors: { [effortId]: item.selector } } satisfies AgySelectorMetadata,
    };
    grouped.set(item.base, model);
    models.push(model);
  }
  return models;
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
  return effort ? metadata.selectors[effort] ?? null : null;
}

export function getAntigravityModelLabel(modelId: string): string {
  return getActiveAgyModels().find((m) => m.id === modelId)?.label ?? modelId;
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
export function migrateAntigravityLegacyModelId(modelId: string): { modelId: string; reasoning?: string } {
  const legacy: Record<string, { modelId: string; reasoning?: string }> = {
    "gemini-3.5-flash-high":   { modelId: "gemini-3.5-flash", reasoning: "high" },
    "gemini-3.5-flash-medium": { modelId: "gemini-3.5-flash", reasoning: "medium" },
    "gemini-3.5-flash-low":    { modelId: "gemini-3.5-flash", reasoning: "low" },
    "gemini-3.1-pro-high":     { modelId: "gemini-3.1-pro",   reasoning: "high" },
    "gemini-3.1-pro-low":      { modelId: "gemini-3.1-pro",   reasoning: "low" },
    "claude-sonnet-4-6-think": { modelId: "claude-sonnet-4.6-thinking" },
    "claude-opus-4-6-think":   { modelId: "claude-opus-4.6-thinking" },
    "gpt-oss-120b":            { modelId: "gpt-oss-120b-medium" },
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
  if (discoveredAgyModels?.length) return discoveredAgyModels;
  return loadCachedProviderModels("antigravity")?.models ?? [];
}

export async function discoverAgyModels(options: {
  executable: string;
  cwd: string;
  runCommandImpl: typeof runCommand;
  platform: NodeJS.Platform;
}): Promise<ProviderModelDiscoveryResult> {
  const spawnSpec = buildSpawnSpec(options.executable, ["models"], options.platform);
  const result = await options.runCommandImpl({
    executable: spawnSpec.executable,
    args: spawnSpec.args,
    cwd: options.cwd,
    timeoutMs: ANTIGRAVITY_VALIDATION_TIMEOUT_MS,
  }).result;
  const models = result.status === "completed" && result.exitCode === 0
    ? parseAgyModelsOutput(result.stdout)
    : [];
  if (models.length > 0) {
    discoveredAgyModels = models;
    return {
      status: "ready",
      providerId: "antigravity",
      backendKind: "antigravity-cli-auth",
      models,
      message: `Loaded ${models.length} models from agy models.`,
      diagnostics: { modelSource: "agy-models-command", modelsExitCode: result.exitCode, modelsStatus: result.status },
    };
  }
  const cached = loadCachedProviderModels("antigravity")?.models ?? [];
  return {
    status: cached.length > 0 ? "ready" : "not-configured",
    providerId: "antigravity",
    backendKind: cached.length > 0 ? "antigravity-cli-auth" : "unavailable",
    models: cached,
    message: cached.length > 0
      ? "Live agy model metadata is unavailable; using the last successful discovery."
      : "Antigravity model metadata is unavailable. Run Refresh models after checking `agy models`.",
    diagnostics: { modelSource: cached.length > 0 ? "cache" : "unavailable", modelsExitCode: result.exitCode, modelsStatus: result.status },
  };
}

export function isAntigravityRouteConfigured(): boolean {
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
  const selector = getAgyModelSelector(request.route.modelId, request.route.reasoning, models);
  if (!selector) {
    handlers.onError(
      `Antigravity has no verified selector for ${request.route.modelId}${request.route.reasoning ? ` / ${request.route.reasoning}` : ""}. Refresh models and try again.`,
    );
    return () => undefined;
  }
  const spawnSpec = buildSpawnSpec(executable, ["--model", selector, "-p", request.prompt], platform);

  const runner = runCommandImpl(
    {
      executable: spawnSpec.executable,
      args: spawnSpec.args,
      cwd: request.workspaceRoot,
      env: { ...process.env },
      timeoutMs: ANTIGRAVITY_TIMEOUT_MS,
    },
  );

  runner.result.then((result) => {
    if (result.status === "canceled") return;

    if (result.status !== "completed" || result.exitCode !== 0) {
      const message = result.userMessage || result.stderr || "Antigravity CLI execution failed.";
      handlers.onError(message, `agy command: ${JSON.stringify([spawnSpec.executable, ...spawnSpec.args])}`);
      return;
    }

    const text = sanitizeTerminalOutput(result.stdout).trim();
    if (text) {
      handlers.onAssistantDelta?.(text);
    }
    handlers.onFinalAnswerObserved?.(text);
    handlers.onResponse(text);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "Antigravity CLI execution failed.";
    handlers.onError(message);
  });

  return runner.cancel;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

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
  validateRoute: async ({ workspaceRoot, antigravityCommandPath }) => validateAntigravityRoute({
    cwd: workspaceRoot,
    configuredPath: antigravityCommandPath ?? null,
  }),
  discoverModels: (): ProviderModelDiscoveryResult => {
    const models = getActiveAgyModels();
    return {
      status: models.length > 0 ? "ready" : "not-configured",
      providerId: "antigravity",
      backendKind: models.length > 0 ? "antigravity-cli-auth" : "unavailable",
      models,
      ...(models.length === 0 ? { message: "Antigravity model metadata is unavailable. Run Refresh models." } : {}),
    };
  },
  refreshModels: async ({ cwd }): Promise<ProviderModelDiscoveryResult> => {
    let executable = resolvedAgyExecutable;
    try {
      executable = await resolveAgyExecutable({ cwd });
      resolvedAgyExecutable = executable;
    } catch {
      const cached = loadCachedProviderModels("antigravity")?.models ?? [];
      return {
        status: cached.length > 0 ? "ready" : "not-configured",
        providerId: "antigravity",
        backendKind: cached.length > 0 ? "antigravity-cli-auth" : "unavailable",
        models: cached,
        message: cached.length > 0
          ? "Antigravity CLI is unavailable; using the last successful model discovery."
          : ANTIGRAVITY_ROUTE_SETUP_MESSAGE,
        diagnostics: { modelSource: cached.length > 0 ? "cache" : "unavailable", resolvedCommand: null },
      };
    }
    return discoverAgyModels({ executable, cwd, runCommandImpl: runCommand, platform: process.platform });
  },
  run: (request: ProviderChatRequest, handlers: BackendRunHandlers) => {
    handlers.onProgress?.({
      id: "antigravity-route",
      source: "stdout",
      text: "Starting Antigravity CLI",
    });
    return runAntigravityWithRunner(request, handlers);
  },
};
