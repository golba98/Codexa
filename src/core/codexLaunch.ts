import { fileURLToPath } from "url";
import { buildCodexExecArgs, type BuildCodexExecArgsOptions, type BuildCodexExecArgsResult } from "./codexExecArgs.js";
import { getCodexCliCapabilities, type CodexCliCapabilities } from "./codexCapabilities.js";
import { resolveCodexExecutable } from "./codexExecutable.js";
import * as perf from "./perf/profiler.js";

export interface PreparedCodexExecLaunch {
  executable: string;
  capabilities: CodexCliCapabilities;
  args: string[];
  strategy: BuildCodexExecArgsResult["strategy"];
  responsibleModulePath: string;
  responsibleModuleKind: "src" | "built-artifact" | "other";
  launchContext: {
    launchKind?: string;
    packageRoot?: string;
    launcherScript?: string;
  };
}

interface PrepareCodexExecLaunchDependencies {
  resolveExecutable?: typeof resolveCodexExecutable;
  getCapabilities?: typeof getCodexCliCapabilities;
  diagnosticsLogger?: (message: string) => void;
}

function resolveResponsibleModulePath(moduleUrl: string): string {
  if (moduleUrl.startsWith("file:")) {
    return fileURLToPath(moduleUrl);
  }

  return moduleUrl;
}

function classifyResponsibleModule(modulePath: string): "src" | "built-artifact" | "other" {
  if (/[\\/]src[\\/]/i.test(modulePath)) {
    return "src";
  }

  if (/[\\/](dist|build|out|lib)[\\/]/i.test(modulePath)) {
    return "built-artifact";
  }

  return "other";
}

function shouldLogCodexLaunchDiagnostics(): boolean {
  return process.env.CODEXA_DEBUG_CODEX_LAUNCH === "1";
}

function logCodexLaunchDiagnostics(
  options: BuildCodexExecArgsOptions,
  prepared: PreparedCodexExecLaunch,
  logger: ((message: string) => void) | undefined,
): void {
  if (!logger || !shouldLogCodexLaunchDiagnostics()) {
    return;
  }

  const { capabilities, launchContext } = prepared;
  const debugLines = [
    "[codexa] codex launch debug",
    `  responsible module: ${prepared.responsibleModulePath} (${prepared.responsibleModuleKind})`,
    `  launch kind: ${launchContext.launchKind ?? "unknown"}`,
    `  package root: ${launchContext.packageRoot ?? "unknown"}`,
    `  launcher script: ${launchContext.launcherScript ?? "unknown"}`,
    `  resolved executable: ${prepared.executable}`,
    "  capabilities:",
    `    askForApproval=${capabilities.askForApproval}`,
    `    sandbox=${capabilities.sandbox}`,
    `    config=${capabilities.config}`,
    `    fullAuto=${capabilities.fullAuto}`,
    `  chosen strategy: ${prepared.strategy}`,
    `  structured output: ${options.structuredOutput ?? true}`,
    `  runtime model: ${options.runtime.model}`,
    `  runtime mode: ${options.runtime.mode}`,
    `  final argv: ${JSON.stringify(prepared.args)}`,
  ];

  logger(debugLines.join("\n"));
}

export async function prepareCodexExecLaunch(
  options: BuildCodexExecArgsOptions,
  responsibleModuleUrl: string,
  dependencies: PrepareCodexExecLaunchDependencies = {},
): Promise<BuildCodexExecArgsResult & {
  executable?: string;
  capabilities?: CodexCliCapabilities;
  responsibleModulePath?: string;
  responsibleModuleKind?: PreparedCodexExecLaunch["responsibleModuleKind"];
  launchContext?: PreparedCodexExecLaunch["launchContext"];
}> {
  const executableResolver = dependencies.resolveExecutable ?? resolveCodexExecutable;
  const capabilityResolver = dependencies.getCapabilities ?? getCodexCliCapabilities;
  const diagnosticsLogger = dependencies.diagnosticsLogger;
  perf.mark("exec_resolve_start");
  const executable = await executableResolver();
  perf.mark("exec_resolve_end");
  perf.mark("caps_probe_start");
  const capabilities = await capabilityResolver(executable);
  perf.mark("caps_probe_end");
  const argsResult = buildCodexExecArgs(options, capabilities);
  const responsibleModulePath = resolveResponsibleModulePath(responsibleModuleUrl);
  const responsibleModuleKind = classifyResponsibleModule(responsibleModulePath);
  const launchContext = {
    launchKind: process.env.CODEXA_LAUNCH_KIND,
    packageRoot: process.env.CODEXA_PACKAGE_ROOT,
    launcherScript: process.env.CODEXA_LAUNCHER_SCRIPT,
  };

  if (!argsResult.ok) {
    return {
      ...argsResult,
      executable,
      capabilities,
      responsibleModulePath,
      responsibleModuleKind,
      launchContext,
    };
  }

  const prepared: PreparedCodexExecLaunch = {
    executable,
    capabilities,
    args: argsResult.args,
    strategy: argsResult.strategy,
    responsibleModulePath,
    responsibleModuleKind,
    launchContext,
  };

  logCodexLaunchDiagnostics(options, prepared, diagnosticsLogger);

  return {
    ...argsResult,
    executable: prepared.executable,
    capabilities: prepared.capabilities,
    responsibleModulePath: prepared.responsibleModulePath,
    responsibleModuleKind: prepared.responsibleModuleKind,
    launchContext: prepared.launchContext,
  };
}
