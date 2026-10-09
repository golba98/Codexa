import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Writes a throwaway Node script that stands in for a provider CLI. `scenario`
 * is embedded as JSON so the script needs no environment, and `logPath`
 * collects whatever the script chooses to record for assertions.
 */
export function createFakeExecutable(name: string, body: string, scenario: unknown = {}) {
  const dir = mkdtempSync(join(tmpdir(), `ubume-fake-${name}-`));
  const path = join(dir, name);
  const logPath = join(dir, "log.jsonl");
  writeFileSync(logPath, "");
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      `const scenario = ${JSON.stringify(scenario)};`,
      `const logPath = ${JSON.stringify(logPath)};`,
      'const log = (entry) => require("node:fs").appendFileSync(logPath, JSON.stringify(entry) + "\\n");',
      body,
    ].join("\n"),
    { mode: 0o700 },
  );
  return {
    path,
    dir,
    readLog(): unknown[] {
      return readFileSync(logPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Line-delimited JSON reader for fake CLIs that speak a stdio protocol. */
export const FAKE_STDIO_READER = `
let buffer = "";
const onLine = (handler) => {
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) handler(JSON.parse(line));
    }
  });
};
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
`;
