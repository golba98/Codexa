import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHomeDir } from "../../config/settings.js";
import { isRecord } from "../shared/values.js";

/** Child-only settings overlay: preserve system policy and existing model overrides. */
export function createGeminiThinkingSettings(
  cwd: string,
  modelId: string,
  thinkingConfig: Record<string, unknown>,
  env = process.env,
): { env: NodeJS.ProcessEnv; cleanup: () => void } {
  const systemPath =
    env.GEMINI_CLI_SYSTEM_SETTINGS_PATH ||
    (process.platform === "darwin"
      ? "/Library/Application Support/GeminiCli/settings.json"
      : process.platform === "win32"
        ? "C:\\ProgramData\\gemini-cli\\settings.json"
        : "/etc/gemini-cli/settings.json");
  const read = (path: string): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      return isRecord(value) ? value : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("Gemini settings could not be safely read.");
    }
  };
  const system = read(systemPath);
  const documents = [
    read(join(getHomeDir(), ".gemini", "settings.json")),
    read(join(cwd, ".gemini", "settings.json")),
    system,
  ];
  const overrides = documents.flatMap((document) =>
    isRecord(document.modelConfigs) && Array.isArray(document.modelConfigs.overrides)
      ? document.modelConfigs.overrides
      : [],
  );
  const directory = mkdtempSync(join(tmpdir(), "ubume-gemini-settings-"));
  const path = join(directory, "settings.json");
  try {
    writeFileSync(
      path,
      JSON.stringify({
        ...system,
        modelConfigs: {
          ...(isRecord(system.modelConfigs) ? system.modelConfigs : {}),
          overrides: [
            ...overrides,
            {
              match: { model: modelId },
              modelConfig: { generateContentConfig: { thinkingConfig } },
            },
          ],
        },
      }),
      { mode: 0o600 },
    );
  } catch {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("Gemini settings overlay could not be created.");
  }
  return {
    env: {
      ...env,
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: path,
      GEMINI_CLI_SYSTEM_DEFAULTS_PATH:
        env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH || join(systemPath, "..", "system-defaults.json"),
    },
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
