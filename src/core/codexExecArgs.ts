import { formatRuntimePolicySummary, type RuntimePolicy } from "../config/settings.js";
import type { CodexCliCapabilities } from "./codexCapabilities.js";

export interface BuildCodexExecArgsOptions {
  model: string;
  cwd: string;
  runtimePolicy: RuntimePolicy;
  reasoningLevel?: string;
  structuredOutput?: boolean;
}

export type CodexLaunchStrategy =
  | "direct-flags"
  | "config-overrides"
  | "full-auto"
  | "fail";

export type BuildCodexExecArgsResult =
  | { ok: true; args: string[]; strategy: Exclude<CodexLaunchStrategy, "fail"> }
  | { ok: false; error: string; strategy: "fail" };

function sanitizeWorkingDirectory(cwd: string): string {
  if (cwd.includes("\n") || cwd.includes("\r") || cwd.includes("\0")) {
    return process.cwd();
  }

  return cwd;
}

function isFullAutoRuntimePolicy(runtimePolicy: RuntimePolicy): boolean {
  return runtimePolicy.approvalPolicy === "never" && runtimePolicy.sandboxMode === "danger-full-access";
}

function buildCapabilitySummary(capabilities: CodexCliCapabilities): string {
  const supported: string[] = [];

  if (capabilities.askForApproval) supported.push("--ask-for-approval");
  if (capabilities.sandbox) supported.push("--sandbox");
  if (capabilities.config) supported.push("--config/-c");
  if (capabilities.fullAuto) supported.push("--full-auto");

  return supported.length > 0 ? supported.join(", ") : "none";
}

function buildRuntimePolicyArgs(
  runtimePolicy: RuntimePolicy,
  capabilities: CodexCliCapabilities,
): BuildCodexExecArgsResult {
  const args: string[] = [];
  const missingDirectApproval = !capabilities.askForApproval;
  const missingDirectSandbox = !capabilities.sandbox;

  if (!missingDirectApproval && !missingDirectSandbox) {
    args.push("--ask-for-approval", runtimePolicy.approvalPolicy);
    args.push("--sandbox", runtimePolicy.sandboxMode);
    return { ok: true, args, strategy: "direct-flags" };
  }

  if (isFullAutoRuntimePolicy(runtimePolicy) && capabilities.fullAuto) {
    args.push("--full-auto");
    return { ok: true, args, strategy: "full-auto" };
  }

  if (capabilities.config) {
    if (capabilities.askForApproval) {
      args.push("--ask-for-approval", runtimePolicy.approvalPolicy);
    } else {
      args.push("-c", `approval_policy=${runtimePolicy.approvalPolicy}`);
    }

    if (capabilities.sandbox) {
      args.push("--sandbox", runtimePolicy.sandboxMode);
    } else {
      args.push("-c", `sandbox_mode=${runtimePolicy.sandboxMode}`);
    }

    return { ok: true, args, strategy: "config-overrides" };
  }

  return {
    ok: false,
    strategy: "fail",
    error: [
      `Installed Codex CLI cannot safely apply the requested runtime policy: ${formatRuntimePolicySummary(runtimePolicy)}.`,
      `Detected launch controls: ${buildCapabilitySummary(capabilities)}.`,
      "Update Codex or choose a policy that your installed CLI can represent.",
    ].join("\n"),
  };
}

export function buildCodexExecArgs(
  options: BuildCodexExecArgsOptions,
  capabilities: CodexCliCapabilities,
): BuildCodexExecArgsResult {
  const args: string[] = ["exec"];

  if (options.structuredOutput ?? true) {
    args.push("--experimental-json");
  }

  args.push(
    "--skip-git-repo-check",
    "--cd",
    sanitizeWorkingDirectory(options.cwd),
    "--model",
    options.model,
  );

  if (options.reasoningLevel) {
    if (!capabilities.config) {
      return {
        ok: false,
        strategy: "fail",
        error: [
          `Installed Codex CLI cannot safely apply the selected reasoning level "${options.reasoningLevel}".`,
          `Detected launch controls: ${buildCapabilitySummary(capabilities)}.`,
          "This Codex version does not support --config / -c overrides.",
        ].join("\n"),
      };
    }

    args.push("--config", `reasoning.effort=${options.reasoningLevel}`);
  }

  const policyArgs = buildRuntimePolicyArgs(options.runtimePolicy, capabilities);
  if (!policyArgs.ok) {
    return policyArgs;
  }

  args.push(...policyArgs.args, "-");
  return { ok: true, args, strategy: policyArgs.strategy };
}
