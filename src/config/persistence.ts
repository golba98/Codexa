import { readFileSync, writeFileSync, renameSync } from "fs";
import {
  AUTH_PREFERENCES,
  AVAILABLE_BACKENDS,
  AVAILABLE_MODELS,
  AVAILABLE_MODES,
  AVAILABLE_REASONING_LEVELS,
  DEFAULT_AUTH_PREFERENCE,
  DEFAULT_BACKEND,
  DEFAULT_LAYOUT_STYLE,
  DEFAULT_MODEL,
  DEFAULT_MODE,
  DEFAULT_REASONING_LEVEL,
  DEFAULT_THEME,
  SETTINGS_FILE,
  normalizeReasoningForModel,
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
}

export function loadSettings(): AppSettings {
  try {
    const text = readFileSync(SETTINGS_FILE, "utf-8");
    const data = JSON.parse(text);
    const backend = AVAILABLE_BACKENDS.some((item) => item.id === data.backend)
      ? data.backend
      : DEFAULT_BACKEND;
    const model = (AVAILABLE_MODELS as readonly string[]).includes(data.model)
      ? data.model
      : DEFAULT_MODEL;
    const mode = AVAILABLE_MODES.some((item) => item.key === data.mode)
      ? data.mode
      : DEFAULT_MODE;
    const reasoningLevel = AVAILABLE_REASONING_LEVELS.some((item) => item.id === data.reasoning_level)
      ? data.reasoning_level
      : DEFAULT_REASONING_LEVEL;
    const authPreference = AUTH_PREFERENCES.some((item) => item.id === data.auth_preference)
      ? data.auth_preference
      : DEFAULT_AUTH_PREFERENCE;

    return {
      backend,
      model,
      mode,
      reasoningLevel: normalizeReasoningForModel(model, reasoningLevel),
      layoutStyle: data.layout_style ?? DEFAULT_LAYOUT_STYLE,
      theme: data.theme ?? DEFAULT_THEME,
      customTheme: data.custom_theme,
      authPreference,
    };
  } catch {
    return {
      backend: DEFAULT_BACKEND,
      model: DEFAULT_MODEL,
      mode: DEFAULT_MODE,
      reasoningLevel: normalizeReasoningForModel(DEFAULT_MODEL, DEFAULT_REASONING_LEVEL),
      layoutStyle: DEFAULT_LAYOUT_STYLE,
      theme: DEFAULT_THEME,
      authPreference: DEFAULT_AUTH_PREFERENCE,
    };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    const tmpFile = SETTINGS_FILE + ".tmp";
    const data = {
      backend: settings.backend,
      model: settings.model,
      mode: settings.mode,
      reasoning_level: settings.reasoningLevel,
      layout_style: settings.layoutStyle,
      theme: settings.theme,
      custom_theme: settings.customTheme,
      auth_preference: settings.authPreference,
    };
    writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpFile, SETTINGS_FILE);
  } catch {
    // Silently ignore — settings are best-effort
  }
}
