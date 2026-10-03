import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listVibeSessions, readVibeTranscript } from "./vibeSessions.js";

test("Vibe honors configured storage, lists workspace histories and extracts dialogue and tools without writing native files", async () => {
  const home = mkdtempSync(join(tmpdir(), "ubume-vibe-history-"));
  try {
    writeFileSync(join(home, "config.toml"), '[session_logging]\nsave_dir = "saved"\n');
    for (const [id, cwd] of [
      ["a", "/work"],
      ["b", "/other"],
    ]) {
      const dir = join(home, "saved", id!);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "meta.json"),
        JSON.stringify({
          session_id: id,
          environment: { working_directory: cwd },
          config: { active_model: "chosen" },
        }),
      );
      writeFileSync(
        join(dir, "messages.jsonl"),
        [
          { role: "system", content: "rules" },
          { role: "user", content: "fix it" },
          {
            role: "assistant",
            content: "checking",
            tool_calls: [{ function: { name: "read_file", arguments: '{"path":"a.ts"}' } }],
          },
          { role: "tool", name: "read_file", content: "source" },
          { role: "assistant", content: "done" },
        ]
          .map((entry) => JSON.stringify(entry))
          .join("\n"),
      );
    }
    const invalid = join(home, "saved", "corrupt");
    mkdirSync(invalid);
    writeFileSync(join(invalid, "meta.json"), "broken");
    const options = { env: { VIBE_HOME: home } };
    const all = await listVibeSessions({ kind: "all" }, options);
    assert.equal(all.length, 2);
    const here = await listVibeSessions({ kind: "workspace", root: "/work/" }, options);
    assert.equal(here.length, 1);
    assert.equal(here[0]?.model, "chosen");
    const original = readFileSync(here[0]!.filePath!);
    const transcript = await readVibeTranscript(here[0]!);
    assert.deepEqual(
      transcript.entries.map((entry) => entry.kind),
      ["note", "user", "assistant", "tool", "tool", "assistant"],
    );
    assert.deepEqual(readFileSync(here[0]!.filePath!), original);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
