import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

type Platform = "win32" | "darwin" | "linux" | string;
type Environment = Record<string, string | undefined>;

export function resolveCodexaDataDir(
  platformOverride?: Platform,
  env: Environment = process.env,
  home = homedir(),
): string {
  const configuredDir = env["CODEXA_DATA_DIR"]?.trim();
  if (configuredDir) return configuredDir;

  const platform = platformOverride ?? process.platform;
  if (platform === "win32") {
    return join(env["LOCALAPPDATA"]?.trim() || env["APPDATA"]?.trim() || join(home, "AppData", "Local"), "Codexa");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Codexa");
  }

  return join(env["XDG_DATA_HOME"]?.trim() || join(home, ".local", "share"), "codexa");
}

export function workspaceStorageKey(workspaceRoot: string): string {
  return createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
}

export function resolveCodexaWorkspaceDataDir(workspaceRoot: string): string {
  return join(resolveCodexaDataDir(), "workspaces", workspaceStorageKey(workspaceRoot));
}

export function resolveCodexaAttachmentDir(workspaceRoot: string, configuredDir: string): string {
  if (isAbsolute(configuredDir)) return configuredDir;

  const normalized = configuredDir.trim().replace(/\\/g, "/").replace(/^\.codexa\/?/, "") || "attachments";
  const safeRelativeDir = normalize(normalized).replace(/^(\.\.([/\\]|$))+/, "") || "attachments";
  return join(resolveCodexaWorkspaceDataDir(workspaceRoot), safeRelativeDir);
}

export function resolveCodexaDebugLogPath(env: Environment = process.env): string {
  return join(resolveCodexaDataDir(undefined, env), "debug", "render-status.log");
}
