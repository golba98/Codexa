import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editorCommand, editExternalPrompt } from "./externalEditor.js";

test("editor arguments preserve quotes without evaluating shell substitutions", () => {
  assert.deepEqual(editorCommand('"/path with spaces/editor" --wait "$(secret)"'), ["/path with spaces/editor", "--wait", "$(secret)"]);
  assert.throws(() => editorCommand('editor "unfinished'), /unclosed quote/);
  assert.throws(() => editorCommand(""), /Set VISUAL/);
});
test("external editing suspends terminal and reads saved multiline content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ubume-editor-test-"));
  try {
    const script = join(directory, "edit.mjs");
    await writeFile(script, 'import {writeFileSync} from "node:fs"; writeFileSync(process.argv[2], "edited\\nsecond line");');
    let suspended = false;
    const result = await editExternalPrompt("original", async (action) => { suspended = true; await action(); }, { VISUAL: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}` });
    assert.equal(suspended, true); assert.equal(result, "edited\nsecond line");
    await writeFile(script, "process.exit(1);");
    await assert.rejects(editExternalPrompt("original", (action) => action(), { EDITOR: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}` }), /draft retained/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
