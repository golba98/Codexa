import { accessSync, constants, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { getHomeDir } from "../config/settings.js";
import { buildSpawnSpec, findExecutable } from "../core/executables/executableResolver.js";
import { runCommand } from "../core/process/commandRunner.js";

import { getProviderOrder } from "../core/providerLauncher/registry.js";
import type { ProviderId, ProviderWorkspaceConfig } from "../core/providerLauncher/types.js";
import { resolveLocalProviderConfig } from "../core/providerRuntime/local.js";
import { getProviderRuntime, isProviderRoutableInUbume } from "../core/providerRuntime/registry.js";
import { sanitizeTerminalOutput } from "../core/terminal/terminalSanitize.js";
import { resolveUbumeWorkspaceDataDir } from "../core/workspace/appData.js";

interface DiagnosticCheck {
  name: string;
  status: "pass" | "fail" | "warn" | "skipped";
  message: string;
}
export function redact(value: unknown, extraSecrets: readonly string[] = []): unknown {
  const secrets = [
    ...extraSecrets,
    ...Object.entries(process.env)
      .filter(([key]) => /(?:KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL)/i.test(key))
      .map(([, val]) => val ?? ""),
  ].filter((text) => text.length >= 4);
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") {
      let text = sanitizeTerminalOutput(item)
        .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[redacted]@")
        .replace(/([?&](?:api[_-]?key|token|secret|password)=)[^&\s]+/gi, "$1[redacted]");
      for (const secret of secrets) text = text.split(secret).join("[redacted]");
      return text;
    }
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([key, val]) => [
          key,
          /api[_-]?key|authorization|cookie|password|secret|credential|(?:access|refresh|auth)[_-]?token|^token$/i.test(
            key,
          )
            ? "[redacted]"
            : walk(val),
        ]),
      );
    return item;
  };
  return walk(value);
}
export function providerExecutable(id: ProviderId, config: ProviderWorkspaceConfig): string | null {
  const override = config.providers?.[id];
  if (id === "openai") return override?.codexCommandPath ?? process.env.CODEX_EXECUTABLE ?? "codex";
  if (id === "anthropic")
    return override?.claudeCommandPath ?? process.env.CLAUDE_EXECUTABLE ?? "claude";
  if (id === "google")
    return override?.antigravityCommandPath ?? process.env.AGY_EXECUTABLE ?? "agy";
  if (id === "mistral")
    return typeof override?.command === "string"
      ? override.command
      : (override?.command?.executable ?? process.env.VIBE_EXECUTABLE ?? "vibe");
  return null;
}
async function diagnosticCommand(executable: string, args: string[], cwd: string) {
  const runner = runCommand({
    ...buildSpawnSpec(executable, args),
    cwd,
    timeoutMs: 8000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  });
  const result = await runner.result;
  await runner.stopped;
  return result;
}
export function listProviderStatus(config: ProviderWorkspaceConfig, cwd: string) {
  return getProviderOrder().map((id) => {
    const runtime = getProviderRuntime(id);
    const command = providerExecutable(id, config);
    const executable = command ? findExecutable(command, cwd) : null;
    const routable = isProviderRoutableInUbume(id) && config.providers?.[id]?.enabled !== false;
    return {
      id,
      label: runtime.label,
      backendKind: runtime.backendKind,
      routable,
      executable,
      configured:
        id === "local"
          ? !!(config.providers?.local?.baseUrl || process.env.UBUME_LOCAL_BASE_URL)
          : id === "anthropic"
            ? !!executable || !!process.env.ANTHROPIC_API_KEY
            : command
              ? !!executable
              : (runtime.isRouteConfigured?.() ?? false),
      auth:
        id === "anthropic" && process.env.ANTHROPIC_API_KEY
          ? "API key present (unverified)"
          : id === "openai" &&
              existsSync(join(process.env.CODEX_HOME ?? join(getHomeDir(), ".codex"), "auth.json"))
            ? "Auth file present (unverified)"
            : "Not checked; use doctor --probe",
    };
  });
}
export async function doctor(
  workspace: string,
  config: ProviderWorkspaceConfig,
  selected: ProviderId,
  probe: boolean,
): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [
    { name: "runtime", status: "pass", message: `Bun ${process.versions.bun ?? "unknown"}` },
  ];
  try {
    accessSync(workspace, constants.R_OK);
    checks.push({ name: "workspace", status: "pass", message: workspace });
  } catch {
    checks.push({ name: "workspace", status: "fail", message: "Workspace cannot be read." });
  }
  const storage = resolveUbumeWorkspaceDataDir(workspace, { readOnly: true });
  let parent = storage;
  while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
  try {
    accessSync(parent, constants.R_OK | constants.W_OK);
    checks.push({
      name: "storage",
      status: "pass",
      message: `${storage} (nearest existing directory is accessible)`,
    });
  } catch {
    checks.push({
      name: "storage",
      status: "fail",
      message: `Session storage is unavailable: ${storage}`,
    });
  }
  for (const provider of listProviderStatus(config, workspace)) {
    const required = provider.id === selected;
    checks.push({
      name: `provider:${provider.id}`,
      status:
        provider.routable && (provider.configured || provider.id === "local")
          ? "pass"
          : required
            ? "fail"
            : "warn",
      message: `${provider.label}: ${provider.executable ?? (provider.id === "local" ? "OpenAI-compatible endpoint" : "executable/configuration unavailable")}; ${provider.auth}`,
    });
    if (provider.executable) {
      const version = await diagnosticCommand(provider.executable, ["--version"], workspace);
      checks.push({
        name: `version:${provider.id}`,
        status: version.exitCode === 0 ? "pass" : required ? "fail" : "warn",
        message:
          version.exitCode === 0
            ? (version.stdout.trim().split("\n")[0] ?? "Available")
            : version.userMessage,
      });
    }
    if (!probe || !required) continue;
    if (provider.id === "openai" || provider.id === "anthropic") {
      if (provider.id === "anthropic" && process.env.ANTHROPIC_API_KEY && !provider.executable) {
        checks.push({
          name: "auth:anthropic",
          status: "skipped",
          message: "API key present; no non-inference auth endpoint available.",
        });
      } else if (provider.executable) {
        const auth = await diagnosticCommand(
          provider.executable,
          provider.id === "openai" ? ["login", "status"] : ["auth", "status", "--json"],
          workspace,
        );
        let loggedIn = auth.exitCode === 0;
        if (provider.id === "anthropic") {
          try {
            loggedIn = loggedIn && JSON.parse(auth.stdout).loggedIn !== false;
          } catch {
            /* Older CLI returns plain text. */
          }
        }
        checks.push({
          name: `auth:${provider.id}`,
          status: loggedIn ? "pass" : "fail",
          message: loggedIn
            ? "Authentication status command succeeded."
            : "Authentication unavailable; use the provider CLI to sign in.",
        });
      }
    } else if (provider.id === "local") {
      const local = resolveLocalProviderConfig(config.providers?.local);
      try {
        const response = await fetch(`${local.baseUrl.replace(/\/$/, "")}/models`, {
          signal: AbortSignal.timeout(8000),
          headers: { Authorization: `Bearer ${local.apiKey}` },
        });
        checks.push({
          name: "connectivity:local",
          status: response.ok ? "pass" : "fail",
          message: `Models endpoint returned HTTP ${response.status}.`,
        });
        await response.body?.cancel();
      } catch {
        checks.push({
          name: "connectivity:local",
          status: "fail",
          message: "Models endpoint could not be reached within 8 seconds.",
        });
      }
    } else
      checks.push({
        name: `auth:${provider.id}`,
        status: "skipped",
        message: "No non-inference auth probe supported.",
      });
  }
  if (!probe)
    checks.push({
      name: "network/auth",
      status: "skipped",
      message: "Use --probe for connectivity/auth checks. No model prompt is submitted.",
    });
  const git = findExecutable("git", workspace);
  if (git) {
    const result = await diagnosticCommand(git, ["rev-parse", "--absolute-git-dir"], workspace);
    if (result.exitCode === 0) {
      const gitDir = result.stdout.trim();
      checks.push({
        name: "git",
        status: existsSync(join(gitDir, "index.lock")) ? "warn" : "pass",
        message: existsSync(join(gitDir, "index.lock"))
          ? "Git index lock exists."
          : `Repository: ${gitDir}; no write test performed.`,
      });
      if (probe) {
        const remote = await diagnosticCommand(git, ["ls-remote", "origin", "HEAD"], workspace);
        checks.push({
          name: "git:remote",
          status: remote.exitCode === 0 ? "pass" : "warn",
          message: remote.exitCode === 0 ? "Origin is reachable." : "Origin unavailable or absent.",
        });
      }
    } else
      checks.push({ name: "git", status: "warn", message: "Workspace is not a Git repository." });
  }
  return checks;
}
