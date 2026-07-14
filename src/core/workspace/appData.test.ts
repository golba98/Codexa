import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import {
  resolveCodexaDataDir,
  resolveCodexaAttachmentDir,
  resolveCodexaWorkspaceDataDir,
  workspaceStorageKey,
} from "./appData.js";

test("resolves Codexa data directories for supported platforms", () => {
  assert.equal(resolveCodexaDataDir("linux", {}, "/home/test"), join("/home/test", ".local", "share", "codexa"));
  assert.equal(resolveCodexaDataDir("linux", { XDG_DATA_HOME: "/xdg/data" }, "/home/test"), join("/xdg/data", "codexa"));
  assert.equal(resolveCodexaDataDir("darwin", {}, "/Users/test"), join("/Users/test", "Library", "Application Support", "Codexa"));
  assert.equal(resolveCodexaDataDir("win32", { LOCALAPPDATA: "C:/Users/test/AppData/Local" }, "C:/Users/test"), join("C:/Users/test/AppData/Local", "Codexa"));
});

test("CODEXA_DATA_DIR overrides the platform default", () => {
  assert.equal(resolveCodexaDataDir("linux", { CODEXA_DATA_DIR: "/custom/codexa" }, "/home/test"), "/custom/codexa");
});

test("workspace data uses deterministic, isolated storage keys", () => {
  const first = workspaceStorageKey("/work/one");
  const second = workspaceStorageKey("/work/two");
  assert.equal(first, workspaceStorageKey("/work/one"));
  assert.notEqual(first, second);

  const previous = process.env.CODEXA_DATA_DIR;
  process.env.CODEXA_DATA_DIR = "/custom/codexa";
  try {
    assert.equal(resolveCodexaWorkspaceDataDir("/work/one"), join("/custom/codexa", "workspaces", first));
  } finally {
    if (previous === undefined) delete process.env.CODEXA_DATA_DIR;
    else process.env.CODEXA_DATA_DIR = previous;
  }
});

test("relative and legacy attachment directories resolve outside the workspace", () => {
  const previous = process.env.CODEXA_DATA_DIR;
  process.env.CODEXA_DATA_DIR = "/custom/codexa";
  try {
    assert.equal(resolveCodexaAttachmentDir("/work/one", "attachments"), join("/custom/codexa", "workspaces", workspaceStorageKey("/work/one"), "attachments"));
    assert.equal(resolveCodexaAttachmentDir("/work/one", ".codexa/attachments"), join("/custom/codexa", "workspaces", workspaceStorageKey("/work/one"), "attachments"));
    assert.equal(resolveCodexaAttachmentDir("/work/one", "/tmp/attachments"), "/tmp/attachments");
  } finally {
    if (previous === undefined) delete process.env.CODEXA_DATA_DIR;
    else process.env.CODEXA_DATA_DIR = previous;
  }
});
