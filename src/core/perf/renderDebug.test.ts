import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  configureRenderDebug,
  getRenderDebugLogPath,
  traceEvent,
  traceRender,
} from "./renderDebug.js";

function clean(path: string): void {
  rmSync(path, { force: true });
}

test("render debug stays quiet by default", () => {
  const logPath = join(tmpdir(), `codexa-render-debug-quiet-${process.pid}.jsonl`);
  clean(logPath);

  configureRenderDebug({ CODEXA_RENDER_DEBUG_FILE: logPath });
  traceEvent("test", "quiet");
  traceRender("QuietComponent", "test");

  assert.equal(existsSync(logPath), false);
});

test("render debug writes JSONL only when explicitly enabled", () => {
  const logPath = join(tmpdir(), `codexa-render-debug-enabled-${process.pid}.jsonl`);
  clean(logPath);

  try {
    configureRenderDebug({
      CODEXA_RENDER_DEBUG: "1",
      CODEXA_RENDER_DEBUG_FILE: logPath,
    });
    traceRender("EnabledComponent", "unit");

    assert.equal(getRenderDebugLogPath(), logPath);
    const records = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records[0]?.kind, "session");
    assert.equal(records[1]?.kind, "render");
    assert.equal(records[1]?.component, "EnabledComponent");
    assert.equal(records[1]?.reason, "unit");
  } finally {
    configureRenderDebug({});
    clean(logPath);
  }
});
