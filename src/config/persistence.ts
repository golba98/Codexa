import { readFileSync, writeFileSync, renameSync } from "fs";
import {
  AUTH_PREFERENCES,
  AVAILABLE_BACKENDS,
  AVAILABLE_MODES,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_AUTH_PREFERENCE,
  DEFAULT_BACKEND,
  DEFAULT_LAYOUT_STYLE,
  DEFAULT_MODEL,
  DEFAULT_MODE,
  DEFAULT_REASONING_LEVEL,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_THEME,
  SETTINGS_FILE,
  getLegacyRuntimePolicyForMode,
  isAvailableModel,
  isApprovalPolicy,
  isReasoningLevel,
  isSandboxMode,
  normalizeReasoningForModel,
  type CodexApprovalPolicy,
  type CodexSandboxMode,
  type AuthPreference,
  type AvailableBackend,
  type AvailableMode,
  type AvailableModel,
  type AvailableTheme,
  type ReasoningLevel,
} from "./settings.js";
import { Theme } from "../ui/theme.js";

export interface AppSettings {
  backend: AvailableBackend;
  model: AvailableModel;
  mode: AvailableMode;
  reasoningLevel: ReasoningLevel;
  layoutStyle: string;
  theme: string;
  customTheme?: Partial<Theme>;
  authPreference: AuthPreference;
  approvalPolicy: CodexApprovalPolicy;
  sandboxMode: CodexSandboxMode;
}

export function createDefaultSettings(): AppSettings {
  const legacyPolicy = getLegacyRuntimePolicyForMode(DEFAULT_MODE);
  return {
    backend: DEFAULT_BACKEND,
    model: DEFAULT_MODEL,
    mode: DEFAULT_MODE,
    reasoningLevel: normalizeReasoningForModel(DEFAULT_MODEL, DEFAULT_REASONING_LEVEL),
    layoutStyle: DEFAULT_LAYOUT_STYLE,
    theme: DEFAULT_THEME,
    authPreference: DEFAULT_AUTH_PREFERENCE,
    approvalPolicy: legacyPolicy.approvalPolicy ?? DEFAULT_APPROVAL_POLICY,
    sandboxMode: legacyPolicy.sandboxMode ?? DEFAULT_SANDBOX_MODE,
  };
}

export function loadSettings(settingsFile = SETTINGS_FILE): AppSettings {
  try {
    const text = readFileSync(settingsFile, "utf-8");
    const data = JSON.parse(text);
    const backend = AVAILABLE_BACKENDS.some((item) => item.id === data.backend)
      ? data.backend
      : DEFAULT_BACKEND;
    const model = isAvailableModel(data.model)
      ? data.model
      : DEFAULT_MODEL;
    const mode = AVAILABLE_MODES.some((item) => item.key === data.mode)
      ? data.mode
      : DEFAULT_MODE;
    const reasoningLevel = isReasoningLevel(data.reasoning_level)
      ? data.reasoning_level
      : DEFAULT_REASONING_LEVEL;
    const authPreference = AUTH_PREFERENCES.some((item) => item.id === data.auth_preference)
      ? data.auth_preference
      : DEFAULT_AUTH_PREFERENCE;
    const legacyPolicy = getLegacyRuntimePolicyForMode(mode);
    const approvalPolicy = isApprovalPolicy(data.approval_policy)
      ? data.approval_policy
      : legacyPolicy.approvalPolicy ?? DEFAULT_APPROVAL_POLICY;
    const sandboxMode = isSandboxMode(data.sandbox_mode)
      ? data.sandbox_mode
      : legacyPolicy.sandboxMode ?? DEFAULT_SANDBOX_MODE;

    return {
      backend,
      model,
      mode,
      reasoningLevel: normalizeReasoningForModel(model, reasoningLevel),
      layoutStyle: data.layout_style ?? DEFAULT_LAYOUT_STYLE,
      theme: data.theme ?? DEFAULT_THEME,
      customTheme: data.custom_theme,
      authPreference,
      approvalPolicy,
      sandboxMode,
    };
  } catch {
    return createDefaultSettings();
  }
}

export function saveSettings(settings: AppSettings, settingsFile = SETTINGS_FILE): void {
  try {
    const tmpFile = settingsFile + ".tmp";
    const data = {
      backend: settings.backend,
      model: settings.model,
      mode: settings.mode,
      reasoning_level: settings.reasoningLevel,
      layout_style: settings.layoutStyle,
      theme: settings.theme,
      custom_theme: settings.customTheme,
      auth_preference: settings.authPreference,
      approval_policy: settings.approvalPolicy,
      sandbox_mode: settings.sandboxMode,
    };
    writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpFile, settingsFile);
  } catch {
    // Silently ignore — settings are best-effort
  }
}
