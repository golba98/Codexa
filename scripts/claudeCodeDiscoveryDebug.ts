import { resolveClaudeExecutable } from "../src/core/executables/executableResolver.js";
import { runCommand } from "../src/core/process/commandRunner.js";
import { errorMessage } from "../src/core/shared/values.js";
import { claudeCodeModelsToProviderModels } from "../src/core/providerRuntime/claudeCodeDiscovery.js";
import { discoverClaudeCodeCapabilities } from "../src/core/providerRuntime/claudeCodeDiscovery.js";
import { discoverModelsFromClaudePackageMetadata } from "../src/core/providerRuntime/claudeCodeDiscovery.js";

async function main(): Promise<void> {
  const cwd = process.cwd();
  const resolvedCommand = await resolveClaudeExecutable({ cwd });
  const versionResult = await runCommand({
    executable: resolvedCommand,
    args: ["--version"],
    cwd,
    timeoutMs: 5_000,
  }).result;
  const packageMetadata = discoverModelsFromClaudePackageMetadata(resolvedCommand);
  const discovery = await discoverClaudeCodeCapabilities({ cwd });
  const normalized = claudeCodeModelsToProviderModels(discovery.models);

  const report = {
    claudeCommand: resolvedCommand,
    claudeBinaryPath: packageMetadata?.sourcePath ?? resolvedCommand,
    claudeVersion:
      versionResult.status === "completed" && versionResult.exitCode === 0
        ? versionResult.stdout.trim()
        : null,
    discoverySourceUsed: discovery.modelSource,
    packageMetadataSource: packageMetadata?.sourcePath ?? null,
    rawDiscoveredModelEntries: packageMetadata?.rawModelIds ?? [],
    normalizedModelEntries: normalized.map((model) => ({
      id: model.modelId,
      label: model.label,
      family: model.family,
      version: model.version,
      canonicalId: model.canonicalId,
      source: model.source,
      isFallback: model.isFallback,
      discoveryKind: model.discoveryKind,
    })),
    fallbackReason:
      discovery.modelSource === "fallback"
        ? (discovery.diagnostics ?? {
            reason:
              "No Claude Code command, package metadata, settings, or config model source returned versioned models.",
          })
        : null,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  await main();
} catch (err) {
  const message = errorMessage(err);
  process.stderr.write(`debug:claude-models failed: ${message}\n`);
  process.exit(1);
}
