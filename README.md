# Codexa

Terminal UI wrapper around the Codexa neural network, built with TypeScript, Bun, and Ink.


## Install on Windows

From the repo root:

```powershell
cd "<path-to-your-clone>"
npm link
where codexa
```

`where codexa` should resolve to your global npm bin directory before you rely on the command.

## Layered Config

CODEXA now resolves execution settings from a layered `config.toml` surface instead of persisting runtime state in `~/.codexa-settings.json`.

- User config: `~/.codex/config.toml`
- Project config: `.codex/config.toml` from the detected project root down to the locked workspace
- Profile selection: `--profile <name>` or top-level `profile = "name"` in loaded TOML layers
- CLI overrides: repeatable `--config key=<toml-value>` / `-c key=<toml-value>`

Example:

```powershell
codexa --profile review --config model="gpt-5.4" --config codexa.mode="suggest"
```

Supported runtime keys in this rank:

- Native-style keys: `model`, `model_reasoning_effort`, `approval_policy`, `sandbox_mode`, `sandbox_workspace_write.network_access`, `sandbox_workspace_write.writable_roots`, `service_tier`, `personality`
- CODEXA-specific keys: `[codexa].backend`, `[codexa].mode`

Pure UI/auth preferences still live in `~/.codexa-settings.json`.

### Project Trust

Project config is only applied when the detected project root is trusted.

```text
/config
/config trust status
/config trust on
/config trust off
```

Untrusted project config is detected but blocked visibly in `/config`.

## Launch in a Target Workspace

Start `codexa` from the folder you want locked as the workspace:

```powershell
cd "<path-to-your-workspace>"
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
/workspace relaunch <workspace-path>
```

`/workspace relaunch` restarts the TUI in the target directory. It does not switch workspaces live in the current process.

## Development

```powershell
bun run dev
```

Repo/dev launches lock the session to the directory that launched Bun. For the normal user flow, prefer `npm link` and then run `codexa` from the intended workspace.

## Repo Hygiene

This repository is set up to keep local-only files out of GitHub, including:

- `node_modules/`
- `.claude/`
- `.env` and other local secret files
- editor, OS, and cache files
