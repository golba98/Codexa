import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface ProjectInstructions {
  path: string;
  content: string;
}

export type ProjectInstructionsLoadResult =
  | { status: "loaded"; instructions: ProjectInstructions }
  | { status: "missing" }
  | { status: "error"; path: string; message: string };

const PROJECT_INSTRUCTION_CANDIDATES = [
  "AGENTS.md",
  join(".codex", "AGENTS.md"),
] as const;

export function loadProjectInstructions(workspaceRoot: string): ProjectInstructionsLoadResult {
  let firstError: Extract<ProjectInstructionsLoadResult, { status: "error" }> | null = null;

  for (const relativePath of PROJECT_INSTRUCTION_CANDIDATES) {
    const candidatePath = join(workspaceRoot, relativePath);
    if (!existsSync(candidatePath)) {
      continue;
    }

    try {
      const content = readFileSync(candidatePath, "utf8").trim();
      if (!content) {
        continue;
      }
      return {
        status: "loaded",
        instructions: {
          path: candidatePath,
          content,
        },
      };
    } catch (error) {
      firstError ??= {
        status: "error",
        path: candidatePath,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (firstError) {
    return firstError;
  }

  return { status: "missing" };
}
