import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

export const ANTIGRAVITY_SETTINGS_PATH =
  join(homedir(), ".gemini", "antigravity-cli", "settings.json");

export interface AntigravityModelEntry {
  settingsString: string;
  displayLabel: string;
  reasoning: string;
  description: string;
}

export const SUPPORTED_ANTIGRAVITY_MODELS: readonly AntigravityModelEntry[] = [
  { settingsString: "Gemini 3.5 Flash (High)",      displayLabel: "Gemini 3.5 Flash",  reasoning: "High",     description: "Fast Gemini model with high reasoning" },
  { settingsString: "Gemini 3.5 Flash (Medium)",    displayLabel: "Gemini 3.5 Flash",  reasoning: "Medium",   description: "Fast Gemini model with balanced reasoning" },
  { settingsString: "Gemini 3.1 Pro (High)",        displayLabel: "Gemini 3.1 Pro",    reasoning: "High",     description: "Pro Gemini model with high reasoning" },
  { settingsString: "Gemini 3.1 Pro (Low)",         displayLabel: "Gemini 3.1 Pro",    reasoning: "Low",      description: "Pro Gemini model with low reasoning" },
  { settingsString: "Claude Sonnet 4.6 (Thinking)", displayLabel: "Claude Sonnet 4.6", reasoning: "Thinking", description: "Claude Sonnet with extended thinking" },
  { settingsString: "Claude Opus 4.6 (Thinking)",   displayLabel: "Claude Opus 4.6",   reasoning: "Thinking", description: "Claude Opus with extended thinking" },
  { settingsString: "GPT-OSS 120B (Medium)",        displayLabel: "GPT-OSS 120B",      reasoning: "Medium",   description: "Open-source GPT model with balanced reasoning" },
];

// Resolved at call time so tests can override ANTIGRAVITY_SETTINGS_PATH via module state.
let _settingsPathOverride: string | null = null;

export function getAntigravitySettingsPath(): string {
  return _settingsPathOverride ?? ANTIGRAVITY_SETTINGS_PATH;
}

export function overrideAntigravitySettingsPathForTests(path: string | null): void {
  _settingsPathOverride = path;
}

export function readCurrentAntigravityModel(): string | null {
  try {
    const filePath = getAntigravitySettingsPath();
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.model === "string" ? parsed.model : null;
  } catch {
    return null;
  }
}

let _backupCreated = false;

export function writeAntigravityModel(settingsString: string): void {
  const entry = SUPPORTED_ANTIGRAVITY_MODELS.find((m) => m.settingsString === settingsString);
  if (!entry) {
    const supported = SUPPORTED_ANTIGRAVITY_MODELS.map((m) => `"${m.settingsString}"`).join(", ");
    throw new Error(`Unsupported Antigravity model: "${settingsString}". Supported: ${supported}`);
  }

  const filePath = getAntigravitySettingsPath();

  if (!_backupCreated && existsSync(filePath)) {
    copyFileSync(filePath, `${filePath}.bak`);
    _backupCreated = true;
  }

  let existing: Record<string, unknown> = {};
  try {
    if (existsSync(filePath)) {
      existing = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    }
  } catch { /* start fresh on parse failure */ }

  const updated = { ...existing, model: settingsString };

  mkdirSync(dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(updated, null, 2), "utf-8");
  renameSync(tmpFile, filePath);
}

export function resetAntigravitySettingsStateForTests(): void {
  _backupCreated = false;
  _settingsPathOverride = null;
}
