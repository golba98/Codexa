import { posix, win32 } from "path";
import { normalizeWorkspaceRoot } from "./workspaceRoot.js";

type PathStyle = "windows" | "posix";

export interface WorkspacePathViolation {
  rawPath: string;
  normalizedPath: string;
}

const QUOTED_ABSOLUTE_PATH_PATTERN =
  /(["'`])((?:[A-Za-z]:[\\/]|\\\\[^\\/\r\n]+[\\/][^\\/\r\n]+[\\/]|\/)[^"'`\r\n]+?)\1/g;
const QUOTED_RELATIVE_PATH_PATTERN = /(["'`])((?:\.\.?[\\/])[^"'`\r\n]+?)\1/g;
const WINDOWS_DRIVE_PATH_PATTERN = /(?:^|[\s([{\],;=])([A-Za-z]:[\\/][^\s"'`<>|]+)/g;
const WINDOWS_UNC_PATH_PATTERN =
  /(?:^|[\s([{\],;=])(\\\\[^\\/\s"'`<>|]+[\\/][^\\/\s"'`<>|]+(?:[\\/][^\s"'`<>|]+)*)/g;
const POSIX_ABSOLUTE_PATH_PATTERN = /(?:^|[\s([{\],;=])(\/(?:[^\/\s"'`<>|]+\/)+[^\s"'`<>|]+)/g;
const RELATIVE_PATH_PATTERN = /(?:^|[\s([{\],;=])((?:\.\.?[\\/])(?:[^\s"'`<>|]+(?:[\\/][^\s"'`<>|]+)*))/g;
const TRAILING_PUNCTUATION_PATTERN = /[),.;:\]}]+$/;
const DIRECTORY_NAVIGATION_PATTERN = /(?:^|[;&\n]|&&|\|\|)\s*(cd|pushd|set-location)\b/i;

function detectPathStyle(pathValue: string): PathStyle | null {
  if (/^[A-Za-z]:[\\/]/.test(pathValue) || /^\\\\[^\\\/]+[\\\/][^\\\/]+/.test(pathValue)) {
    return "windows";
  }

  if (pathValue.startsWith("/")) {
    return "posix";
  }

  return null;
}

function getPathApi(style: PathStyle) {
  return style === "windows" ? win32 : posix;
}

function stripWrappingQuotes(text: string): string {
  return text.replace(/^["'`]|["'`]$/g, "");
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(TRAILING_PUNCTUATION_PATTERN, "");
}

function isExplicitRelativePath(pathValue: string): boolean {
  return /^(?:\.\.?[\\/])/.test(pathValue);
}

function normalizeAbsolutePath(pathValue: string, style: PathStyle): string {
  const pathApi = getPathApi(style);
  const resolved = pathApi.normalize(pathApi.resolve(pathValue));
  const { root } = pathApi.parse(resolved);

  let normalized = resolved;
  while (normalized.length > root.length && /[\\/]+$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function normalizeComparisonPath(pathValue: string, style: PathStyle): string {
  const normalized = normalizeAbsolutePath(pathValue, style);
  return style === "windows" ? normalized.toLowerCase() : normalized;
}

export function resolveWorkspacePath(pathValue: string, workspaceRoot: string): string {
  const trimmed = stripWrappingQuotes(pathValue.trim());
  const workspaceStyle = detectPathStyle(workspaceRoot) ?? "windows";
  const explicitStyle = detectPathStyle(trimmed);

  if (explicitStyle) {
    return normalizeAbsolutePath(trimmed, explicitStyle);
  }

  const pathApi = getPathApi(workspaceStyle);
  return normalizeAbsolutePath(pathApi.resolve(workspaceRoot, trimmed), workspaceStyle);
}

export function isPathInsideWorkspace(pathValue: string, workspaceRoot: string): boolean {
  const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot);
  const workspaceStyle = detectPathStyle(normalizedWorkspace) ?? "windows";
  const explicitStyle = detectPathStyle(stripWrappingQuotes(pathValue.trim()));

  if (explicitStyle && explicitStyle !== workspaceStyle) {
    return false;
  }

  const pathApi = getPathApi(workspaceStyle);
  const workspaceForComparison = normalizeComparisonPath(normalizedWorkspace, workspaceStyle);
  const targetForComparison = normalizeComparisonPath(
    resolveWorkspacePath(pathValue, normalizedWorkspace),
    workspaceStyle,
  );
  const relativePath = pathApi.relative(workspaceForComparison, targetForComparison);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !pathApi.isAbsolute(relativePath))
  );
}

export function extractExplicitPathReferences(text: string): string[] {
  const matches: string[] = [];
  const seen = new Set<string>();

  const addMatch = (candidate: string) => {
    const cleaned = stripTrailingPunctuation(stripWrappingQuotes(candidate.trim()));
    if (!cleaned || (!detectPathStyle(cleaned) && !isExplicitRelativePath(cleaned))) {
      return;
    }

    const comparisonKey = detectPathStyle(cleaned) === "posix" ? cleaned : cleaned.toLowerCase();
    if (seen.has(comparisonKey)) {
      return;
    }

    seen.add(comparisonKey);
    matches.push(cleaned);
  };

  for (const pattern of [
    QUOTED_ABSOLUTE_PATH_PATTERN,
    QUOTED_RELATIVE_PATH_PATTERN,
    WINDOWS_DRIVE_PATH_PATTERN,
    WINDOWS_UNC_PATH_PATTERN,
    POSIX_ABSOLUTE_PATH_PATTERN,
    RELATIVE_PATH_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      addMatch(match[2] ?? match[1] ?? "");
      match = pattern.exec(text);
    }
  }

  return matches;
}

export function findOutsideWorkspacePaths(
  text: string,
  workspaceRoot: string,
): WorkspacePathViolation[] {
  const violations: WorkspacePathViolation[] = [];
  const seen = new Set<string>();
  const workspaceStyle = detectPathStyle(workspaceRoot) ?? "windows";

  for (const rawPath of extractExplicitPathReferences(text)) {
    if (isPathInsideWorkspace(rawPath, workspaceRoot)) {
      continue;
    }

    const explicitStyle = detectPathStyle(rawPath) ?? workspaceStyle;
    const normalizedPath = detectPathStyle(rawPath)
      ? normalizeAbsolutePath(rawPath, explicitStyle)
      : resolveWorkspacePath(rawPath, workspaceRoot);
    const comparisonKey = explicitStyle === "windows" ? normalizedPath.toLowerCase() : normalizedPath;

    if (seen.has(comparisonKey)) {
      continue;
    }

    seen.add(comparisonKey);
    violations.push({ rawPath, normalizedPath });
  }

  return violations;
}

export function containsDirectoryNavigationCommand(command: string): boolean {
  return DIRECTORY_NAVIGATION_PATTERN.test(command);
}

function formatOutsidePathBlockMessage(
  heading: string,
  workspaceRoot: string,
  violations: WorkspacePathViolation[],
): string {
  const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot);
  const paths = violations.map((item) => `  - ${item.normalizedPath}`).join("\n");

  return [
    heading,
    `Locked workspace: ${normalizedWorkspace}`,
    "Outside path references:",
    paths,
    "Use relative paths inside this workspace, or relaunch the CLI from the folder you want to edit.",
  ].join("\n");
}

export function getPromptWorkspaceGuardMessage(prompt: string, workspaceRoot: string): string | null {
  const violations = findOutsideWorkspacePaths(prompt, workspaceRoot);
  if (violations.length === 0) {
    return null;
  }

  return formatOutsidePathBlockMessage(
    "Run blocked: this session can only work inside the locked workspace.",
    workspaceRoot,
    violations,
  );
}

export function getShellWorkspaceGuardMessage(command: string, workspaceRoot: string): string | null {
  if (containsDirectoryNavigationCommand(command)) {
    return [
      "Shell command blocked: this session is locked to the launch folder.",
      `Locked workspace: ${normalizeWorkspaceRoot(workspaceRoot)}`,
      "Directory-changing commands like cd, Set-Location, and pushd are disabled here.",
    ].join("\n");
  }

  const violations = findOutsideWorkspacePaths(command, workspaceRoot);
  if (violations.length === 0) {
    return null;
  }

  return formatOutsidePathBlockMessage(
    "Shell command blocked: it references paths outside the locked workspace.",
    workspaceRoot,
    violations,
  );
}
