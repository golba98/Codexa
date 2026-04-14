import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { CODEXA_TRUST_STORE_FILE } from "./settings.js";
import { normalizeWorkspaceRoot } from "../core/workspaceRoot.js";

interface TrustStoreData {
  trustedProjectRoots: string[];
}

function getDefaultTrustStore(): TrustStoreData {
  return { trustedProjectRoots: [] };
}

function parseTrustStoreData(data: unknown): TrustStoreData {
  if (!data || typeof data !== "object") {
    return getDefaultTrustStore();
  }

  const record = data as Record<string, unknown>;
  const trustedProjectRoots = Array.isArray(record.trustedProjectRoots)
    ? record.trustedProjectRoots
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => normalizeWorkspaceRoot(value))
    : [];

  return {
    trustedProjectRoots: Array.from(new Set(trustedProjectRoots)),
  };
}

function loadTrustStore(): TrustStoreData {
  try {
    const text = readFileSync(CODEXA_TRUST_STORE_FILE, "utf-8");
    return parseTrustStoreData(JSON.parse(text));
  } catch {
    return getDefaultTrustStore();
  }
}

function saveTrustStore(data: TrustStoreData): void {
  try {
    mkdirSync(dirname(CODEXA_TRUST_STORE_FILE), { recursive: true });
    const tmpFile = `${CODEXA_TRUST_STORE_FILE}.tmp`;
    writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpFile, CODEXA_TRUST_STORE_FILE);
  } catch {
    // Best-effort persistence only.
  }
}

export function isProjectTrusted(projectRoot: string): boolean {
  const normalizedRoot = normalizeWorkspaceRoot(projectRoot);
  const store = loadTrustStore();
  return store.trustedProjectRoots.includes(normalizedRoot);
}

export function setProjectTrust(projectRoot: string, trusted: boolean): void {
  const normalizedRoot = normalizeWorkspaceRoot(projectRoot);
  const store = loadTrustStore();
  const nextRoots = trusted
    ? Array.from(new Set([...store.trustedProjectRoots, normalizedRoot]))
    : store.trustedProjectRoots.filter((value) => value !== normalizedRoot);

  saveTrustStore({ trustedProjectRoots: nextRoots });
}
