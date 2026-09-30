import { statSync } from "node:fs";
import { resolveAgyExecutable } from "../executables/antigravityExecutable.js";
import { resolveClaudeExecutable } from "../executables/claudeExecutable.js";
import { resolveCodexExecutable } from "../executables/codexExecutable.js";
import { externalSourceLabel, type ExternalSessionSource, type ExternalSessionSummary } from "./types.js";

export interface ExternalResumeLaunch {
  displayName: string;
  executable: string;
  args: string[];
  cwd: string;
}

export type ExternalResumeLaunchResult =
  | { ok: true; launch: ExternalResumeLaunch }
  | { ok: false; message: string };

interface ResumeLaunchOptions {
  /** Folder used when the store does not record one (Antigravity summaries without a workspace). */
  fallbackCwd: string;
  resolveExecutable?: (source: ExternalSessionSource) => Promise<string>;
  folderExists?: (path: string) => boolean;
}

function resumeArgs(summary: ExternalSessionSummary): string[] {
  switch (summary.source) {
    case "claude": return ["--resume", summary.id];
    case "codex": return ["resume", summary.id];
    case "antigravity": return ["--conversation", summary.id];
  }
}

/** Honors CLAUDE_EXECUTABLE / CODEX_EXECUTABLE / AGY_EXECUTABLE like the provider runtimes do. */
function resolveSourceExecutable(source: ExternalSessionSource): Promise<string> {
  switch (source) {
    case "claude": return resolveClaudeExecutable();
    case "codex": return resolveCodexExecutable();
    case "antigravity": return resolveAgyExecutable();
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export async function buildExternalResumeLaunch(summary: ExternalSessionSummary, options: ResumeLaunchOptions): Promise<ExternalResumeLaunchResult> {
  const displayName = externalSourceLabel(summary.source);
  // Claude Code looks sessions up by the project folder they were started in.
  if (summary.source === "claude" && !summary.cwd) {
    return { ok: false, message: `${displayName} resumes a session from its original folder, which this session does not record.` };
  }
  const cwd = summary.cwd ?? options.fallbackCwd;
  if (!(options.folderExists ?? isDirectory)(cwd)) {
    return { ok: false, message: `The session's folder no longer exists: ${cwd}` };
  }
  const executable = await (options.resolveExecutable ?? resolveSourceExecutable)(summary.source);
  return { ok: true, launch: { displayName, executable, args: resumeArgs(summary), cwd } };
}
