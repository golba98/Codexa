import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { BUILD_COMMIT } from "../config/buildInfo.js";
import { APP_VERSION } from "../config/settings.js";

export const CODEXA_NPM_PACKAGE = "@golba98/codexa";
export const CODEXA_UPDATE_COMMAND = `npm install -g ${CODEXA_NPM_PACKAGE}`;


export type UpdateStatus = "up-to-date" | "update-available" | "unknown" | "error";

export interface UpdateCheckResult {
  status: UpdateStatus;
  localCommit: string | null;
  remoteCommit: string | null;
  repoPath: string | null;
  errorMessage?: string;
  checkedAt: number;
}

const GITHUB_API_URL = "https://api.github.com/repos/golba98/Codexa/git/refs/heads/main";
const REMOTE_TIMEOUT_MS = 3000;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function findGitRoot(startPath: string): string | null {
  let current = startPath;
  while (true) {
    try {
      if (existsSync(join(current, ".git"))) return current;
    } catch { /* ignore permission errors */ }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function getLocalCommit(repoPath: string): Promise<string | null> {
  try {
    const headFile = join(repoPath, ".git", "HEAD");
    const headContent = readFileSync(headFile, "utf-8").trim();

    if (headContent.startsWith("ref: ")) {
      const ref = headContent.slice(5).trim();
      const refFile = join(repoPath, ".git", ref);
      if (existsSync(refFile)) {
        return readFileSync(refFile, "utf-8").trim();
      }
      // Fall back to packed-refs
      const packedRefs = join(repoPath, ".git", "packed-refs");
      if (existsSync(packedRefs)) {
        for (const line of readFileSync(packedRefs, "utf-8").split("\n")) {
          if (line.endsWith(` ${ref}`)) {
            const sha = line.split(" ")[0];
            if (sha && SHA_PATTERN.test(sha)) return sha;
          }
        }
      }
      return null;
    }

    if (SHA_PATTERN.test(headContent)) return headContent;
    return null;
  } catch {
    return null;
  }
}

async function spawnWithTimeout(cmd: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const [file, ...args] = cmd;
    if (!file) { reject(new Error("empty command")); return; }
    const proc = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => { proc.kill(); reject(new Error("timeout")); }, timeoutMs);
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(`exit ${code}`)); return; }
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

export async function getRemoteCommit(repoPath: string | null): Promise<string | null> {
  if (repoPath) {
    try {
      const out = await spawnWithTimeout(
        ["git", "ls-remote", "origin", "refs/heads/main"],
        repoPath,
        REMOTE_TIMEOUT_MS,
      );
      const sha = out.trim().split(/\s+/)[0];
      if (sha && SHA_PATTERN.test(sha)) return sha;
    } catch { /* fall through to API */ }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
    try {
      const res = await fetch(GITHUB_API_URL, {
        signal: controller.signal,
        headers: { "User-Agent": "Codexa-Update-Checker/1.0" },
      });
      if (!res.ok) return null;
      const data = await res.json() as { object?: { sha?: unknown } };
      const sha = data?.object?.sha;
      return typeof sha === "string" && SHA_PATTERN.test(sha) ? sha : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export interface UpdateCheckOverrides {
  getLocalCommitFn?: (repoPath: string) => Promise<string | null>;
  getRemoteCommitFn?: (repoPath: string | null) => Promise<string | null>;
  findGitRootFn?: (startPath: string) => string | null;
}

export async function checkForUpdates(
  opts?: { enabled?: boolean },
  _overrides?: UpdateCheckOverrides,
): Promise<UpdateCheckResult> {
  if (opts?.enabled === false) {
    return { status: "unknown", localCommit: null, remoteCommit: null, repoPath: null, checkedAt: Date.now() };
  }

  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const findRoot = _overrides?.findGitRootFn ?? findGitRoot;
    const repoPath = findRoot(scriptDir);

    const localFn = _overrides?.getLocalCommitFn ?? getLocalCommit;
    const remoteFn = _overrides?.getRemoteCommitFn ?? getRemoteCommit;

    const localCommit = repoPath
      ? await localFn(repoPath)
      : (BUILD_COMMIT as string) !== "unknown" ? BUILD_COMMIT : null;

    const remoteCommit = await remoteFn(repoPath);

    if (!localCommit || !remoteCommit) {
      return { status: "unknown", localCommit, remoteCommit, repoPath, checkedAt: Date.now() };
    }

    const updateAvailable = localCommit !== remoteCommit;
    return {
      status: updateAvailable ? "update-available" : "up-to-date",
      localCommit,
      remoteCommit,
      repoPath,
      checkedAt: Date.now(),
    };
  } catch (err) {
    return {
      status: "error",
      localCommit: null,
      remoteCommit: null,
      repoPath: null,
      errorMessage: err instanceof Error ? err.message : String(err),
      checkedAt: Date.now(),
    };
  }
}

export function formatUpdateInstructions(result: UpdateCheckResult | null): string {
  const local = result?.localCommit ? `${result.localCommit.slice(0, 8)} (v${APP_VERSION})` : `unknown (v${APP_VERSION})`;
  const remote = result?.remoteCommit ? result.remoteCommit.slice(0, 8) : "unknown";

  let statusLine: string;
  if (result?.status === "update-available") {
    statusLine = "Update available — remote main has newer Codexa changes.";
  } else if (result?.status === "up-to-date") {
    statusLine = "Already up to date.";
  } else if (result?.status === "error") {
    statusLine = `Error checking update status: ${result.errorMessage || "unknown error"}`;
  } else {
    statusLine = "Status unknown — could not reach origin/main.";
  }

  if (result?.repoPath) {
    return [
      `Current commit:  ${local}`,
      `Remote main:     ${remote}`,
      `Status:          ${statusLine}`,
      "",
      "To update Codexa:",
      `  cd ${result.repoPath}`,
      "  git status --short",
      "  git pull origin main",
      "  bun install",
      "  bun run build",
      "  npm install -g .",
      "  hash -r",
      "  codexa --version",
    ].join("\n");
  } else {
    return [
      `Current commit:  ${local}`,
      `Remote main:     ${remote}`,
      `Status:          ${statusLine}`,
      "",
      "To update Codexa:",
      "  cd ~/Development/1-JavaScript/13-Custom-CLI-Normal",
      "  git pull origin main",
      "  bun install",
      "  bun run build",
      "  npm install -g .",
    ].join("\n");
  }
}

