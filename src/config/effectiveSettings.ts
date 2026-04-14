import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createDefaultSettings, loadSettings, type AppSettings } from "./persistence.js";
import {
  CODEX_CONFIG_DIR,
  CODEX_CONFIG_FILE_NAME,
  GLOBAL_CODEX_CONFIG_FILE,
  LAUNCH_ARGS_ENV,
  formatRuntimePolicySummary,
  isApprovalPolicy,
  isAvailableModel,
  isReasoningLevel,
  isSandboxMode,
  normalizeReasoningForModel,
  type CodexApprovalPolicy,
  type CodexSandboxMode,
  type RuntimePolicy,
} from "./settings.js";

export type ResolvedFieldSource =
  | "default"
  | "persisted"
  | "global-config"
  | "project-config"
  | "launch-override";

export interface LaunchOverrides {
  model?: string;
  reasoningLevel?: string;
  approvalPolicy?: string;
  sandboxMode?: string;
}

export interface EffectiveSettingsDebugInfo {
  loadedLayers: string[];
  warnings: string[];
  fieldSources: {
    model: ResolvedFieldSource;
    reasoningLevel: ResolvedFieldSource;
    approvalPolicy: ResolvedFieldSource;
    sandboxMode: ResolvedFieldSource;
  };
}

export interface ResolvedAppBootstrap {
  effectiveSettings: AppSettings;
  persistedSettings: AppSettings;
  debug: EffectiveSettingsDebugInfo;
}

export interface ResolveEffectiveSettingsOptions {
  workspaceRoot: string;
  env?: Record<string, string | undefined>;
  launchArgs?: string[];
  settingsFile?: string;
  globalConfigPath?: string;
  projectConfigPath?: string;
}

interface ParsedConfigLayer {
  model?: string;
  reasoningLevel?: string;
  approvalPolicy?: string;
  sandboxMode?: string;
}

interface ParsedTomlLayerResult {
  values: ParsedConfigLayer;
  warnings: string[];
}

interface BunTomlApi {
  parse: (input: string) => unknown;
}

function getTomlParser(): BunTomlApi["parse"] | null {
  const bun = globalThis as typeof globalThis & {
    Bun?: {
      TOML?: BunTomlApi;
    };
  };

  return typeof bun.Bun?.TOML?.parse === "function"
    ? bun.Bun.TOML.parse.bind(bun.Bun.TOML)
    : null;
}

export function parseLaunchArgsEnv(raw: string | undefined): string[] {
  const value = raw?.trim();
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Ignore malformed env and fall back to no launch args.
  }

  return [];
}

export function parseLaunchOverrides(args: readonly string[]): {
  overrides: LaunchOverrides;
  warnings: string[];
} {
  const overrides: LaunchOverrides = {};
  const warnings: string[] = [];

  const consumeValue = (arg: string, nextArg: string | undefined, indexRef: { index: number }): string | null => {
    const equalsIndex = arg.indexOf("=");
    if (equalsIndex >= 0) {
      return arg.slice(equalsIndex + 1);
    }

    if (nextArg === undefined) {
      warnings.push(`Ignored ${arg} because it did not include a value.`);
      return null;
    }

    indexRef.index += 1;
    return nextArg;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextArg = args[index + 1];
    const indexRef = { index };

    if (arg === "--model" || arg.startsWith("--model=") || arg === "-m") {
      const value = consumeValue(arg, nextArg, indexRef);
      if (value) overrides.model = value.trim();
      index = indexRef.index;
      continue;
    }

    if (arg === "--sandbox" || arg.startsWith("--sandbox=")) {
      const value = consumeValue(arg, nextArg, indexRef);
      if (value) overrides.sandboxMode = value.trim();
      index = indexRef.index;
      continue;
    }

    if (arg === "--ask-for-approval" || arg.startsWith("--ask-for-approval=") || arg === "-a") {
      const value = consumeValue(arg, nextArg, indexRef);
      if (value) overrides.approvalPolicy = value.trim();
      index = indexRef.index;
      continue;
    }

    if (arg === "--config" || arg.startsWith("--config=") || arg === "-c") {
      const value = consumeValue(arg, nextArg, indexRef);
      index = indexRef.index;
      if (!value) continue;

      const separatorIndex = value.indexOf("=");
      if (separatorIndex < 0) {
        warnings.push(`Ignored launch override "${value}" because it was not in key=value format.`);
        continue;
      }

      const key = value.slice(0, separatorIndex).trim();
      const overrideValue = value.slice(separatorIndex + 1).trim();
      switch (key) {
        case "model":
          overrides.model = overrideValue;
          break;
        case "model_reasoning_effort":
          overrides.reasoningLevel = overrideValue;
          break;
        case "approval_policy":
          overrides.approvalPolicy = overrideValue;
          break;
        case "sandbox_mode":
          overrides.sandboxMode = overrideValue;
          break;
        default:
          warnings.push(`Ignored unsupported launch override key "${key}".`);
          break;
      }
    }
  }

  return { overrides, warnings };
}

function parseTomlLayer(path: string): ParsedTomlLayerResult {
  const warnings: string[] = [];
  const parseToml = getTomlParser();

  if (!existsSync(path)) {
    return { values: {}, warnings };
  }

  if (!parseToml) {
    warnings.push(`Skipped ${path} because TOML parsing is unavailable in this runtime.`);
    return { values: {}, warnings };
  }

  try {
    const text = readFileSync(path, "utf-8");
    const parsed = parseToml(text) as Record<string, unknown>;

    return {
      values: {
        model: typeof parsed.model === "string" ? parsed.model : undefined,
        reasoningLevel: typeof parsed.model_reasoning_effort === "string" ? parsed.model_reasoning_effort : undefined,
        approvalPolicy: typeof parsed.approval_policy === "string" ? parsed.approval_policy : undefined,
        sandboxMode: typeof parsed.sandbox_mode === "string" ? parsed.sandbox_mode : undefined,
      },
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Skipped ${path} because it could not be parsed: ${message}`);
    return { values: {}, warnings };
  }
}

function applyLayerValue(
  key: keyof ParsedConfigLayer,
  value: string | undefined,
  source: Exclude<ResolvedFieldSource, "default" | "persisted">,
  effectiveSettings: AppSettings,
  fieldSources: EffectiveSettingsDebugInfo["fieldSources"],
  warnings: string[],
) {
  if (!value) return;

  switch (key) {
    case "model":
      if (isAvailableModel(value)) {
        effectiveSettings.model = value;
        effectiveSettings.reasoningLevel = normalizeReasoningForModel(value, effectiveSettings.reasoningLevel);
        fieldSources.model = source;
        if (fieldSources.reasoningLevel === "default" || fieldSources.reasoningLevel === "persisted") {
          fieldSources.reasoningLevel = source;
        }
      } else {
        warnings.push(`Ignored invalid ${source} model "${value}".`);
      }
      break;
    case "reasoningLevel":
      if (isReasoningLevel(value)) {
        effectiveSettings.reasoningLevel = normalizeReasoningForModel(effectiveSettings.model, value);
        fieldSources.reasoningLevel = source;
      } else {
        warnings.push(`Ignored invalid ${source} model_reasoning_effort "${value}".`);
      }
      break;
    case "approvalPolicy":
      if (isApprovalPolicy(value)) {
        effectiveSettings.approvalPolicy = value;
        fieldSources.approvalPolicy = source;
      } else {
        warnings.push(`Ignored invalid ${source} approval_policy "${value}".`);
      }
      break;
    case "sandboxMode":
      if (isSandboxMode(value)) {
        effectiveSettings.sandboxMode = value;
        fieldSources.sandboxMode = source;
      } else {
        warnings.push(`Ignored invalid ${source} sandbox_mode "${value}".`);
      }
      break;
  }
}

function determinePersistedFieldSource(
  effectiveSettings: AppSettings,
  persistedSettings: AppSettings,
): EffectiveSettingsDebugInfo["fieldSources"] {
  const defaults = createDefaultSettings();

  return {
    model: effectiveSettings.model === persistedSettings.model && effectiveSettings.model !== defaults.model
      ? "persisted"
      : "default",
    reasoningLevel: effectiveSettings.reasoningLevel === persistedSettings.reasoningLevel && effectiveSettings.reasoningLevel !== defaults.reasoningLevel
      ? "persisted"
      : "default",
    approvalPolicy: effectiveSettings.approvalPolicy === persistedSettings.approvalPolicy && effectiveSettings.approvalPolicy !== defaults.approvalPolicy
      ? "persisted"
      : "default",
    sandboxMode: effectiveSettings.sandboxMode === persistedSettings.sandboxMode && effectiveSettings.sandboxMode !== defaults.sandboxMode
      ? "persisted"
      : "default",
  };
}

export function resolveEffectiveSettings(options: ResolveEffectiveSettingsOptions): ResolvedAppBootstrap {
  const persistedSettings = loadSettings(options.settingsFile);
  const effectiveSettings: AppSettings = { ...persistedSettings };
  const fieldSources = determinePersistedFieldSource(effectiveSettings, persistedSettings);
  const warnings: string[] = [];
  const loadedLayers: string[] = [];

  const globalConfigPath = options.globalConfigPath ?? GLOBAL_CODEX_CONFIG_FILE;
  const projectConfigPath = options.projectConfigPath ?? join(
    options.workspaceRoot,
    CODEX_CONFIG_DIR,
    CODEX_CONFIG_FILE_NAME,
  );

  const globalLayer = parseTomlLayer(globalConfigPath);
  warnings.push(...globalLayer.warnings);
  if (
    globalLayer.values.model
    || globalLayer.values.reasoningLevel
    || globalLayer.values.approvalPolicy
    || globalLayer.values.sandboxMode
  ) {
    loadedLayers.push(`global config: ${globalConfigPath}`);
    applyLayerValue("model", globalLayer.values.model, "global-config", effectiveSettings, fieldSources, warnings);
    applyLayerValue("reasoningLevel", globalLayer.values.reasoningLevel, "global-config", effectiveSettings, fieldSources, warnings);
    applyLayerValue("approvalPolicy", globalLayer.values.approvalPolicy, "global-config", effectiveSettings, fieldSources, warnings);
    applyLayerValue("sandboxMode", globalLayer.values.sandboxMode, "global-config", effectiveSettings, fieldSources, warnings);
  }

  const projectLayer = parseTomlLayer(projectConfigPath);
  warnings.push(...projectLayer.warnings);
  if (
    projectLayer.values.model
    || projectLayer.values.reasoningLevel
    || projectLayer.values.approvalPolicy
    || projectLayer.values.sandboxMode
  ) {
    loadedLayers.push(`project config: ${projectConfigPath}`);
    applyLayerValue("model", projectLayer.values.model, "project-config", effectiveSettings, fieldSources, warnings);
    applyLayerValue("reasoningLevel", projectLayer.values.reasoningLevel, "project-config", effectiveSettings, fieldSources, warnings);
    applyLayerValue("approvalPolicy", projectLayer.values.approvalPolicy, "project-config", effectiveSettings, fieldSources, warnings);
    applyLayerValue("sandboxMode", projectLayer.values.sandboxMode, "project-config", effectiveSettings, fieldSources, warnings);
  }

  const envLaunchArgs = parseLaunchArgsEnv(options.env?.[LAUNCH_ARGS_ENV]);
  const launchArgs = options.launchArgs ?? envLaunchArgs;
  const { overrides, warnings: overrideWarnings } = parseLaunchOverrides(launchArgs);
  warnings.push(...overrideWarnings);
  if (launchArgs.length > 0) {
    loadedLayers.push(`launch overrides: ${launchArgs.join(" ")}`);
  }
  applyLayerValue("model", overrides.model, "launch-override", effectiveSettings, fieldSources, warnings);
  applyLayerValue("reasoningLevel", overrides.reasoningLevel, "launch-override", effectiveSettings, fieldSources, warnings);
  applyLayerValue("approvalPolicy", overrides.approvalPolicy, "launch-override", effectiveSettings, fieldSources, warnings);
  applyLayerValue("sandboxMode", overrides.sandboxMode, "launch-override", effectiveSettings, fieldSources, warnings);

  return {
    effectiveSettings,
    persistedSettings,
    debug: {
      loadedLayers,
      warnings,
      fieldSources,
    },
  };
}

export function formatEffectiveSettingsDebugNotice(
  settings: AppSettings,
  debug: EffectiveSettingsDebugInfo,
): string | null {
  if (debug.loadedLayers.length === 0 && debug.warnings.length === 0) {
    return null;
  }

  const lines = [
    "Resolved startup settings:",
    `  Model: ${settings.model} (${debug.fieldSources.model})`,
    `  Reasoning: ${settings.reasoningLevel} (${debug.fieldSources.reasoningLevel})`,
    `  Permissions: ${formatRuntimePolicySummary({
      approvalPolicy: settings.approvalPolicy,
      sandboxMode: settings.sandboxMode,
    })}`,
    `  Sources: approval=${debug.fieldSources.approvalPolicy}, sandbox=${debug.fieldSources.sandboxMode}`,
  ];

  if (debug.loadedLayers.length > 0) {
    lines.push("", "Loaded layers:");
    for (const layer of debug.loadedLayers) {
      lines.push(`  ${layer}`);
    }
  }

  if (debug.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of debug.warnings) {
      lines.push(`  ${warning}`);
    }
  }

  return lines.join("\n");
}
