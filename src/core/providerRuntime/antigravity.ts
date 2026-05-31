import { runCommand } from "../process/CommandRunner.js";
import { sanitizeTerminalOutput } from "../terminal/terminalSanitize.js";
import type { ReasoningEffortCapability } from "../models/codexModelCapabilities.js";
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
  buildAgySpawnSpec,
  resetAgyExecutableCacheForTests,
} from "../executables/antigravityExecutable.js";

export { resetAgyExecutableCacheForTests };

const ANTIGRAVITY_TIMEOUT_MS = 120_000;
const ANTIGRAVITY_VALIDATION_TIMEOUT_MS = 10_000;
const ANTIGRAVITY_ROUTE_SETUP_MESSAGE =
  "`agy` command not found. Install Antigravity CLI or set AGY_EXECUTABLE to the full path.";

export const ANTIGRAVITY_DEFAULT_MODEL_ID = "gemini-3.5-flash";
export const ANTIGRAVITY_DEFAULT_REASONING = "high";

// ---------------------------------------------------------------------------
// Effort levels for Antigravity Gemini models
// ---------------------------------------------------------------------------

const AGY_LOW:    ReasoningEffortCapability = { id: "low",    label: "Low",    description: null };
const AGY_MEDIUM: ReasoningEffortCapability = { id: "medium", label: "Medium", description: null };
const AGY_HIGH:   ReasoningEffortCapability = { id: "high",   label: "High",   description: null };

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------

export const ANTIGRAVITY_MODELS: readonly ProviderModel[] = [
  {
    id: "gemini-3.5-flash",
    modelId: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    description: "Antigravity-routed Gemini 3.5 Flash. Select effort with ←/→.",
    defaultReasoningLevel: "high",
    supportedReasoningLevels: [AGY_LOW, AGY_MEDIUM, AGY_HIGH],
    source: "fallback",
  },
  {
    id: "gemini-3.1-pro",
    modelId: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    description: "Antigravity-routed Gemini 3.1 Pro. Select effort with ←/→.",
    defaultReasoningLevel: "high",
    supportedReasoningLevels: [AGY_LOW, AGY_HIGH],
    source: "fallback",
  },
  {
    id: "claude-sonnet-4-6-think",
    modelId: "claude-sonnet-4-6-think",
    label: "Claude Sonnet 4.6 (Thinking)",
    description: "Antigravity-routed Claude Sonnet 4.6 with extended thinking.",
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
    source: "fallback",
  },
  {
    id: "claude-opus-4-6-think",
    modelId: "claude-opus-4-6-think",
    label: "Claude Opus 4.6 (Thinking)",
    description: "Antigravity-routed Claude Opus 4.6 with extended thinking.",
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
    source: "fallback",
  },
  {
    id: "gpt-oss-120b",
    modelId: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    description: "Antigravity-routed GPT-OSS 120B.",
    defaultReasoningLevel: null,
    supportedReasoningLevels: null,
    source: "fallback",
  },
];

// ---------------------------------------------------------------------------
// AGY_MODEL env mapping
// ---------------------------------------------------------------------------

/**
 * Maps Codexa model IDs to the AGY_MODEL env value passed to the agy subprocess.
 *
 * Verified:
 *   gemini-3.5-flash → "gemini-3.5-flash"  (confirmed via: AGY_MODEL=gemini-3.5-flash agy -p "say hello back")
 *
 * Unverified (same pattern, not independently smoke-tested):
 *   gemini-3.1-pro → "gemini-3.1-pro"
 */
const AGY_MODEL_ENV_MAP: Readonly<Record<string, string>> = {
  "gemini-3.5-flash": "gemini-3.5-flash",
  "gemini-3.1-pro":   "gemini-3.1-pro",
};

export function getAgyModelEnvValue(modelId: string): string | null {
  return AGY_MODEL_ENV_MAP[modelId] ?? null;
}

export function buildAgyEnv(modelId: string, _reasoning?: string): NodeJS.ProcessEnv {
  // _reasoning is stored in route state and surfaced in the footer UI, but agy
  // has no verified CLI flag or env var for passing effort level to the subprocess.
  // TODO: wire _reasoning here once Antigravity exposes a stable mechanism.
  const envValue = getAgyModelEnvValue(modelId);
  return envValue ? { ...process.env, AGY_MODEL: envValue } : { ...process.env };
}

export function getAntigravityModelLabel(modelId: string): string {
  return ANTIGRAVITY_MODELS.find((m) => m.id === modelId)?.label ?? modelId;
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
    "gpt-oss-120b-medium":     { modelId: "gpt-oss-120b" },
  };
  return legacy[modelId] ?? { modelId };
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let agyRouteValidated = false;
let resolvedAgyExecutable: string = "agy";

export function isAntigravityRouteConfigured(): boolean {
  return agyRouteValidated;
}

export function resetAntigravityRouteValidationCacheForTests(): void {
  agyRouteValidated = false;
  resolvedAgyExecutable = "agy";
  resetAgyExecutableCacheForTests();
}

// ---------------------------------------------------------------------------
// Route validation
// ---------------------------------------------------------------------------

export async function validateAntigravityRoute(options: {
  cwd?: string;
  configuredPath?: string | null;
  runCommandImpl?: typeof runCommand;
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
  // auth side effects and exits 0 when agy is present.
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const probe = runCommandImpl({
    executable: resolved,
    args: ["--help"],
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

  return {
    status: "ready",
    providerId: "antigravity",
    backendKind: "antigravity-cli-auth",
    message: `Antigravity CLI found at: ${resolved}`,
    diagnostics: { resolvedCommand: resolved },
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
): () => void {
  const spawnSpec = buildAgySpawnSpec(executable, ["-p", request.prompt]);
  const env = buildAgyEnv(request.route.modelId, request.route.reasoning);

  const runner = runCommandImpl(
    {
      executable: spawnSpec.executable,
      args: spawnSpec.args,
      cwd: request.workspaceRoot,
      env,
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
  discoverModels: (): ProviderModelDiscoveryResult => ({
    status: "ready",
    providerId: "antigravity",
    backendKind: agyRouteValidated ? "antigravity-cli-auth" : "antigravity-cli-auth",
    models: ANTIGRAVITY_MODELS,
  }),
  run: (request: ProviderChatRequest, handlers: BackendRunHandlers) => {
    handlers.onProgress?.({
      id: "antigravity-route",
      source: "stdout",
      text: "Starting Antigravity CLI",
    });
    return runAntigravityWithRunner(request, handlers);
  },
};
