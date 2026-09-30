import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function scenarios(steps: string[]) {
  const root = mkdtempSync(join(tmpdir(), "ubume-app-resume-"));
  const workspace = join(root, "project"); mkdirSync(workspace);
  const script = fileURLToPath(new URL("../test/fixtures/workbenchApp.tsx", import.meta.url));
  try {
    for (const scenario of steps) {
      if (scenario === "headless") {
        const key = createHash("sha256").update(workspace).digest("hex").slice(0, 16);
        const id = readdirSync(join(root, "data/workspaces", key, "conversations"))[0]!;
        const launcher = fileURLToPath(new URL("../../bin/ubume.js", import.meta.url));
        const provider = fileURLToPath(new URL("../test/fixtures/headlessProvider.mjs", import.meta.url));
        const result = spawnSync("node", [launcher, "exec", "--resume", id, "headless continuation", "--json"], { cwd: workspace, env: { ...process.env, UBUME_DATA_DIR: join(root, "data"), CODEXA_DATA_DIR: join(root, "data"), CODEX_EXECUTABLE: provider, UBUME_DEV_MODE: "0" }, encoding: "utf8", timeout: 15000 });
        assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).data.sessionId, id);
        continue;
      }
      const result = spawnSync(process.execPath, [script, scenario], { cwd: workspace, env: { ...process.env, UBUME_DATA_DIR: join(root, "data"), CODEXA_DATA_DIR: join(root, "data"), UBUME_DEV_MODE: "0" }, encoding: "utf8", timeout: 15000 });
      assert.equal(result.status, 0, `${scenario}: ${result.stderr}\n${result.stdout}\n${result.error ?? ""}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("actual App resumes after process restart with partial transcript, draft and paused queue", () => scenarios(["save", "resume"]));
test("actual App queues during runs and interrupts without overlapping cleanup or losing draft", () => scenarios(["flow"]));

test("saved conversation continues from TUI to terminal commands and back", () => scenarios(["save", "headless", "resume"]));

test("interrupt during checkpoint preparation does not start provider or leak execution lease", () => scenarios(["cancel-start"]));

test("actual App redraws plans immediately and implements directly in Auto", { timeout: 15000 }, () => scenarios(["plan-actions"]));
