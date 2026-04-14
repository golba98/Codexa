import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";

test("persists trusted project roots", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "codexa-trust-store-"));
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = tempHome;

  try {
    const module = await import(`./trustStore.js?trust=${Date.now()}`);
    const projectRoot = "C:/Workspace/Repo";

    assert.equal(module.isProjectTrusted(projectRoot), false);
    module.setProjectTrust(projectRoot, true);
    assert.equal(module.isProjectTrusted(projectRoot), true);
    module.setProjectTrust(projectRoot, false);
    assert.equal(module.isProjectTrusted(projectRoot), false);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
  }
});
