import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { Theme } from "../ui/theme.js";
import {
  AUTH_PREFERENCES,
  CODEX_CONFIG_FILE,
  DEFAULT_AUTH_PREFERENCE,
  DEFAULT_DIRECTORY_DISPLAY_MODE,
  DEFAULT_LAYOUT_STYLE,
  DEFAULT_THEME,
  DIRECTORY_DISPLAY_MODES,
  SETTINGS_FILE,
  type AuthPreference,
  type DirectoryDisplayMode,
} from "./settings.js";
import {
  mergeRuntimeIntoTomlConfig,
  parseTomlDocument,
  serializeTomlDocument,
} from "./layeredConfig.js";
import {
  normalizeRuntimeConfig,
  type RuntimeConfig,
} from "./runtimeConfig.js";

export interface UiSettings {
  layoutStyle: string;
  theme: string;
  directoryDisplayMode: DirectoryDisplayMode;
  customTheme?: Partial<Theme>;
}

export interface AuthSettings {
  preference: AuthPreference;
}

export interface AppSettings {
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
    directoryDisplayMode: input?.directoryDisplayMode ?? DEFAULT_DIRECTORY_DISPLAY_MODE,
    customTheme: input?.customTheme,
  };
}

export function getDefaultSettings(): AppSettings {
  return {
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

export function extractLegacyRuntime(data: unknown): RuntimeConfig | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  if (typeof record.runtime === "object" && record.runtime !== null) {
    return normalizeRuntimeConfig(record.runtime as Partial<RuntimeConfig>);
  }

  const hasFlatRuntimeKeys = ["backend", "model", "mode", "reasoning_level"].some((key) => key in record);
  return hasFlatRuntimeKeys ? parseLegacyRuntime(record) : null;
}

function stripLegacyRuntime(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return {};
  }

  const record = { ...(data as Record<string, unknown>) };
  delete record.runtime;
  delete record.backend;
  delete record.model;
  delete record.mode;
  delete record.reasoning_level;
  return record;
}

export function parseSettingsData(data: unknown): AppSettings {
  const defaults = getDefaultSettings();
  if (!data || typeof data !== "object") {
    return defaults;
  }

  const record = data as Record<string, unknown>;
  const uiSource = typeof record.ui === "object" && record.ui !== null
    ? record.ui as Record<string, unknown>
    : record;
  const authSource = typeof record.auth === "object" && record.auth !== null
    ? record.auth as Record<string, unknown>
    : record;

  return {
    ui: normalizeUiSettings({
      layoutStyle: typeof uiSource.layoutStyle === "string"
        ? uiSource.layoutStyle
        : typeof uiSource.layout_style === "string"
          ? uiSource.layout_style
          : defaults.ui.layoutStyle,
      theme: typeof uiSource.theme === "string" ? uiSource.theme : defaults.ui.theme,
      directoryDisplayMode:
        typeof uiSource.directoryDisplayMode === "string" && DIRECTORY_DISPLAY_MODES.includes(uiSource.directoryDisplayMode as DirectoryDisplayMode)
          ? uiSource.directoryDisplayMode as DirectoryDisplayMode
          : typeof uiSource.directory_display_mode === "string" && DIRECTORY_DISPLAY_MODES.includes(uiSource.directory_display_mode as DirectoryDisplayMode)
            ? uiSource.directory_display_mode as DirectoryDisplayMode
            : defaults.ui.directoryDisplayMode,
      customTheme: (uiSource.customTheme ?? uiSource.custom_theme) as Partial<Theme> | undefined,
    }),
    auth: {
      preference: normalizeAuthPreference(authSource.preference ?? authSource.auth_preference),
    },
  };
}

export function serializeSettings(settings: AppSettings): Record<string, unknown> {
  return {
    ui: {
      layout_style: settings.ui.layoutStyle,
      theme: settings.ui.theme,
      directory_display_mode: settings.ui.directoryDisplayMode,
      custom_theme: settings.ui.customTheme,
    },
    auth: {
      preference: settings.auth.preference,
    },
  };
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmpFile, filePath);
}

function maybeMigrateLegacyRuntime(rawData: unknown): void {
  const legacyRuntime = extractLegacyRuntime(rawData);
  if (!legacyRuntime) {
    return;
  }

  try {
    const existingConfig = existsSync(CODEX_CONFIG_FILE)
      ? parseTomlDocument(readFileSync(CODEX_CONFIG_FILE, "utf-8"))
      : {};
    const mergedConfig = mergeRuntimeIntoTomlConfig(existingConfig, legacyRuntime);
    mkdirSync(dirname(CODEX_CONFIG_FILE), { recursive: true });
    const tmpTomlFile = `${CODEX_CONFIG_FILE}.tmp`;
    writeFileSync(tmpTomlFile, serializeTomlDocument(mergedConfig), "utf-8");
    renameSync(tmpTomlFile, CODEX_CONFIG_FILE);
    writeJsonFile(SETTINGS_FILE, stripLegacyRuntime(rawData));
  } catch {
    // Best-effort migration only; keep legacy JSON intact if anything fails.
  }
}

export function loadSettings(): AppSettings {
  try {
    const text = readFileSync(SETTINGS_FILE, "utf-8");
    const rawData = JSON.parse(text);
    maybeMigrateLegacyRuntime(rawData);
    return parseSettingsData(rawData);
  } catch {
    return getDefaultSettings();
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    writeJsonFile(SETTINGS_FILE, serializeSettings(settings));
  } catch {
    // Silently ignore — settings are best-effort
  }
}
