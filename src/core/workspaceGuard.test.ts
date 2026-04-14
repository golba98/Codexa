import assert from "node:assert/strict";
import test from "node:test";
import {
  containsDirectoryNavigationCommand,
  findOutsideWorkspacePaths,
  getPromptWorkspaceGuardMessage,
  getShellWorkspaceGuardMessage,
  isPathInsideAllowedRoots,
  isPathInsideWorkspace,
  resolveWorkspacePath,
} from "./workspaceGuard.js";
import { normalizeWorkspaceRoot } from "./workspaceRoot.js";

const workspaceRoot = normalizeWorkspaceRoot("C:/Users/jorda/OneDrive/Desktop/3-Python/Programs/2-Personal/20-Tester");

test("allows absolute paths inside the locked workspace", () => {
  const violations = findOutsideWorkspacePaths(
    "Please update C:\\Users\\jorda\\OneDrive\\Desktop\\3-Python\\Programs\\2-Personal\\20-Tester\\src\\main.py",
    workspaceRoot,
  );

  assert.deepEqual(violations, []);
});

test("blocks absolute paths outside the locked workspace", () => {
  const violations = findOutsideWorkspacePaths(
    "Please edit C:\\Users\\jorda\\Desktop\\Other\\notes.txt",
    workspaceRoot,
  );

  assert.equal(violations.length, 1);
  assert.equal(
    violations[0]?.normalizedPath,
    "C:\\Users\\jorda\\Desktop\\Other\\notes.txt",
  );
});

test("parses quoted windows paths with spaces", () => {
  const violations = findOutsideWorkspacePaths(
    "Use \"C:\\Users\\jorda\\Desktop\\Other Folder\\notes file.txt\" instead",
    workspaceRoot,
  );

  assert.equal(violations.length, 1);
  assert.equal(
    violations[0]?.normalizedPath,
    "C:\\Users\\jorda\\Desktop\\Other Folder\\notes file.txt",
  );
});

test("resolves relative paths inside the workspace", () => {
  assert.equal(
    resolveWorkspacePath("src\\main.py", workspaceRoot),
    "C:\\Users\\jorda\\OneDrive\\Desktop\\3-Python\\Programs\\2-Personal\\20-Tester\\src\\main.py",
  );
  assert.equal(isPathInsideWorkspace("src\\main.py", workspaceRoot), true);
});

test("blocks explicit relative paths that escape the workspace", () => {
  const violations = findOutsideWorkspacePaths("Edit ..\\outside.txt", workspaceRoot);

  assert.equal(violations.length, 1);
  assert.equal(
    violations[0]?.normalizedPath,
    "C:\\Users\\jorda\\OneDrive\\Desktop\\3-Python\\Programs\\2-Personal\\outside.txt",
  );
});

test("treats same-path drive letter case differences as inside the workspace", () => {
  assert.equal(
    isPathInsideWorkspace(
      "c:\\users\\jorda\\onedrive\\desktop\\3-python\\programs\\2-personal\\20-tester\\src\\main.py",
      workspaceRoot,
    ),
    true,
  );
});

test("allows configured writable roots outside the locked workspace", () => {
  const extraRoot = "C:\\Users\\jorda\\Desktop\\Allowed Root";

  assert.equal(
    isPathInsideAllowedRoots("C:\\Users\\jorda\\Desktop\\Allowed Root\\notes.txt", workspaceRoot, [extraRoot]),
    true,
  );

  const promptMessage = getPromptWorkspaceGuardMessage(
    "Edit \"C:\\Users\\jorda\\Desktop\\Allowed Root\\notes.txt\"",
    workspaceRoot,
    [extraRoot],
  );
  assert.equal(promptMessage, null);

  const shellMessage = getShellWorkspaceGuardMessage(
    "type \"C:\\Users\\jorda\\Desktop\\Allowed Root\\notes.txt\"",
    workspaceRoot,
    [extraRoot],
  );
  assert.equal(shellMessage, null);
});

test("still blocks paths outside the workspace and configured writable roots", () => {
  const extraRoot = "C:\\Users\\jorda\\Desktop\\Allowed Root";
  const message = getPromptWorkspaceGuardMessage(
    "Edit C:\\Users\\jorda\\Desktop\\Other\\notes.txt",
    workspaceRoot,
    [extraRoot],
  );

  assert(message);
  assert.match(message, /Allowed writable roots:/i);
  assert.match(message, /Allowed Root/i);
});

test("returns a prompt guard message before a run starts", () => {
  const message = getPromptWorkspaceGuardMessage(
    "Edit C:\\Users\\jorda\\Desktop\\Other\\notes.txt",
    workspaceRoot,
  );

  assert(message);
  assert.match(message, /Run blocked/i);
  assert.match(message, /Locked workspace:/i);
});

test("blocks directory-changing shell commands", () => {
  assert.equal(containsDirectoryNavigationCommand("cd .."), true);
  assert.equal(containsDirectoryNavigationCommand("Set-Location .."), true);
  assert.equal(containsDirectoryNavigationCommand("pushd .."), true);

  const message = getShellWorkspaceGuardMessage("cd ..", workspaceRoot);
  assert(message);
  assert.match(message, /Directory-changing commands/i);
});

test("blocks shell commands that reference outside absolute paths", () => {
  const message = getShellWorkspaceGuardMessage(
    "type C:\\Users\\jorda\\Desktop\\Other\\notes.txt",
    workspaceRoot,
  );

  assert(message);
  assert.match(message, /Outside path references:/i);
});

test("blocks shell commands that reference escaping relative paths", () => {
  const message = getShellWorkspaceGuardMessage("type ..\\outside.txt", workspaceRoot);

  assert(message);
  assert.match(message, /Outside path references:/i);
});
