import { APP_VERSION } from "../config/settings.js";
import { isLocalDevChannel } from "./channel.js";

export const CODEXA_NPM_PACKAGE = "@golba98/codexa";
export const CODEXA_NPM_REGISTRY_URL = "https://registry.npmjs.org/@golba98%2Fcodexa";
export const CODEXA_UPDATE_COMMAND = `npm install -g ${CODEXA_NPM_PACKAGE}`;

export type UpdateStatus = "up-to-date" | "update-available" | "unknown" | "error";

export interface NpmRegistryMetadata {
  "dist-tags": { latest?: string };
}

export interface UpdateCheckResult {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  errorMessage?: string;
  checkedAt: number;
}

const FETCH_TIMEOUT_MS = 5000;

export function shouldRunStartupUpdateCheck(
  env: NodeJS.ProcessEnv = process.env,
  enabled = true,
): boolean {
  return enabled && !isLocalDevChannel(env);
}

// Compares two semver strings numerically. Returns negative if a < b, 0 if equal, positive if a > b.
// Pre-release versions (e.g. 1.0.2-beta.1) sort below their release counterpart (1.0.2 > 1.0.2-beta.1).
export function compareSemver(a: string, b: string): number {
  const parseParts = (v: string): { numeric: number[]; prerelease: string | null } => {
    const dashIdx = v.indexOf("-");
    const base = dashIdx === -1 ? v : v.slice(0, dashIdx);
    const prerelease = dashIdx === -1 ? null : v.slice(dashIdx + 1);
    const numeric = base.split(".").map((p) => parseInt(p, 10) || 0);
    return { numeric, prerelease };
  };

  const pa = parseParts(a);
  const pb = parseParts(b);
  const len = Math.max(pa.numeric.length, pb.numeric.length);

  for (let i = 0; i < len; i++) {
    const diff = (pa.numeric[i] ?? 0) - (pb.numeric[i] ?? 0);
    if (diff !== 0) return diff;
  }

  // Same numeric version: no pre-release > has pre-release
  if (pa.prerelease === null && pb.prerelease !== null) return 1;
  if (pa.prerelease !== null && pb.prerelease === null) return -1;
  if (pa.prerelease !== null && pb.prerelease !== null) {
    return pa.prerelease < pb.prerelease ? -1 : pa.prerelease > pb.prerelease ? 1 : 0;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) > 0;
}

export interface UpdateCheckOverrides {
  currentVersion?: string;
  fetchNpmMetadataFn?: (url: string) => Promise<NpmRegistryMetadata>;
}

async function defaultFetchNpmMetadata(url: string): Promise<NpmRegistryMetadata> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": `${CODEXA_NPM_PACKAGE}-update-checker/1.0` },
    });
    if (!res.ok) throw new Error(`npm registry returned HTTP ${res.status}`);
    return await res.json() as NpmRegistryMetadata;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForUpdates(
  opts?: { enabled?: boolean },
  overrides?: UpdateCheckOverrides,
): Promise<UpdateCheckResult> {
  const currentVersion = overrides?.currentVersion ?? APP_VERSION;

  if (opts?.enabled === false) {
    return { status: "unknown", currentVersion, latestVersion: null, checkedAt: Date.now() };
  }

  try {
    const fetchFn = overrides?.fetchNpmMetadataFn ?? defaultFetchNpmMetadata;
    const metadata = await fetchFn(CODEXA_NPM_REGISTRY_URL);
    const latestVersion = metadata["dist-tags"]?.latest;

    if (!latestVersion) {
      return {
        status: "error",
        currentVersion,
        latestVersion: null,
        errorMessage: "npm registry response did not include dist-tags.latest",
        checkedAt: Date.now(),
      };
    }

    const status = isNewerVersion(latestVersion, currentVersion) ? "update-available" : "up-to-date";
    return { status, currentVersion, latestVersion, checkedAt: Date.now() };
  } catch (err) {
    return {
      status: "error",
      currentVersion,
      latestVersion: null,
      errorMessage: err instanceof Error ? err.message : String(err),
      checkedAt: Date.now(),
    };
  }
}

export function formatUpdateInstructions(result: UpdateCheckResult | null): string {
  const current = result?.currentVersion ?? APP_VERSION;
  const latest = result?.latestVersion ?? "unknown";

  if (result?.status === "error") {
    return [
      `Current installed version: ${current}`,
      `npm latest version:        ${latest}`,
      `Error checking npm update status: ${result.errorMessage ?? "unknown error"}`,
    ].join("\n");
  }

  let statusLine: string;
  if (result?.status === "update-available" && result.latestVersion) {
    statusLine = `Update available: Codexa ${result.latestVersion} is available. You are using ${current}.`;
  } else if (result?.status === "up-to-date") {
    statusLine = "Already up to date.";
  } else {
    statusLine = "Status unknown — could not reach npm registry.";
  }

  return [
    `Current installed version: ${current}`,
    `npm latest version:        ${latest}`,
    `Status:          ${statusLine}`,
    "",
    `Run: ${CODEXA_UPDATE_COMMAND}@latest`,
  ].join("\n");
}

export function formatLocalDevUpdateStatus(): string {
  return [
    "Running local-dev Codexa.",
    "Automatic published npm update prompts are disabled for this channel.",
    "Run /update check to explicitly check the published npm package.",
  ].join("\n");
}
