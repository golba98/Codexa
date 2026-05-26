import { parse, resolve, win32 } from "path";

function isWindowsStylePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p);
}

export function normalizeWorkspaceRoot(pathValue: string): string {
  let candidate = pathValue.trim();
  // Guard against obviously unsafe values that could break command-line parsing.
  if (candidate.includes("\n") || candidate.includes("\r") || candidate.includes("\0")) {
    candidate = process.cwd();
  }

  if (isWindowsStylePath(candidate)) {
    const resolved = win32.normalize(candidate);
    const { root } = win32.parse(resolved);
    let normalized = resolved;
    while (normalized.length > root.length && /[\\/]+$/.test(normalized)) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  const resolved = resolve(candidate);
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
