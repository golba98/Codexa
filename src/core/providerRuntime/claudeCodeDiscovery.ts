import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { buildClaudeSpawnSpec, resolveClaudeExecutable } from "../executables/claudeExecutable.js";
import { runCommand } from "../process/CommandRunner.js";
import type { CommandResult } from "../process/CommandRunner.js";
import type { ReasoningEffortCapability } from "../models/codexModelCapabilities.js";
import { ANTHROPIC_FALLBACK_MODELS } from "./models.js";
import { CLAUDE_CODE_EFFORT_IDS, getClaudeCodeEffortLevels } from "./reasoning.js";
import type { ProviderModel } from "./types.js";

type CommandRunner = typeof runCommand;
export type ClaudeCodeModelSource = "claude-code" | "config" | "settings" | "fallback";

export interface ClaudeCodeAuthInfo {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  subscriptionType?: string;
}

export interface ClaudeCodeModel {
  label: string;
  family: string;
  value: string;
  canonicalId: string;
  source: ClaudeCodeModelSource;
  effortLevels: readonly string[];
  defaultEffort: string;
  effortSource: ClaudeCodeModelSource;
  effortVerified: boolean;
  description?: string;
}

export interface ClaudeCodeCapabilityDiscovery {
  provider: "anthropic";
  backend: "claude-code-cli";
  resolvedCommand: string;
  auth: ClaudeCodeAuthInfo;
  models: ClaudeCodeModel[];
  modelSource: ClaudeCodeModelSource;
  discoveredAt: string;
  settings?: {
    path: string;
    model?: string;
    effortLevel?: string;
    availableModels?: readonly string[];
  };
  diagnostics?: Record<string, string | number | boolean | null>;
}

export interface DiscoverClaudeCodeCapabilitiesOptions {
  cwd: string;
  runCommandImpl?: CommandRunner;
  configuredPath?: string | null;
  settingsPath?: string | null;
  now?: () => Date;
  timeoutMs?: number;
}

interface ClaudeSettingsInfo {
  path: string;
  model?: string;
  effortLevel?: string;
  availableModels?: readonly string[];
  models?: readonly ClaudeCodeModel[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.map(readString).filter((item): item is string => Boolean(item));
  return result.length > 0 ? result : undefined;
}

export function parseClaudeAuthStatus(stdout: string): ClaudeCodeAuthInfo | null {
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (!isRecord(parsed)) return null;
    return {
      loggedIn: parsed["loggedIn"] === true,
      authMethod: readString(parsed["authMethod"]),
      apiProvider: readString(parsed["apiProvider"]),
      subscriptionType: readString(parsed["subscriptionType"]),
    };
  } catch {
    return null;
  }
}

function modelFamilyFromValue(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("opus")) return "opus";
  if (normalized.includes("haiku")) return "haiku";
  return "sonnet";
}

function fallbackModelByFamily(family: string): ProviderModel | undefined {
  return ANTHROPIC_FALLBACK_MODELS.find((model) => model.family === family || model.modelId === family);
}

function fallbackEffortIds(family: string): string[] {
  const fallback = fallbackModelByFamily(family);
  return fallback?.supportedReasoningLevels?.map((level) => level.id) ?? ["low", "medium", "high"];
}

function fallbackDefaultEffort(family: string): string {
  return fallbackModelByFamily(family)?.defaultReasoningLevel ?? "medium";
}

function labelFromModelValue(value: string, fallbackLabel?: string): string {
  if (fallbackLabel) return fallbackLabel;
  const family = modelFamilyFromValue(value);
  const fallback = fallbackModelByFamily(family);
  return fallback?.label ?? value;
}

function normalizeEffortIds(value: unknown, fallbackFamily: string): string[] {
  const fromArray = readStringArray(value)
    ?.filter((item) => CLAUDE_CODE_EFFORT_IDS.has(item));
  return fromArray && fromArray.length > 0 ? fromArray : fallbackEffortIds(fallbackFamily);
}

function normalizeClaudeCodeModel(raw: unknown, source: ClaudeCodeModelSource): ClaudeCodeModel | null {
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return null;
    const family = modelFamilyFromValue(value);
    const fallback = fallbackModelByFamily(family);
    return {
      label: labelFromModelValue(value, fallback?.label),
      family,
      value: fallback?.modelId ?? value,
      canonicalId: fallback?.canonicalId ?? value,
      source,
      effortLevels: fallbackEffortIds(family),
      defaultEffort: fallbackDefaultEffort(family),
      effortSource: "fallback",
      effortVerified: false,
      description: source === "settings" ? "Claude settings model" : undefined,
    };
  }

  if (!isRecord(raw)) return null;
  const value = readString(raw.value ?? raw.model ?? raw.modelId ?? raw.id ?? raw.name);
  if (!value) return null;
  const family = readString(raw.family) ?? modelFamilyFromValue(value);
  const fallback = fallbackModelByFamily(family);
  // Accept both camelCase and snake_case effort field names for compatibility.
  const rawEffortArray = raw.effortLevels ?? raw.effort_levels ?? raw.supportedEfforts ?? raw.supported_efforts;
  const effortLevels = normalizeEffortIds(rawEffortArray, family);
  const defaultEffort = readString(raw.defaultEffort ?? raw.default_effort ?? raw.effortLevel ?? raw.effort_level)
    ?? fallbackDefaultEffort(family);
  const hasRawEffortArray = Array.isArray(rawEffortArray);

  return {
    label: readString(raw.label ?? raw.displayName ?? raw.display_name) ?? labelFromModelValue(value, fallback?.label),
    family,
    value: value === fallback?.canonicalId ? fallback.modelId : value,
    canonicalId: readString(raw.canonicalId ?? raw.canonical_id) ?? fallback?.canonicalId ?? value,
    source,
    effortLevels,
    defaultEffort: effortLevels.includes(defaultEffort) ? defaultEffort : effortLevels[0] ?? "medium",
    effortSource: hasRawEffortArray ? source : "fallback",
    effortVerified: source === "claude-code" && hasRawEffortArray,
    description: readString(raw.description),
  };
}

function dedupeModels(models: ClaudeCodeModel[]): ClaudeCodeModel[] {
  const seen = new Set<string>();
  const result: ClaudeCodeModel[] = [];
  for (const model of models) {
    const key = model.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
  }
  return result;
}

function fallbackClaudeModels(): ClaudeCodeModel[] {
  return ANTHROPIC_FALLBACK_MODELS.map((model) => ({
    label: model.label,
    family: model.family ?? model.modelId,
    value: model.modelId,
    canonicalId: model.canonicalId ?? model.modelId,
    source: "fallback",
    effortLevels: model.supportedReasoningLevels?.map((level) => level.id) ?? [],
    defaultEffort: model.defaultReasoningLevel ?? "medium",
    effortSource: "fallback",
    effortVerified: false,
    description: model.description ?? undefined,
  }));
}

function applyAvailableModelAllowlist(models: ClaudeCodeModel[], allowlist: readonly string[] | undefined): ClaudeCodeModel[] {
  if (!allowlist || allowlist.length === 0) return models;
  const allowed = new Set(allowlist.map((item) => item.toLowerCase()));
  const filtered = models.filter((model) =>
    allowed.has(model.value.toLowerCase()) ||
    allowed.has(model.family.toLowerCase()) ||
    allowed.has(model.canonicalId.toLowerCase()) ||
    allowed.has(model.label.toLowerCase())
  );
  return filtered.length > 0 ? filtered : models;
}

function defaultClaudeSettingsPath(): string | null {
  const home = process.env.USERPROFILE ?? process.env.HOME;
  return home ? join(home, ".claude", "settings.json") : null;
}

function readClaudeSettings(settingsPath: string | null | undefined): ClaudeSettingsInfo | null {
  const path = settingsPath === undefined ? defaultClaudeSettingsPath() : settingsPath;
  if (!path || !existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isRecord(parsed)) return null;
    // Accept both camelCase and snake_case field names — Claude settings.json has used both across versions.
    const availableModels = readStringArray(parsed.availableModels ?? parsed.available_models);
    const modelOverrides = parsed.modelOverrides ?? parsed.model_overrides;
    const overrideModels = isRecord(modelOverrides)
      ? Object.entries(modelOverrides)
          .map(([key, value]) => normalizeClaudeCodeModel(
            isRecord(value) ? { id: key, ...value } : key,
            "settings",
          ))
          .filter((model): model is ClaudeCodeModel => Boolean(model))
      : [];
    return {
      path,
      model: readString(parsed.model ?? parsed.defaultModel ?? parsed.default_model),
      effortLevel: readString(parsed.effortLevel ?? parsed.effort_level),
      availableModels,
      models: overrideModels,
    };
  } catch {
    return null;
  }
}

async function runClaudeCommand(
  executable: string,
  args: string[],
  cwd: string,
  runCommandImpl: CommandRunner,
  timeoutMs: number,
): Promise<CommandResult> {
  const spawnSpec = buildClaudeSpawnSpec(executable, args);
  return await runCommandImpl({
    executable: spawnSpec.executable,
    args: spawnSpec.args,
    cwd,
    timeoutMs,
  }).result;
}

function parseModelsFromJsonOutput(stdout: string): ClaudeCodeModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return [];
  }
  const rawModels = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.models)
      ? parsed.models
      : isRecord(parsed) && Array.isArray(parsed.data)
        ? parsed.data
        : [];
  return dedupeModels(
    rawModels
      .map((raw) => normalizeClaudeCodeModel(raw, "claude-code"))
      .filter((model): model is ClaudeCodeModel => Boolean(model)),
  );
}

// Claude Code CLI does not consistently advertise JSON model listing in its help text,
// so we probe these well-known command shapes directly first, before falling back to
// help-text analysis. Each probe fails fast (non-zero exit) if unsupported.
const PROBE_MODEL_LIST_ARGS: string[][] = [
  ["model", "list", "--json"],
  ["models", "--json"],
  ["models", "list", "--json"],
];

function candidateModelListArgs(helpOutput: string): string[][] {
  const text = helpOutput.toLowerCase();
  const candidates: string[][] = [];
  if (/model\s+list/.test(text) && /--json/.test(text)) {
    candidates.push(["model", "list", "--json"]);
  }
  if (/models\s+list/.test(text) && /--json/.test(text)) {
    candidates.push(["models", "list", "--json"]);
  }
  if (/\bmodels\b/.test(text) && /--json/.test(text)) {
    candidates.push(["models", "--json"]);
  }
  return candidates;
}

async function discoverModelsFromClaudeHelp(
  executable: string,
  cwd: string,
  runCommandImpl: CommandRunner,
  timeoutMs: number,
): Promise<ClaudeCodeModel[]> {
  // Step 1: try well-known command shapes directly, without requiring the help text
  // to advertise them. Claude Code CLI versions vary in whether (and how) they expose
  // a model list command — probing directly is more reliable than help-text detection.
  const triedArgKeys = new Set<string>();
  for (const args of PROBE_MODEL_LIST_ARGS) {
    triedArgKeys.add(args.join("\0"));
    const result = await runClaudeCommand(executable, args, cwd, runCommandImpl, timeoutMs);
    if (result.status === "completed" && result.exitCode === 0) {
      const models = parseModelsFromJsonOutput(result.stdout);
      if (models.length > 0) return models;
    }
  }

  // Step 2: fall through to help-text-based detection as a supplementary strategy
  // for future Claude Code versions that advertise additional model-list commands.
  const helpResults = await Promise.all([
    runClaudeCommand(executable, ["--help"], cwd, runCommandImpl, timeoutMs),
    runClaudeCommand(executable, ["model", "--help"], cwd, runCommandImpl, timeoutMs),
  ]);
  const candidates = helpResults.flatMap((result) =>
    result.status === "completed" && result.exitCode === 0
      ? candidateModelListArgs(`${result.stdout}\n${result.stderr}`)
      : []
  );

  for (const args of candidates) {
    if (triedArgKeys.has(args.join("\0"))) continue; // skip already-probed commands
    const result = await runClaudeCommand(executable, args, cwd, runCommandImpl, timeoutMs);
    if (result.status !== "completed" || result.exitCode !== 0) continue;
    const models = parseModelsFromJsonOutput(result.stdout);
    if (models.length > 0) return models;
  }
  return [];
}

export function claudeCodeModelsToProviderModels(models: readonly ClaudeCodeModel[]): readonly ProviderModel[] {
  return models.map((model) => ({
    id: model.value,
    modelId: model.value,
    label: model.label,
    description: model.description ?? (
      model.source === "fallback"
        ? `${model.label} - Fallback defaults${model.effortVerified ? "" : "; effort metadata unverified"}`
        : `${model.label} - ${model.source === "claude-code" ? "Discovered from Claude Code" : "From Claude settings"}`
    ),
    defaultReasoningLevel: model.defaultEffort,
    supportedReasoningLevels: getClaudeCodeEffortLevels(model.effortLevels),
    source: model.source,
    canonicalId: model.canonicalId,
    family: model.family,
    effortSource: model.effortSource,
    effortVerified: model.effortVerified,
  }));
}

export async function discoverClaudeCodeCapabilities(
  options: DiscoverClaudeCodeCapabilitiesOptions,
): Promise<ClaudeCodeCapabilityDiscovery> {
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const resolvedCommand = await resolveClaudeExecutable({
    runCommandImpl: options.runCommandImpl,
    cwd: options.cwd,
    configuredPath: options.configuredPath,
  });

  const authResult = await runClaudeCommand(resolvedCommand, ["auth", "status"], options.cwd, runCommandImpl, timeoutMs);
  const authJson = authResult.status === "completed" && authResult.exitCode === 0
    ? parseClaudeAuthStatus(authResult.stdout)
    : null;
  const auth: ClaudeCodeAuthInfo = authJson?.loggedIn === true
    ? authJson
    : { loggedIn: false };

  const settings = readClaudeSettings(options.settingsPath);
  const discoveredModels = await discoverModelsFromClaudeHelp(resolvedCommand, options.cwd, runCommandImpl, timeoutMs);

  let modelSource: ClaudeCodeModelSource = "fallback";
  let models: ClaudeCodeModel[] = fallbackClaudeModels();

  if (discoveredModels.length > 0) {
    modelSource = "claude-code";
    models = discoveredModels;
  } else if (settings?.models && settings.models.length > 0) {
    modelSource = "settings";
    models = [...settings.models];
  } else if (settings?.availableModels && settings.availableModels.length > 0) {
    modelSource = "settings";
    models = settings.availableModels
      .map((model) => normalizeClaudeCodeModel(model, "settings"))
      .filter((model): model is ClaudeCodeModel => Boolean(model));
  }

  if (settings?.model && !models.some((model) =>
    model.value === settings.model || model.canonicalId === settings.model || model.family === settings.model
  )) {
    const settingsModel = normalizeClaudeCodeModel(settings.model, "settings");
    if (settingsModel) {
      models = [settingsModel, ...models];
      if (modelSource === "fallback") modelSource = "settings";
    }
  }

  models = applyAvailableModelAllowlist(dedupeModels(models), settings?.availableModels);

  return {
    provider: "anthropic",
    backend: "claude-code-cli",
    resolvedCommand,
    auth,
    models,
    modelSource,
    discoveredAt: (options.now?.() ?? new Date()).toISOString(),
    ...(settings ? {
      settings: {
        path: settings.path,
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effortLevel ? { effortLevel: settings.effortLevel } : {}),
        ...(settings.availableModels ? { availableModels: settings.availableModels } : {}),
      },
    } : {}),
    diagnostics: {
      authExitCode: authResult.exitCode,
      authStatus: authResult.status,
      authJsonParsed: authJson !== null,
      loggedIn: auth.loggedIn,
      modelSource,
      settingsPath: settings?.path ?? null,
    },
  };
}

export function getClaudeModelDefaultEffort(modelId: string, models: readonly ProviderModel[]): string {
  const normalized = modelId.toLowerCase();
  const model = models.find((item) =>
    item.modelId.toLowerCase() === normalized ||
    item.id.toLowerCase() === normalized ||
    item.family?.toLowerCase() === normalized ||
    item.canonicalId?.toLowerCase() === normalized ||
    (item.family ? normalized.includes(item.family.toLowerCase()) : false)
  );
  return model?.defaultReasoningLevel ?? "medium";
}

export function modelSupportsClaudeEffort(modelId: string, effort: string | null | undefined, models: readonly ProviderModel[]): boolean {
  if (!effort) return false;
  const normalized = modelId.toLowerCase();
  const model = models.find((item) =>
    item.modelId.toLowerCase() === normalized ||
    item.id.toLowerCase() === normalized ||
    item.family?.toLowerCase() === normalized ||
    item.canonicalId?.toLowerCase() === normalized ||
    (item.family ? normalized.includes(item.family.toLowerCase()) : false)
  );
  return Boolean(model?.supportedReasoningLevels?.some((level) => level.id === effort));
}
