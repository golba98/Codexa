import { formatContextLength } from "../core/providerRuntime/contextMetadata.js";
import { hasGeminiApiKey } from "../core/providerRuntime/gemini.js";
import type { DiagnosticResult, parseRepoIdentity } from "../core/shared/githubDiagnostics.js";

export function formatProviderDiagnostics(
  diags: Record<string, Record<string, string | number | boolean | null>>,
): string {
  const lines: string[] = ["Provider CLI diagnostics:"];
  const providerIds = ["openai", "anthropic", "codexa-native", "local"] as const;
  const labels: Record<string, string> = {
    openai: "OpenAI/Codex",
    anthropic: "Anthropic/Claude",
    local: "Local OpenAI-compatible",
    "codexa-native": "Codexa Native",
  };
  for (const id of providerIds) {
    const diag = diags[id];
    lines.push(`\n  ${labels[id] ?? id}:`);
    if (!diag) {
      lines.push("    No diagnostic data (provider not yet validated).");
      continue;
    }
    const fields: Array<[string, string]> = [
      ["resolvedCommand", "Resolved command"],
      ["executablePath", "Executable path"],
      ["loggedIn", "Logged in"],
      ["authMethod", "Auth method"],
      ["subscriptionType", "Subscription"],
      ["apiProvider", "API provider"],
      ["modelSource", "Model source"],
    ];
    for (const [key, label] of fields) {
      if (diag[key] != null) lines.push(`    ${label}: ${diag[key]}`);
    }
  }
  return lines.join("\n");
}

export function formatGithubDiagnostics(
  repo: ReturnType<typeof parseRepoIdentity>,
  ghCli: DiagnosticResult,
  localGit: DiagnosticResult,
  localGitWrite: DiagnosticResult,
  connector: DiagnosticResult,
  recommendedFlow: string,
): string {
  const tableLines = [
    "Path                | Status  | Evidence                      | Blocker",
    "--------------------|---------|-------------------------------|---------------------------",
    `${ghCli.path.padEnd(20)}| ${ghCli.status.padEnd(8)}| ${(ghCli.evidence || "").substring(0, 30).padEnd(30)}| ${ghCli.blocker || ""}`,
    `${localGit.path.padEnd(20)}| ${localGit.status.padEnd(8)}| ${(localGit.evidence || "").substring(0, 30).padEnd(30)}| ${localGit.blocker || ""}`,
    `${localGitWrite.path.padEnd(20)}| ${localGitWrite.status.padEnd(8)}| ${(localGitWrite.evidence || "").substring(0, 30).padEnd(30)}| ${localGitWrite.blocker || ""}`,
    `${connector.path.padEnd(20)}| ${connector.status.padEnd(8)}| ${(connector.evidence || "").substring(0, 30).padEnd(30)}| ${connector.blocker || ""}`,
  ];
  const summary = [
    ...tableLines,
    "",
    `Resolved repo: ${repo ? `${repo.owner}/${repo.repo}` : "Unknown"}`,
    `Recommended PR flow: ${recommendedFlow}`,
  ].join("\n");
  return summary;
}

export function formatProviderRouteDiagnostics(
  line: string,
  providerId: string,
  diagnostics: Record<string, string | number | boolean | null> | undefined,
): string {
  if (diagnostics && providerId === "google") {
    const lines = [line];
    if (diagnostics.resolvedCommand ?? diagnostics.executablePath)
      lines.push(
        `    Resolved command: ${diagnostics.resolvedCommand ?? diagnostics.executablePath}`,
      );
    if (diagnostics.version) lines.push(`    Version: ${diagnostics.version}`);
    if (diagnostics.headlessPromptMode)
      lines.push(`    Headless prompt mode: ${diagnostics.headlessPromptMode}`);
    lines.push(
      `    Status: ${diagnostics.probeStatus ?? (diagnostics.status === "completed" && diagnostics.exitCode === 0 && diagnostics.probeMatch ? "Ready" : "failed")}`,
    );
    if (diagnostics.lastProbeCommandArgs)
      lines.push(`    Last probe command args: ${diagnostics.lastProbeCommandArgs}`);
    if (
      diagnostics.status !== "completed" ||
      diagnostics.exitCode !== 0 ||
      !diagnostics.probeMatch
    ) {
      const reason = diagnostics.failureReason ?? (diagnostics.timeout ? "timeout" : "unknown");
      lines.push(`    Reason: ${reason}`);
      if (diagnostics.firstUsefulOutputLine)
        lines.push(`    First output: ${diagnostics.firstUsefulOutputLine}`);
    }
    lines.push(`    API fallback: ${hasGeminiApiKey() ? "available" : "unavailable"}`);
    line = lines.join("\n");
  }

  if (diagnostics && providerId === "local") {
    const lines = [line];
    lines.push(`    Base URL: ${diagnostics.baseUrl ?? "unknown"}`);
    lines.push(`    Selected model: ${diagnostics.selectedModel ?? "none"}`);
    lines.push(`    Models: ${diagnostics.discoveredModels || "none"}`);
    lines.push(`    Endpoint check: ${diagnostics.endpointCheckResult ?? "unknown"}`);
    if (diagnostics.errorMessage) lines.push(`    Error: ${diagnostics.errorMessage}`);
    line = lines.join("\n");
  }

  if (diagnostics?.contextSource || diagnostics?.contextError) {
    const contextLength =
      typeof diagnostics.contextLength === "number" ? diagnostics.contextLength : null;
    const lines = line.split("\n");
    lines.push(`    Context: ${formatContextLength(contextLength)}`);
    lines.push(`    Context source: ${diagnostics.contextSource ?? "unknown"}`);
    lines.push(`    Context confidence: ${diagnostics.contextConfidence ?? "unknown"}`);
    if (diagnostics.contextRawField)
      lines.push(`    Context field: ${diagnostics.contextRawField}`);
    if (diagnostics.contextError) lines.push(`    Context reason: ${diagnostics.contextError}`);
    line = lines.join("\n");
  }

  return line;
}
