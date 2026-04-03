import { parse, resolve } from "path";

export function normalizeWorkspaceRoot(pathValue: string): string {
  const resolved = resolve(pathValue.trim());
  const { root } = parse(resolved);

  let normalized = resolved;
  while (normalized.length > root.length && /[\\/]+$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function resolveWorkspaceRoot(): string {
  const candidates = [
    process.env.CODEX_WORKSPACE_ROOT,
    process.cwd(),
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return normalizeWorkspaceRoot(value);
  }

  return normalizeWorkspaceRoot(process.cwd());
}
