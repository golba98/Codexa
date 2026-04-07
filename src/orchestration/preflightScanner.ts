/**
 * Preflight scanner — workspace analysis before Codex execution.
 * Discovers relevant files and emits progressive events.
 */

import { readdirSync, statSync } from "fs";
import { basename, extname, join, relative, sep } from "path";
import type { FileInspectionStatus, TaskType, UIEvent } from "./events.js";
import { extractKeywords, getTaskFlowConfig } from "./taskClassifier.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PreflightScanOptions {
  rootDir: string;
  prompt: string;
  taskType: TaskType;
  maxFiles?: number;
  onEvent: (event: UIEvent) => void;
}

export interface CandidateFile {
  path: string;
  relativePath: string;
  extension: string;
  size: number;
  depth: number;
}

export interface ScoredFile extends CandidateFile {
  relevance: number;
  reason?: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_MAX_FILES = 15;
const MAX_SCAN_DEPTH = 6;
const MAX_DIR_ENTRIES = 500;
const FILE_EMIT_DELAY_MS = 30;

const IGNORED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".turbo",
  ".vercel",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "temp",
  "tmp",
  "vendor",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "venv",
  ".venv",
  "env",
]);

const IGNORED_EXTENSIONS = new Set([
  ".lock",
  ".log",
  ".bak",
  ".tmp",
  ".swp",
  ".swo",
  ".DS_Store",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".obj",
  ".class",
  ".jar",
  ".war",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".webp",
  ".bmp",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wav",
  ".flac",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".pyw",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".c",
  ".cpp",
  ".cc",
  ".cxx",
  ".h",
  ".hpp",
  ".cs",
  ".fs",
  ".rb",
  ".php",
  ".swift",
  ".m",
  ".mm",
  ".lua",
  ".pl",
  ".pm",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".psm1",
  ".sql",
  ".r",
  ".R",
  ".jl",
  ".ex",
  ".exs",
  ".erl",
  ".hrl",
  ".clj",
  ".cljs",
  ".cljc",
  ".elm",
  ".vue",
  ".svelte",
  ".astro",
]);

const CONFIG_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "webpack.config.js",
  "vite.config.ts",
  "rollup.config.js",
  "babel.config.js",
  "jest.config.js",
  "vitest.config.ts",
  ".eslintrc.js",
  ".prettierrc",
  "tailwind.config.js",
  "next.config.js",
  "nuxt.config.ts",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "Makefile",
  "CMakeLists.txt",
  "docker-compose.yml",
  "Dockerfile",
]);

// ─── File Discovery ───────────────────────────────────────────────────────────

function normalizePath(filePath: string): string {
  return filePath.split(sep).join("/");
}

function shouldIgnoreDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith(".");
}

function shouldIgnoreFile(name: string): boolean {
  const ext = extname(name).toLowerCase();
  return IGNORED_EXTENSIONS.has(ext) || name.startsWith(".");
}

/**
 * Scan workspace directory for candidate files.
 */
export function scanWorkspaceFiles(
  rootDir: string,
  maxDepth = MAX_SCAN_DEPTH,
): CandidateFile[] {
  const candidates: CandidateFile[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Limit entries per directory
    const limitedEntries = entries.slice(0, MAX_DIR_ENTRIES);

    for (const entry of limitedEntries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!shouldIgnoreDirectory(entry.name)) {
          walk(fullPath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (shouldIgnoreFile(entry.name)) continue;

      try {
        const stats = statSync(fullPath);
        candidates.push({
          path: fullPath,
          relativePath: normalizePath(relative(rootDir, fullPath)),
          extension: extname(entry.name).toLowerCase(),
          size: stats.size,
          depth,
        });
      } catch {
        // Skip files we can't stat
      }
    }
  }

  walk(rootDir, 0);
  return candidates;
}

// ─── Relevance Scoring ────────────────────────────────────────────────────────

/**
 * Score file relevance based on prompt keywords and task type.
 */
export function scoreFileRelevance(
  file: CandidateFile,
  keywords: string[],
  taskType: TaskType,
): ScoredFile {
  let score = 0;
  const reasons: string[] = [];
  const flowConfig = getTaskFlowConfig(taskType);
  const filename = basename(file.relativePath).toLowerCase();
  const pathLower = file.relativePath.toLowerCase();

  // Priority extension bonus
  if (flowConfig.priorityExtensions.some((ext) => file.extension === ext)) {
    score += 20;
    reasons.push("priority extension");
  }

  // Code file bonus
  if (CODE_EXTENSIONS.has(file.extension)) {
    score += 15;
  }

  // Config file bonus (for general understanding)
  if (CONFIG_FILES.has(filename)) {
    score += 10;
    reasons.push("config file");
  }

  // Keyword matching
  for (const keyword of keywords) {
    const keywordLower = keyword.toLowerCase();

    // Exact filename match (highest value)
    if (filename.includes(keywordLower)) {
      score += 40;
      reasons.push(`matches "${keyword}"`);
    }
    // Path match (moderate value)
    else if (pathLower.includes(keywordLower)) {
      score += 20;
      reasons.push(`path contains "${keyword}"`);
    }
  }

  // Depth penalty (prefer files closer to root)
  score -= file.depth * 2;

  // Size consideration (prefer smaller, more focused files)
  if (file.size < 5000) {
    score += 5;
  } else if (file.size > 50000) {
    score -= 10;
  }

  // Common important file patterns
  if (/^(index|main|app|root)\./i.test(filename)) {
    score += 10;
    reasons.push("entry point");
  }

  if (/\.(test|spec|e2e)\./i.test(filename)) {
    score += 5; // Tests are useful context
    reasons.push("test file");
  }

  if (/^(readme|changelog|license)/i.test(filename)) {
    score += 5;
    reasons.push("documentation");
  }

  return {
    ...file,
    relevance: Math.max(0, score),
    reason: reasons.length > 0 ? reasons.join(", ") : undefined,
  };
}

// ─── Sleep Utility ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main Scanner ─────────────────────────────────────────────────────────────

/**
 * Run preflight workspace scan.
 * Discovers relevant files and emits progressive events.
 */
export async function runPreflightScan(options: PreflightScanOptions): Promise<ScoredFile[]> {
  const {
    rootDir,
    prompt,
    taskType,
    maxFiles = DEFAULT_MAX_FILES,
    onEvent,
  } = options;

  // Emit start event
  onEvent({ type: "files:start", title: "Scanning workspace..." });

  // Extract keywords for relevance scoring
  const keywords = extractKeywords(prompt);

  // Scan workspace
  let candidates: CandidateFile[];
  try {
    candidates = scanWorkspaceFiles(rootDir);
  } catch (error) {
    onEvent({
      type: "warning",
      message: `Workspace scan failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
    onEvent({ type: "files:done", totalCount: 0 });
    return [];
  }

  // Score and rank files
  const scored = candidates.map((file) => scoreFileRelevance(file, keywords, taskType));

  // Sort by relevance (descending) and take top N
  const relevant = scored
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxFiles);

  // Emit file events progressively
  for (let i = 0; i < relevant.length; i++) {
    const file = relevant[i]!;

    // Emit queued status
    onEvent({
      type: "files:item",
      path: file.relativePath,
      status: "queued" as FileInspectionStatus,
      relevance: file.relevance,
      reason: file.reason,
    });

    // Small delay for visual progression
    await sleep(FILE_EMIT_DELAY_MS);

    // Emit analyzed status
    onEvent({
      type: "files:item",
      path: file.relativePath,
      status: "analyzed" as FileInspectionStatus,
      relevance: file.relevance,
      reason: file.reason,
    });
  }

  // Emit done event
  onEvent({ type: "files:done", totalCount: relevant.length });

  return relevant;
}

/**
 * Quick file scan without progressive events.
 * Useful for context gathering.
 */
export function quickScanFiles(
  rootDir: string,
  prompt: string,
  taskType: TaskType,
  maxFiles = DEFAULT_MAX_FILES,
): ScoredFile[] {
  const keywords = extractKeywords(prompt);
  const candidates = scanWorkspaceFiles(rootDir);
  const scored = candidates.map((file) => scoreFileRelevance(file, keywords, taskType));

  return scored
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxFiles);
}

/**
 * Get file paths as a list for context injection.
 */
export function getRelevantFilePaths(
  rootDir: string,
  prompt: string,
  taskType: TaskType,
  maxFiles = DEFAULT_MAX_FILES,
): string[] {
  const files = quickScanFiles(rootDir, prompt, taskType, maxFiles);
  return files.map((f) => f.relativePath);
}
