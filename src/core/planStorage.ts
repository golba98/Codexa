import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

type Platform = "win32" | "darwin" | "linux" | string;

/**
 * Resolve the directory where plan files are stored.
 * Uses platform-appropriate app-data locations instead of the workspace.
 */
export function resolvePlanDir(platformOverride?: Platform): string {
  const envDir = process.env["CODEXA_PLAN_DIR"];
  if (envDir) return envDir;

  const platform = platformOverride ?? process.platform;

  if (platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"];
    if (localAppData) return join(localAppData, "Codexa", "plans");
    const appData = process.env["APPDATA"];
    if (appData) return join(appData, "Codexa", "plans");
    return join(homedir(), "AppData", "Local", "Codexa", "plans");
  }

  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Codexa", "plans");
  }

  // Linux and other Unix-like
  const xdgDataHome = process.env["XDG_DATA_HOME"];
  if (xdgDataHome) return join(xdgDataHome, "codexa", "plans");
  return join(homedir(), ".local", "share", "codexa", "plans");
}

function workspaceHash(workspaceRoot: string): string {
  return createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 8);
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Save plan content to the app-data plan directory.
 * Returns the written file path, or null on failure.
 */
export function savePlan(content: string, workspaceRoot: string): string | null {
  try {
    const dir = resolvePlanDir();
    mkdirSync(dir, { recursive: true });
    const filename = `plan-${safeTimestamp()}-${workspaceHash(workspaceRoot)}.md`;
    const filePath = join(dir, filename);
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  } catch {
    return null;
  }
}

/**
 * Read plan content from a file path.
 * Returns the content string, or null on failure.
 */
export function readPlan(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
