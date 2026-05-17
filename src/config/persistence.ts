import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { Theme } from "../ui/theme.js";
import {
  AUTH_PREFERENCES,
  DEFAULT_AUTH_PREFERENCE,
  DEFAULT_LAYOUT_STYLE,
  DEFAULT_SHOW_BUSY_LOADER,
  DEFAULT_TERMINAL_MOUSE_MODE,
  DEFAULT_TERMINAL_TITLE_MODE,
  DEFAULT_THEME,
  DEFAULT_WORKSPACE_DISPLAY_MODE,
  LEGACY_DIRECTORY_DISPLAY_MODES,
  TERMINAL_MOUSE_MODES,
  WORKSPACE_DISPLAY_MODES,
  getCodexConfigFile,
  normalizeLegacyDirectoryDisplayMode,
  SETTINGS_FILE,
  type AuthPreference,
  type TerminalMouseMode,
  type TerminalTitleMode,
  type WorkspaceDisplayMode,
} from "./settings.js";
import {
  mergeRuntimeIntoTomlConfig,
  parseTomlDocument,
} from "./layeredConfig.js";
import { serializeTomlDocument } from "./toml-serialize.js";
import {
  normalizeRuntimeConfig,
  type RuntimeConfig,
} from "./runtimeConfig.js";

export interface UiSettings {
  layoutStyle: string;
  theme: string;
  workspaceDisplayMode: WorkspaceDisplayMode;
  terminalTitleMode: TerminalTitleMode;
  showBusyLoader: boolean;
  terminalMouseMode: TerminalMouseMode;
  customTheme?: Partial<Theme>;
}

export interface AuthSettings {
  preference: AuthPreference;
}

export interface AppSettings {
  ui: UiSettings;
  auth: AuthSettings;
}

// Pick the first string value found under the camelCase or snake_case key.
// Falls through to the snake_case key only when the camelCase value is absent or not a string.
function pickStr(src: Record<string, unknown>, camel: string, snake: string): string | undefined {
  const camelVal = src[camel];
  if (typeof camelVal === "string") return camelVal;
  const snakeVal = src[snake];
  if (typeof snakeVal === "string") return snakeVal;
  return undefined;
}

// Same as pickStr but for boolean values.
function pickBool(src: Record<string, unknown>, camel: string, snake: string): boolean | undefined {
  const camelVal = src[camel];
  if (typeof camelVal === "boolean") return camelVal;
  const snakeVal = src[snake];
  if (typeof snakeVal === "boolean") return snakeVal;
  return undefined;
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
    workspaceDisplayMode: input?.workspaceDisplayMode ?? DEFAULT_WORKSPACE_DISPLAY_MODE,
    terminalTitleMode: input?.terminalTitleMode ?? DEFAULT_TERMINAL_TITLE_MODE,
    showBusyLoader: typeof input?.showBusyLoader === "boolean"
      ? input.showBusyLoader
      : DEFAULT_SHOW_BUSY_LOADER,
    terminalMouseMode: TERMINAL_MOUSE_MODES.includes(input?.terminalMouseMode as TerminalMouseMode)
      ? (input!.terminalMouseMode as TerminalMouseMode)
      : DEFAULT_TERMINAL_MOUSE_MODE,
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

function parseTerminalTitleMode(uiSource: Record<string, unknown>, fallback: TerminalTitleMode): TerminalTitleMode {
  const direct = uiSource.terminalTitleMode ?? uiSource.terminal_title_mode;
  if (typeof direct === "string" && WORKSPACE_DISPLAY_MODES.includes(direct as WorkspaceDisplayMode)) {
    return direct as TerminalTitleMode;
  }

  return fallback;
}

function parseTerminalMouseMode(uiSource: Record<string, unknown>, fallback: TerminalMouseMode): TerminalMouseMode {
  const camel = uiSource.terminalMouseMode;
  if (typeof camel === "string" && TERMINAL_MOUSE_MODES.includes(camel as TerminalMouseMode)) {
    return camel as TerminalMouseMode;
  }
  const snake = uiSource.terminal_mouse_mode;
  if (typeof snake === "string" && TERMINAL_MOUSE_MODES.includes(snake as TerminalMouseMode)) {
    return snake as TerminalMouseMode;
  }
  return fallback;
}

function parseWorkspaceDisplayMode(uiSource: Record<string, unknown>, fallback: WorkspaceDisplayMode): WorkspaceDisplayMode {
  const direct = uiSource.workspaceDisplayMode ?? uiSource.workspace_display_mode;
  if (typeof direct === "string" && WORKSPACE_DISPLAY_MODES.includes(direct as WorkspaceDisplayMode)) {
    return direct as WorkspaceDisplayMode;
  }

  const legacy = uiSource.directoryDisplayMode ?? uiSource.directory_display_mode;
  if (typeof legacy === "string") {
    if (WORKSPACE_DISPLAY_MODES.includes(legacy as WorkspaceDisplayMode)) {
      return legacy as WorkspaceDisplayMode;
    }
    if (LEGACY_DIRECTORY_DISPLAY_MODES.includes(legacy as typeof LEGACY_DIRECTORY_DISPLAY_MODES[number])) {
      return normalizeLegacyDirectoryDisplayMode(legacy as typeof LEGACY_DIRECTORY_DISPLAY_MODES[number]);
    }
  }

  return fallback;
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
      layoutStyle: pickStr(uiSource, "layoutStyle", "layout_style") ?? defaults.ui.layoutStyle,
      theme: pickStr(uiSource, "theme", "theme") ?? defaults.ui.theme,
      workspaceDisplayMode: parseWorkspaceDisplayMode(uiSource, defaults.ui.workspaceDisplayMode),
      terminalTitleMode: parseTerminalTitleMode(uiSource, defaults.ui.terminalTitleMode),
      showBusyLoader: pickBool(uiSource, "showBusyLoader", "show_busy_loader") ?? defaults.ui.showBusyLoader,
      terminalMouseMode: parseTerminalMouseMode(uiSource, defaults.ui.terminalMouseMode),
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
      workspace_display_mode: settings.ui.workspaceDisplayMode,
      terminal_title_mode: settings.ui.terminalTitleMode,
      show_busy_loader: settings.ui.showBusyLoader,
      terminal_mouse_mode: settings.ui.terminalMouseMode,
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
    const codexConfigFile = getCodexConfigFile();
    const existingConfig = existsSync(codexConfigFile)
      ? parseTomlDocument(readFileSync(codexConfigFile, "utf-8"))
      : {};
    const mergedConfig = mergeRuntimeIntoTomlConfig(existingConfig, legacyRuntime);
    mkdirSync(dirname(codexConfigFile), { recursive: true });
    const tmpTomlFile = `${codexConfigFile}.tmp`;
    writeFileSync(tmpTomlFile, serializeTomlDocument(mergedConfig), "utf-8");
    renameSync(tmpTomlFile, codexConfigFile);
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
