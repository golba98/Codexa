import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeRuntimeConfig, resolveRuntimeConfig, type ResolvedRuntimeConfig } from "../../config/runtimeConfig.js";
import { executeAgentTool } from "./tools.js";

function runtime(sandboxMode: ResolvedRuntimeConfig["policy"]["sandboxMode"]): ResolvedRuntimeConfig {
  return resolveRuntimeConfig(normalizeRuntimeConfig({
    policy: {
      sandboxMode,
    },
  }));
}

async function withTempWorkspace<T>(callback: (workspaceRoot: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexa-agent-tools-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("read-only policy blocks write_file, apply_patch, and run_shell", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const context = { workspaceRoot, runtime: runtime("read-only") };

    const write = await executeAgentTool("write_file", { path: "a.txt", content: "x" }, context);
    const patch = await executeAgentTool("apply_patch", { patch: "*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch\n" }, context);
    const shell = await executeAgentTool("run_shell", { command: "echo hi" }, context);

    assert.equal(write.success, false);
    assert.equal(patch.success, false);
    assert.equal(shell.success, false);
  });
});

test("full access allows a safe write and read cycle", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const context = { workspaceRoot, runtime: runtime("danger-full-access") };

    const write = await executeAgentTool("write_file", { path: "hello.txt", content: "hello" }, context);
    const read = await executeAgentTool("read_file", { path: "hello.txt" }, context);

    assert.equal(write.success, true);
    assert.equal(read.success, true);
    assert.equal(read.output, "hello");
  });
});

test("outside-workspace paths are blocked", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await executeAgentTool("read_file", { path: "../outside.txt" }, {
      workspaceRoot,
      runtime: runtime("danger-full-access"),
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /outside/i);
  });
});

test("dangerous shell examples are blocked", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await executeAgentTool("run_shell", { command: "rm -rf ." }, {
      workspaceRoot,
      runtime: runtime("danger-full-access"),
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /dangerous/i);
  });
});

test("apply_patch updates a file with context matching", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const context = { workspaceRoot, runtime: runtime("workspace-write") };
    await executeAgentTool("write_file", { path: "main.txt", content: "one\ntwo\nthree\n" }, context);

    const result = await executeAgentTool("apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Update File: main.txt",
        "@@",
        " one",
        "-two",
        "+TWO",
        " three",
        "*** End Patch",
        "",
      ].join("\n"),
    }, context);

    assert.equal(result.success, true);
    assert.equal(await readFile(path.join(workspaceRoot, "main.txt"), "utf8"), "one\nTWO\nthree\n");
  });
});
