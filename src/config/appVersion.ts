import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { APP_VERSION as BUILD_INFO_VERSION } from "./buildInfo.js";

// Leaf module: must not import settings.ts or anything under src/core/version
// (settings.ts re-exports APP_VERSION from here, so that would be a cycle).

const CODEXA_PACKAGE_NAME = "@golba98/codexa";
const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

function readPackageVersion(packageJsonPath: string, requireName?: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    if (requireName !== undefined && parsed.name !== requireName) return null;
    if (typeof parsed.version !== "string") return null;
    const version = parsed.version.trim();
    return SEMVER_RE.test(version) ? version : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the version of the running Codexa install:
 * 1. `CODEXA_PACKAGE_ROOT` (set by bin/codexa.js) → that package.json's version
 * 2. Walk up from this module for a package.json named "@golba98/codexa" (local dev)
 * 3. The committed buildInfo.ts APP_VERSION as the last resort
 *
 * `startDir` overrides the walk-up starting directory (test seam).
 */
export function resolveAppVersion(
  env: NodeJS.ProcessEnv = process.env,
  startDir?: string,
): string {
  const packageRoot = env.CODEXA_PACKAGE_ROOT?.trim();
  if (packageRoot) {
    const version = readPackageVersion(join(packageRoot, "package.json"));
    if (version) return version;
  }

  let dir = startDir ?? dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const version = readPackageVersion(join(dir, "package.json"), CODEXA_PACKAGE_NAME);
    if (version) return version;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return BUILD_INFO_VERSION;
}

let cachedVersion: string | null = null;

/** Cached form of resolveAppVersion() — the installed version cannot change mid-process. */
export function getAppVersion(): string {
  if (cachedVersion === null) {
    cachedVersion = resolveAppVersion();
  }
  return cachedVersion;
}
