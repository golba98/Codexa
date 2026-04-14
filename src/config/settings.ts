import { homedir } from "os";
import { join } from "path";

export const APP_NAME = "Codexa";
export const APP_VERSION = "1.0.1";
export const DEFAULT_BACKEND = "codex-subprocess";
export const DEFAULT_MODEL = "gpt-5.4";
export const DEFAULT_MODE = "full-auto";
export const DEFAULT_REASONING_LEVEL = "high";
export const DEFAULT_LAYOUT_STYLE = "gemini-shell";
export const DEFAULT_THEME = "mono";
export const DEFAULT_AUTH_PREFERENCE = "chatgpt-login-goal";
export const DEFAULT_APPROVAL_POLICY = "on-request";
export const DEFAULT_SANDBOX_MODE = "workspace-write";
export const CODEX_EXECUTABLE = process.env.CODEX_EXECUTABLE || "codex";
export const MAX_CHAT_LINES = 2000;
export const MAX_VISIBLE_EVENTS = 8;
export const SETTINGS_FILE = join(homedir(), ".codexa-settings.json");
export const MODEL_SPECS_FILE = join(homedir(), ".codexa-model-specs.json");
export const CODEX_CONFIG_DIR = ".codex";
export const CODEX_CONFIG_FILE_NAME = "config.toml";
export const GLOBAL_CODEX_CONFIG_FILE = join(homedir(), CODEX_CONFIG_DIR, CODEX_CONFIG_FILE_NAME);
export const LAUNCH_ARGS_ENV = "CODEXA_LAUNCH_ARGS";

export const AVAILABLE_BACKENDS = [
  {
    id: "codex-subprocess",
    label: "Codexa Core",
    description: "Direct connection to the Codexa neural network.",
  },
  {
    id: "openai-native",
    label: "OpenAI Native",
    description: "Future native provider. ChatGPT subscriptions do not automatically grant API access.",
  },
] as const;

export type AvailableBackend = (typeof AVAILABLE_BACKENDS)[number]["id"];

// Canonical model allowlist — add or remove models here only.
// All pickers, commands, and validation read from this single source.
export const AVAILABLE_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2",
] as const;

export type AvailableModel = (typeof AVAILABLE_MODELS)[number];

export const AVAILABLE_REASONING_LEVELS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
] as const;

export type ReasoningLevel = (typeof AVAILABLE_REASONING_LEVELS)[number]["id"];

export function isAvailableModel(value: unknown): value is AvailableModel {
  return typeof value === "string"
    && (AVAILABLE_MODELS as readonly string[]).includes(value);
}

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === "string"
    && AVAILABLE_REASONING_LEVELS.some((item) => item.id === value);
}

/** Rough token estimate: ~4 chars per token */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export const MODEL_REASONING_RECOMMENDATIONS: Record<AvailableModel, ReasoningLevel> = {
  "gpt-5.4": "xhigh",
  "gpt-5.4-mini": "medium",
  "gpt-5.3-codex": "high",
  "gpt-5.2": "high",
};

/**
 * Per-model reasoning level availability — the single source of truth for
 * which reasoning levels each model actually supports.  UI bar counts,
 * selection ranges, and interactive behaviour all derive from this map.
 */
export const MODEL_AVAILABLE_REASONING: Record<AvailableModel, readonly ReasoningLevel[]> = {
  "gpt-5.4":       ["low", "medium", "high", "xhigh"],
  "gpt-5.4-mini":  ["low", "medium", "high", "xhigh"],
  "gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
  "gpt-5.2":       ["low", "medium", "high", "xhigh"],
};

/** Returns the ordered list of reasoning levels a model supports. */
export function getAvailableReasoningForModel(model: AvailableModel): readonly ReasoningLevel[] {
  return MODEL_AVAILABLE_REASONING[model] ?? AVAILABLE_REASONING_LEVELS.map((r) => r.id);
}

/** True when a model supports more than one reasoning level (interactive). */
export function isReasoningInteractive(model: AvailableModel): boolean {
  return getAvailableReasoningForModel(model).length > 1;
}

export const AVAILABLE_MODES = [
  { key: "suggest", label: "SUGGEST" },
  { key: "auto-edit", label: "AUTO-EDIT" },
  { key: "full-auto", label: "FULL AUTO" },
] as const;

export type AvailableMode = (typeof AVAILABLE_MODES)[number]["key"];

export const MODE_COMMAND_ALIASES = {
  default: DEFAULT_MODE,
  ask: "suggest",
  add: "auto-edit",
  auto: "auto-edit",
  plan: "suggest",
} as const;

export type ModeCommandAlias = keyof typeof MODE_COMMAND_ALIASES;

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApprovalPolicy = "untrusted" | "on-request" | "never";

export interface RuntimePolicy {
  approvalPolicy: CodexApprovalPolicy;
  sandboxMode: CodexSandboxMode;
}

export const AVAILABLE_APPROVAL_POLICIES = [
  { id: "untrusted", label: "Untrusted" },
  { id: "on-request", label: "On request" },
  { id: "never", label: "Never" },
] as const;

export const AVAILABLE_SANDBOX_MODES = [
  { id: "read-only", label: "Read only" },
  { id: "workspace-write", label: "Workspace write" },
  { id: "danger-full-access", label: "Danger full access" },
] as const;

export const PERMISSION_PRESETS = [
  {
    id: "read-only",
    label: "Read only",
    description: "Untrusted approval with read-only sandbox.",
    policy: {
      approvalPolicy: "untrusted",
      sandboxMode: "read-only",
    },
  },
  {
    id: "auto-edit",
    label: "Auto edit",
    description: "On-request approval with workspace-write sandbox.",
    policy: {
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
    },
  },
  {
    id: "full-access",
    label: "Full access",
    description: "Never ask for approval and allow danger-full-access sandbox.",
    policy: {
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
    },
  },
] as const;

export type PermissionPresetId = (typeof PERMISSION_PRESETS)[number]["id"];

export function getLegacyRuntimePolicyForMode(mode: AvailableMode): RuntimePolicy {
  switch (mode) {
    case "suggest":
      return {
        approvalPolicy: "untrusted",
        sandboxMode: "read-only",
      };
    case "auto-edit":
    case "full-auto":
    default:
      return {
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
      };
  }
}

export function areRuntimePoliciesEqual(left: RuntimePolicy, right: RuntimePolicy): boolean {
  return left.approvalPolicy === right.approvalPolicy && left.sandboxMode === right.sandboxMode;
}

export function isApprovalPolicy(value: unknown): value is CodexApprovalPolicy {
  return typeof value === "string"
    && AVAILABLE_APPROVAL_POLICIES.some((item) => item.id === value);
}

export function isSandboxMode(value: unknown): value is CodexSandboxMode {
  return typeof value === "string"
    && AVAILABLE_SANDBOX_MODES.some((item) => item.id === value);
}

export function buildCodexExecArgs(
  model: string,
  cwd: string,
  runtimePolicy: RuntimePolicy,
  reasoningLevel?: string,
  structuredOutput = true,
): string[] {
  // Ensure cwd is safe to pass as a single command-line argument.
  let safeCwd = cwd;
  if (safeCwd.includes("\n") || safeCwd.includes("\r") || safeCwd.includes("\0")) {
    safeCwd = process.cwd();
  }
  const args: string[] = ["exec"];

  if (structuredOutput) {
    args.push("--experimental-json");
  }

  args.push("--skip-git-repo-check", "--cd", safeCwd, "--model", model);

  if (reasoningLevel) {
    args.push("--config", `reasoning.effort=${reasoningLevel}`);
  }

  args.push("--ask-for-approval", runtimePolicy.approvalPolicy);
  args.push("--sandbox", runtimePolicy.sandboxMode);

  args.push("-");
  return args;
}

export const AUTH_PREFERENCES = [
  {
    id: "chatgpt-login-goal",
    label: "ChatGPT login goal",
    description: "Design toward account-style sign-in without claiming it works as a backend today.",
  },
  {
    id: "api-key-first",
    label: "API key first",
    description: "Prefer official API credentials when native OpenAI support is added.",
  },
  {
    id: "runner-managed",
    label: "Codexa managed",
    description: "Rely on the core neural bridge to manage authentication.",
  },
] as const;

export type AuthPreference = (typeof AUTH_PREFERENCES)[number]["id"];

export function formatModeLabel(mode: string): string {
  const found = AVAILABLE_MODES.find((m) => m.key === mode);
  return found?.label ?? mode.toUpperCase();
}

export function resolveModeCommand(mode: string): AvailableMode | null {
  const normalized = mode.toLowerCase();
  const canonical = AVAILABLE_MODES.find((item) => item.key === normalized);
  if (canonical) {
    return canonical.key;
  }

  return MODE_COMMAND_ALIASES[normalized as ModeCommandAlias] ?? null;
}

export function formatModeCommandHelp(): string {
  return "suggest, auto-edit, full-auto; aliases: default, ask, add, auto, plan";
}

export function getNextMode(mode: AvailableMode): AvailableMode {
  const currentIndex = AVAILABLE_MODES.findIndex((item) => item.key === mode);
  if (currentIndex < 0) {
    return AVAILABLE_MODES[0].key;
  }

  return AVAILABLE_MODES[(currentIndex + 1) % AVAILABLE_MODES.length].key;
}

export function formatBackendLabel(backend: string): string {
  const found = AVAILABLE_BACKENDS.find((item) => item.id === backend);
  return found?.label ?? backend;
}

export function formatReasoningLabel(reasoning: string): string {
  const found = AVAILABLE_REASONING_LEVELS.find((item) => item.id === reasoning);
  return found?.label ?? reasoning;
}

export function formatApprovalPolicyLabel(policy: string): string {
  const found = AVAILABLE_APPROVAL_POLICIES.find((item) => item.id === policy);
  return found?.label ?? policy;
}

export function formatSandboxLabel(sandboxMode: string): string {
  const found = AVAILABLE_SANDBOX_MODES.find((item) => item.id === sandboxMode);
  return found?.label ?? sandboxMode;
}

export function formatRuntimePolicySummary(runtimePolicy: RuntimePolicy): string {
  return `${formatApprovalPolicyLabel(runtimePolicy.approvalPolicy)} approval · ${formatSandboxLabel(runtimePolicy.sandboxMode)} sandbox`;
}

export const AVAILABLE_THEMES = [
  { id: "purple",    label: "Midnight Purple" },
  { id: "mono",      label: "Black & White" },
  { id: "dark",      label: "Modern Dark" },
  { id: "black",     label: "Codex the Black" },
  { id: "emerald",   label: "Emerald Night" },
  { id: "solar",     label: "Solar Flare" },
  { id: "cyber",     label: "Cyberpunk Neon" },
  { id: "ocean",     label: "Deep Oceanic" },
  { id: "nordic",    label: "Nordic Frost" },
  { id: "green",     label: "Terminal Green" },
  { id: "amber",     label: "Terminal Amber" },
  { id: "vaporwave", label: "Vaporwave Dream" },
  { id: "dracula",   label: "Dracula Night" },
  { id: "gruvbox",   label: "Gruvbox Hard" },
  { id: "synthwave", label: "Synthwave '84" },
  { id: "custom",    label: "Customize..." },
] as const;

export type AvailableTheme = (typeof AVAILABLE_THEMES)[number]["id"];

export function formatThemeLabel(themeId: string): string {
  const found = AVAILABLE_THEMES.find((item) => item.id === themeId);
  return found?.label ?? themeId;
}

export function getRecommendedReasoningForModel(model: AvailableModel): ReasoningLevel {
  return MODEL_REASONING_RECOMMENDATIONS[model] ?? DEFAULT_REASONING_LEVEL;
}

export function normalizeReasoningForModel(
  model: AvailableModel,
  reasoningLevel: ReasoningLevel,
): ReasoningLevel {
  const available = getAvailableReasoningForModel(model);
  if (available.includes(reasoningLevel)) {
    return reasoningLevel;
  }
  // If the current level isn't supported, fall back to the recommendation.
  return getRecommendedReasoningForModel(model);
}

export function formatAuthPreferenceLabel(preference: string): string {
  const found = AUTH_PREFERENCES.find((item) => item.id === preference);
  return found?.label ?? preference;
}
