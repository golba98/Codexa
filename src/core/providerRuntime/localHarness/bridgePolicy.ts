import { browserDescription, isBrowserTool } from "../../../../bin/ubume-local-browser-tools.js";
import { isRecord } from "../../shared/values.js";
import { mentionsScratchDir } from "../../workspace/scratchDir.js";
import {
  getShellWorkspaceGuardMessage,
  isDangerousShellCommand,
  isPathInsideAllowedRoots,
} from "../../workspace/workspaceGuard.js";
import type { ProviderChatRequest } from "../types.js";

export function normalizedArgs(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function commandFrom(tool: string, args: Record<string, unknown>): string {
  if (isBrowserTool(tool))
    return typeof args.description === "string" ? args.description : browserDescription(tool, args);
  if ((tool === "bash" || tool === "pwsh") && typeof args.command === "string") return args.command;
  if (typeof args.path === "string") return `${tool} ${args.path}`;
  if (typeof args.file_path === "string") return `${tool} ${args.file_path}`;
  return tool;
}

export function pathsFrom(args: Record<string, unknown>): string[] {
  return [args.path, args.file_path, args.old_path, args.new_path].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

export function isMutatingTool(tool: string): boolean {
  return ["bash", "pwsh", "write", "edit", "str_replace_editor"].includes(tool);
}

export interface ToolPolicyDecision {
  kind: "allow" | "deny" | "ask";
  reason?: string;
}

/** Pure tool-policy decision; scratch creation and approval UI remain with the process owner. */
export function decideToolPolicy(
  tool: string,
  args: Record<string, unknown>,
  request: ProviderChatRequest,
  approvals: ReadonlySet<string>,
): { decision: ToolPolicyDecision; ensureScratch: boolean } {
  const result = (decision: ToolPolicyDecision, ensureScratch = false) => ({
    decision,
    ensureScratch,
  });
  if (!isMutatingTool(tool)) return result({ kind: "allow" });
  if (request.runIntent === "plan" || request.runtime.policy.sandboxMode === "read-only")
    return result({ kind: "deny", reason: "Ubume's current runtime policy is read-only." });
  const command = typeof args.command === "string" ? args.command : "";
  if (command && isDangerousShellCommand(command))
    return result({ kind: "deny", reason: "Shell command blocked as dangerous." });
  if (command) {
    const guard = getShellWorkspaceGuardMessage(
      command,
      request.workspaceRoot,
      request.runtime.policy.writableRoots,
    );
    if (guard) return result({ kind: "deny", reason: guard });
  }
  const paths = pathsFrom(args);
  for (const candidatePath of paths) {
    if (
      !isPathInsideAllowedRoots(
        candidatePath,
        request.workspaceRoot,
        request.runtime.policy.writableRoots,
      )
    )
      return result({
        kind: "deny",
        reason: `Path is outside the active workspace: ${candidatePath}`,
      });
  }
  const ensureScratch = [command, ...paths].some(mentionsScratchDir);
  const signature = `${tool}:${command || paths.join(",")}`;
  if (approvals.has(signature)) return result({ kind: "allow" }, ensureScratch);
  return result(
    request.runtime.policy.approvalPolicy === "on-request"
      ? { kind: "ask", reason: `Allow ${commandFrom(tool, args)}?` }
      : { kind: "allow" },
    ensureScratch,
  );
}
