import assert from "node:assert/strict";
import test from "node:test";
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
      model: "gpt-5.4",
      cwd: "C:/repo",
      runtimePolicy: {
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
      },
      reasoningLevel: "medium",
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
