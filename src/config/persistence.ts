import { readFileSync, renameSync, writeFileSync } from "fs";
import { Theme } from "../ui/theme.js";
import {
  AUTH_PREFERENCES,
  DEFAULT_AUTH_PREFERENCE,
  DEFAULT_LAYOUT_STYLE,
  DEFAULT_THEME,
  SETTINGS_FILE,
  type AuthPreference,
} from "./settings.js";
import {
  DEFAULT_RUNTIME_CONFIG,
  normalizeRuntimeConfig,
  type RuntimeConfig,
} from "./runtimeConfig.js";

export interface UiSettings {
  layoutStyle: string;
  theme: string;
  customTheme?: Partial<Theme>;
}

export interface AuthSettings {
  preference: AuthPreference;
}

export interface AppSettings {
  runtime: RuntimeConfig;
  ui: UiSettings;
  auth: AuthSettings;
}

function normalizeAuthPreference(value: unknown): AuthPreference {
  return typeof value === "string" && AUTH_PREFERENCES.some((item) => item.id === value)
    ? (value as AuthPreference)
    : DEFAULT_AUTH_PREFERENCE;
}

function normalizeUiSettings(input: Partial<UiSettings> | null | undefined): UiSettings {
  return {
    layoutStyle: input?.layoutStyle ?? DEFAULT_LAYOUT_STYLE,
    theme: input?.theme ?? DEFAULT_THEME,
    customTheme: input?.customTheme,
  };
}

export function getDefaultSettings(): AppSettings {
  return {
    runtime: DEFAULT_RUNTIME_CONFIG,
    ui: normalizeUiSettings(null),
    auth: {
      preference: DEFAULT_AUTH_PREFERENCE,
    },
  };
}

function parseLegacyRuntime(data: Record<string, unknown>): RuntimeConfig {
  return normalizeRuntimeConfig({
    provider: typeof data.backend === "string" ? data.backend as RuntimeConfig["provider"] : undefined,
    model: typeof data.model === "string" ? data.model as RuntimeConfig["model"] : undefined,
    mode: typeof data.mode === "string" ? data.mode as RuntimeConfig["mode"] : undefined,
    reasoningLevel: typeof data.reasoning_level === "string" ? data.reasoning_level as RuntimeConfig["reasoningLevel"] : undefined,
  });
}

export function parseSettingsData(data: unknown): AppSettings {
  const defaults = getDefaultSettings();
  if (!data || typeof data !== "object") {
    return defaults;
  }

  const record = data as Record<string, unknown>;

  const hasNestedRuntime = typeof record.runtime === "object" && record.runtime !== null;
  const runtime = hasNestedRuntime
    ? normalizeRuntimeConfig(record.runtime as Partial<RuntimeConfig>)
    : parseLegacyRuntime(record);

  const uiSource = typeof record.ui === "object" && record.ui !== null
    ? record.ui as Record<string, unknown>
    : record;
  const authSource = typeof record.auth === "object" && record.auth !== null
    ? record.auth as Record<string, unknown>
    : record;

  return {
    runtime,
    ui: normalizeUiSettings({
      layoutStyle: typeof uiSource.layoutStyle === "string"
        ? uiSource.layoutStyle
        : typeof uiSource.layout_style === "string"
          ? uiSource.layout_style
          : defaults.ui.layoutStyle,
      theme: typeof uiSource.theme === "string" ? uiSource.theme : defaults.ui.theme,
      customTheme: (uiSource.customTheme ?? uiSource.custom_theme) as Partial<Theme> | undefined,
    }),
    auth: {
      preference: normalizeAuthPreference(authSource.preference ?? authSource.auth_preference),
    },
  };
}

export function serializeSettings(settings: AppSettings): Record<string, unknown> {
  return {
    runtime: normalizeRuntimeConfig(settings.runtime),
    ui: {
      layout_style: settings.ui.layoutStyle,
      theme: settings.ui.theme,
      custom_theme: settings.ui.customTheme,
    },
    auth: {
      preference: settings.auth.preference,
    },
  };
}

export function loadSettings(): AppSettings {
  try {
    const text = readFileSync(SETTINGS_FILE, "utf-8");
    return parseSettingsData(JSON.parse(text));
  } catch {
    return getDefaultSettings();
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    const tmpFile = SETTINGS_FILE + ".tmp";
    writeFileSync(tmpFile, JSON.stringify(serializeSettings(settings), null, 2), "utf-8");
    renameSync(tmpFile, SETTINGS_FILE);
  } catch {
    // Silently ignore — settings are best-effort
  }
}
