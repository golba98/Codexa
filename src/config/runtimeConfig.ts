import { join, posix, win32 } from "path";
import {
  AVAILABLE_BACKENDS,
  AVAILABLE_MODELS,
  AVAILABLE_MODES,
  AVAILABLE_REASONING_LEVELS,
  DEFAULT_BACKEND,
  DEFAULT_MODEL,
  DEFAULT_MODE,
  DEFAULT_REASONING_LEVEL,
  formatBackendLabel,
  formatModeLabel,
  formatReasoningLabel,
  normalizeReasoningForModel,
  type AvailableBackend,
  type AvailableMode,
  type AvailableModel,
  type ReasoningLevel,
} from "./settings.js";

export const AVAILABLE_APPROVAL_POLICIES = [
  { id: "inherit", label: "Inherit" },
  { id: "untrusted", label: "Untrusted" },
  { id: "on-request", label: "On request" },
  { id: "never", label: "Never" },
] as const;

export const AVAILABLE_SANDBOX_MODES = [
  { id: "inherit", label: "Inherit" },
  { id: "read-only", label: "Read only" },
  { id: "workspace-write", label: "Workspace write" },
  { id: "danger-full-access", label: "Danger full access" },
] as const;

export const AVAILABLE_NETWORK_ACCESS_VALUES = [
  { id: "inherit", label: "Inherit" },
  { id: "enabled", label: "Enabled" },
  { id: "disabled", label: "Disabled" },
] as const;

export const AVAILABLE_SERVICE_TIERS = [
  { id: "flex", label: "Flex" },
  { id: "fast", label: "Fast" },
] as const;

export const AVAILABLE_PERSONALITIES = [
  { id: "none", label: "None" },
  { id: "friendly", label: "Friendly" },
  { id: "pragmatic", label: "Pragmatic" },
] as const;

export type RuntimeApprovalPolicy = (typeof AVAILABLE_APPROVAL_POLICIES)[number]["id"];
export type ResolvedApprovalPolicy = Exclude<RuntimeApprovalPolicy, "inherit">;
export type RuntimeSandboxMode = (typeof AVAILABLE_SANDBOX_MODES)[number]["id"];
export type ResolvedSandboxMode = Exclude<RuntimeSandboxMode, "inherit">;
export type RuntimeNetworkAccess = (typeof AVAILABLE_NETWORK_ACCESS_VALUES)[number]["id"];
export type RuntimeServiceTier = (typeof AVAILABLE_SERVICE_TIERS)[number]["id"];
export type RuntimePersonality = (typeof AVAILABLE_PERSONALITIES)[number]["id"];

export interface RuntimePolicyConfig {
  approvalPolicy: RuntimeApprovalPolicy;
  sandboxMode: RuntimeSandboxMode;
  networkAccess: RuntimeNetworkAccess;
  writableRoots: string[];
  serviceTier: RuntimeServiceTier;
  personality: RuntimePersonality;
}

export interface RuntimeConfig {
  provider: AvailableBackend;
  model: AvailableModel;
  reasoningLevel: ReasoningLevel;
  mode: AvailableMode;
  policy: RuntimePolicyConfig;
}

export interface PartialRuntimeConfig extends Partial<Omit<RuntimeConfig, "policy">> {
  policy?: Partial<RuntimePolicyConfig>;
}

export interface ResolvedRuntimePolicy {
  approvalPolicy: ResolvedApprovalPolicy;
  sandboxMode: ResolvedSandboxMode;
  networkAccess: boolean;
  writableRoots: string[];
  serviceTier: RuntimeServiceTier;
  personality: RuntimePersonality;
}

export interface ResolvedRuntimeConfig {
  provider: AvailableBackend;
  model: AvailableModel;
  reasoningLevel: ReasoningLevel;
  mode: AvailableMode;
  policy: ResolvedRuntimePolicy;
}

export interface RuntimeStatusContext {
  workspaceRoot: string;
  tokensUsed?: number | null;
}

export interface RuntimeSummary {
  model: AvailableModel;
  reasoningLabel: string;
  modeLabel: string;
  sandboxLabel: string;
  approvalLabel: string;
}

export const DEFAULT_RUNTIME_POLICY: RuntimePolicyConfig = {
  approvalPolicy: "inherit",
  sandboxMode: "inherit",
  networkAccess: "inherit",
  writableRoots: [],
  serviceTier: "flex",
  personality: "none",
};

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  provider: DEFAULT_BACKEND,
  model: DEFAULT_MODEL,
  reasoningLevel: normalizeReasoningForModel(DEFAULT_MODEL, DEFAULT_REASONING_LEVEL),
  mode: DEFAULT_MODE,
  policy: DEFAULT_RUNTIME_POLICY,
};

function detectPathApi(value: string): typeof win32 | typeof posix {
  return /^[a-zA-Z]:[\\/]|^\\\\|\\/.test(value) ? win32 : posix;
}

function stripTrailingSeparators(value: string, pathApi: typeof win32 | typeof posix): string {
  const parsed = pathApi.parse(value);
  if (value === parsed.root) {
    return value;
  }

  return value.replace(/[\\/]+$/, "");
}

function normalizePathValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const pathApi = detectPathApi(trimmed);
  return stripTrailingSeparators(pathApi.normalize(trimmed), pathApi);
}

function dedupeWritableRoots(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = normalizePathValue(value);
    if (!trimmed) continue;
    const key = process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
}

function isAvailableId<T extends string>(
  values: readonly { id: T }[],
  candidate: unknown,
): candidate is T {
  return typeof candidate === "string" && values.some((value) => value.id === candidate);
}

export function normalizeRuntimePolicy(input: Partial<RuntimePolicyConfig> | null | undefined): RuntimePolicyConfig {
  return {
    approvalPolicy: isAvailableId(AVAILABLE_APPROVAL_POLICIES, input?.approvalPolicy)
      ? input!.approvalPolicy
      : DEFAULT_RUNTIME_POLICY.approvalPolicy,
    sandboxMode: isAvailableId(AVAILABLE_SANDBOX_MODES, input?.sandboxMode)
      ? input!.sandboxMode
      : DEFAULT_RUNTIME_POLICY.sandboxMode,
    networkAccess: isAvailableId(AVAILABLE_NETWORK_ACCESS_VALUES, input?.networkAccess)
      ? input!.networkAccess
      : DEFAULT_RUNTIME_POLICY.networkAccess,
    writableRoots: dedupeWritableRoots(input?.writableRoots ?? DEFAULT_RUNTIME_POLICY.writableRoots),
    serviceTier: isAvailableId(AVAILABLE_SERVICE_TIERS, input?.serviceTier)
      ? input!.serviceTier
      : DEFAULT_RUNTIME_POLICY.serviceTier,
    personality: isAvailableId(AVAILABLE_PERSONALITIES, input?.personality)
      ? input!.personality
      : DEFAULT_RUNTIME_POLICY.personality,
  };
}

export function normalizeRuntimeConfig(input: PartialRuntimeConfig | null | undefined): RuntimeConfig {
  const provider = isAvailableId(AVAILABLE_BACKENDS, input?.provider)
    ? input!.provider
    : DEFAULT_RUNTIME_CONFIG.provider;
  const model = isAvailableId(
    AVAILABLE_MODELS.map((id) => ({ id })),
    input?.model,
  )
    ? input!.model
    : DEFAULT_RUNTIME_CONFIG.model;
  const mode = isAvailableId(AVAILABLE_MODES.map((item) => ({ id: item.key })), input?.mode)
    ? input!.mode
    : DEFAULT_RUNTIME_CONFIG.mode;
  const reasoningInput = isAvailableId(AVAILABLE_REASONING_LEVELS, input?.reasoningLevel)
    ? input!.reasoningLevel
    : DEFAULT_RUNTIME_CONFIG.reasoningLevel;

  return {
    provider,
    model,
    mode,
    reasoningLevel: normalizeReasoningForModel(model, reasoningInput),
    policy: normalizeRuntimePolicy(input?.policy),
  };
}

export function resolveInheritedApprovalPolicy(mode: AvailableMode): ResolvedApprovalPolicy {
  switch (mode) {
    case "suggest":
    case "auto-edit":
    case "full-auto":
    default:
      return "on-request";
  }
}

export function resolveInheritedSandboxMode(mode: AvailableMode): ResolvedSandboxMode {
  switch (mode) {
    case "suggest":
      return "read-only";
    case "auto-edit":
    case "full-auto":
    default:
      return "workspace-write";
  }
}

export function resolveRuntimeConfig(config: RuntimeConfig): ResolvedRuntimeConfig {
  const normalized = normalizeRuntimeConfig(config);
  const sandboxMode = normalized.policy.sandboxMode === "inherit"
    ? resolveInheritedSandboxMode(normalized.mode)
    : normalized.policy.sandboxMode;
  const approvalPolicy = normalized.policy.approvalPolicy === "inherit"
    ? resolveInheritedApprovalPolicy(normalized.mode)
    : normalized.policy.approvalPolicy;

  return {
    provider: normalized.provider,
    model: normalized.model,
    mode: normalized.mode,
    reasoningLevel: normalizeReasoningForModel(normalized.model, normalized.reasoningLevel),
    policy: {
      approvalPolicy,
      sandboxMode,
      networkAccess: normalized.policy.networkAccess === "enabled",
      writableRoots: dedupeWritableRoots(normalized.policy.writableRoots),
      serviceTier: normalized.policy.serviceTier,
      personality: normalized.policy.personality,
    },
  };
}

export function addWritableRoot(config: RuntimeConfig, root: string): RuntimeConfig {
  const nextRoots = dedupeWritableRoots([...config.policy.writableRoots, root]);
  return {
    ...config,
    policy: {
      ...config.policy,
      writableRoots: nextRoots,
    },
  };
}

export function removeWritableRoot(config: RuntimeConfig, root: string): RuntimeConfig {
  const target = normalizePathValue(root);
  const targetKey = process.platform === "win32" ? target.toLowerCase() : target;
  return {
    ...config,
    policy: {
      ...config.policy,
      writableRoots: config.policy.writableRoots.filter((value) => {
        const key = process.platform === "win32" ? normalizePathValue(value).toLowerCase() : normalizePathValue(value);
        return key !== targetKey;
      }),
    },
  };
}

export function clearWritableRoots(config: RuntimeConfig): RuntimeConfig {
  return {
    ...config,
    policy: {
      ...config.policy,
      writableRoots: [],
    },
  };
}

export function formatApprovalPolicyLabel(value: RuntimeApprovalPolicy | ResolvedApprovalPolicy): string {
  const found = AVAILABLE_APPROVAL_POLICIES.find((item) => item.id === value);
  return found?.label ?? value;
}

export function formatSandboxModeLabel(value: RuntimeSandboxMode | ResolvedSandboxMode): string {
  const found = AVAILABLE_SANDBOX_MODES.find((item) => item.id === value);
  return found?.label ?? value;
}

export function formatNetworkAccessLabel(value: RuntimeNetworkAccess | boolean): string {
  if (typeof value === "boolean") {
    return value ? "Enabled" : "Disabled";
  }
  const found = AVAILABLE_NETWORK_ACCESS_VALUES.find((item) => item.id === value);
  return found?.label ?? value;
}

export function formatServiceTierLabel(value: RuntimeServiceTier): string {
  const found = AVAILABLE_SERVICE_TIERS.find((item) => item.id === value);
  return found?.label ?? value;
}

export function formatPersonalityLabel(value: RuntimePersonality): string {
  const found = AVAILABLE_PERSONALITIES.find((item) => item.id === value);
  return found?.label ?? value;
}

export function buildRuntimeSummary(runtime: ResolvedRuntimeConfig): RuntimeSummary {
  return {
    model: runtime.model,
    reasoningLabel: formatReasoningLabel(runtime.reasoningLevel),
    modeLabel: formatModeLabel(runtime.mode),
    sandboxLabel: formatSandboxModeLabel(runtime.policy.sandboxMode),
    approvalLabel: formatApprovalPolicyLabel(runtime.policy.approvalPolicy),
  };
}

export function formatRuntimeStatus(runtime: ResolvedRuntimeConfig, context: RuntimeStatusContext): string {
  const writableRoots = runtime.policy.writableRoots.length > 0
    ? runtime.policy.writableRoots.map((value) => `  - ${value}`).join("\n")
    : "  - none";

  const lines = [
    "Runtime status:",
    `  Provider: ${formatBackendLabel(runtime.provider)}`,
    `  Model: ${runtime.model}`,
    `  Reasoning: ${formatReasoningLabel(runtime.reasoningLevel)}`,
    `  Mode: ${formatModeLabel(runtime.mode)}`,
    `  Approval policy: ${formatApprovalPolicyLabel(runtime.policy.approvalPolicy)}`,
    `  Sandbox mode: ${formatSandboxModeLabel(runtime.policy.sandboxMode)}`,
    `  Network access: ${formatNetworkAccessLabel(runtime.policy.networkAccess)}`,
    `  Service tier: ${formatServiceTierLabel(runtime.policy.serviceTier)}`,
    `  Personality: ${formatPersonalityLabel(runtime.policy.personality)}`,
    `  Workspace root: ${context.workspaceRoot}`,
    "  Writable roots:",
    writableRoots,
  ];

  if (typeof context.tokensUsed === "number") {
    lines.push(`  Tokens used: ~${context.tokensUsed.toLocaleString("en-US")}`);
  }

  return lines.join("\n");
}

function safeWorkspaceRoot(cwd: string): string {
  if (cwd.includes("\n") || cwd.includes("\r") || cwd.includes("\0")) {
    return process.cwd();
  }
  return cwd;
}

export function buildCodexConfigOverrides(runtime: ResolvedRuntimeConfig): string[] {
  const overrides = [
    `reasoning.effort=${runtime.reasoningLevel}`,
    `approval_policy=${runtime.policy.approvalPolicy}`,
    `sandbox_workspace_write.network_access=${JSON.stringify(runtime.policy.networkAccess)}`,
    `sandbox_workspace_write.writable_roots=${JSON.stringify(runtime.policy.writableRoots)}`,
    `service_tier=${runtime.policy.serviceTier}`,
    `personality=${runtime.policy.personality}`,
  ];

  return overrides;
}

export function buildCodexExecArgs(
  runtime: ResolvedRuntimeConfig,
  cwd: string,
  structuredOutput = true,
): string[] {
  const args: string[] = ["exec"];

  if (structuredOutput) {
    args.push("--experimental-json");
  }

  args.push(
    "--skip-git-repo-check",
    "--cd",
    safeWorkspaceRoot(cwd),
    "--model",
    runtime.model,
    "--sandbox",
    runtime.policy.sandboxMode,
  );

  for (const override of buildCodexConfigOverrides(runtime)) {
    args.push("--config", override);
  }

  args.push("-");
  return args;
}

export function resolveWritableRootCommandPath(pathValue: string, workspaceRoot: string): string {
  const trimmed = pathValue.trim();
  if (!trimmed) return trimmed;
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(trimmed)) {
    return normalizePathValue(trimmed);
  }
  return normalizePathValue(join(workspaceRoot, trimmed));
}
