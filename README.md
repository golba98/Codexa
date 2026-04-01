# Codexa

Terminal UI wrapper around the local Codex CLI, built with TypeScript, Bun, and Ink.

## Install on Windows

From the repo root:

```powershell
cd "C:\Development\1-JavaScript\13-Custom CLI"
npm link
where codexa
```

`where codexa` should resolve to your global npm bin directory before you rely on the command.

## Launch in a Target Workspace

Start `codexa` from the folder you want locked as the workspace:

```powershell
cd "C:\Users\jorda\OneDrive\Desktop\3-Python\Programs\2-Personal\20-Tester"
codexa
```

The app will lock that session to the folder you launched from.

## Recover From the Wrong Workspace

If the app starts in the wrong folder, use:

```text
/workspace
/workspace relaunch <path>
```

Examples:

```text
/workspace relaunch .
/workspace relaunch C:\Users\jorda\OneDrive\Desktop\3-Python\Programs\2-Personal\20-Tester
```

`/workspace relaunch` restarts the TUI in the target directory. It does not switch workspaces live in the current process.

## Development

```powershell
bun run dev
```

Repo/dev launches lock the session to the directory that launched Bun. For the normal user flow, prefer `npm link` and then run `codexa` from the intended workspace.
