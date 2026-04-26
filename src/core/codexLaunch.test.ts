import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeConfig, normalizeRuntimeConfig } from "../config/runtimeConfig.js";
import { prepareCodexExecLaunch } from "./codexLaunch.js";
import type { CodexCliCapabilities } from "./codexCapabilities.js";

test("prepares a shared launch plan with resolved executable strategy and source metadata", async () => {
  const capabilities: CodexCliCapabilities = {
    askForApproval: false,
    sandbox: true,
    config: true,
    fullAuto: true,
  };

  const result = await prepareCodexExecLaunch(
    {
      runtime: resolveRuntimeConfig(normalizeRuntimeConfig({
        model: "gpt-5.4",
        reasoningLevel: "medium",
        policy: {
          approvalPolicy: "on-request",
          sandboxMode: "workspace-write",
        },
      })),
      cwd: "C:/repo",
      structuredOutput: false,
    },
    "file:///C:/Development/1-JavaScript/13-Custom%20CLI/src/core/providers/codexSubprocess.ts",
    {
      resolveExecutable: async () => "C:/tools/codex.cmd",
      getCapabilities: async () => capabilities,
    },
  );

  assert.deepEqual(result, {
    ok: true,
    strategy: "config-overrides",
    executable: "C:/tools/codex.cmd",
    capabilities,
    responsibleModulePath: "C:\\Development\\1-JavaScript\\13-Custom CLI\\src\\core\\providers\\codexSubprocess.ts",
    responsibleModuleKind: "src",
    launchContext: {
      launchKind: process.env.CODEXA_LAUNCH_KIND,
      packageRoot: process.env.CODEXA_PACKAGE_ROOT,
      launcherScript: process.env.CODEXA_LAUNCHER_SCRIPT,
    },
    args: [
      "exec",
      "--skip-git-repo-check",
      "--cd",
      "C:/repo",
      "--model",
      "gpt-5.4",
      "--config",
      "reasoning.effort=medium",
      "-c",
      "approval_policy=on-request",
      "--sandbox",
      "workspace-write",
      "-",
    ],
  });
});

test("launch diagnostics are injectable and silent by default", async () => {
  const previousDebug = process.env.CODEXA_DEBUG_CODEX_LAUNCH;
  process.env.CODEXA_DEBUG_CODEX_LAUNCH = "1";
  const capabilities: CodexCliCapabilities = {
    askForApproval: false,
    sandbox: true,
    config: true,
    fullAuto: true,
  };

  try {
    const silent = await prepareCodexExecLaunch(
      {
        runtime: resolveRuntimeConfig(normalizeRuntimeConfig({
          model: "gpt-5.4",
          reasoningLevel: "medium",
          policy: {
            approvalPolicy: "on-request",
            sandboxMode: "workspace-write",
          },
        })),
        cwd: "C:/repo",
        structuredOutput: true,
      },
      "file:///C:/repo/src/core/providers/codexSubprocess.ts",
      {
        resolveExecutable: async () => "C:/tools/codex.cmd",
        getCapabilities: async () => capabilities,
      },
    );
    assert.equal(silent.ok, true);

    const diagnostics: string[] = [];
    await prepareCodexExecLaunch(
      {
        runtime: resolveRuntimeConfig(normalizeRuntimeConfig({
          model: "gpt-5.4",
          reasoningLevel: "medium",
          policy: {
            approvalPolicy: "on-request",
            sandboxMode: "workspace-write",
          },
        })),
        cwd: "C:/repo",
        structuredOutput: true,
      },
      "file:///C:/repo/src/core/providers/codexSubprocess.ts",
      {
        resolveExecutable: async () => "C:/tools/codex.cmd",
        getCapabilities: async () => capabilities,
        diagnosticsLogger: (message) => diagnostics.push(message),
      },
    );

    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0]!, /\[codexa\] codex launch debug/);
  } finally {
    if (previousDebug == null) {
      delete process.env.CODEXA_DEBUG_CODEX_LAUNCH;
    } else {
      process.env.CODEXA_DEBUG_CODEX_LAUNCH = previousDebug;
    }
  }
});
