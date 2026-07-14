# Codexa

A terminal UI (TUI) wrapper for coding agents. Built with TypeScript, Bun, and Ink (React for terminal rendering). Codexa routes to OpenAI Codex, Anthropic Claude Code, Google Gemini, and local models — giving each a richer interactive shell with scrollable history, workspace locking, layered TOML config, themes, and in-app slash commands.

## Quick Start

Fastest path for normal users (OpenAI Codex route):

1. **Install Codex CLI** — see [Installing OpenAI Codex CLI](#installing-openai-codex-cli)
2. **Authenticate Codex** — run `codex` once and sign in with ChatGPT when prompted
3. **Install Codexa** — `npm install -g @golba98/codexa@latest`
4. **Run Codexa** — `cd <your-workspace> && codexa`

Verify both are ready:

```
codex --version
codexa --version
```

## Requirements

| For... | Requires |
|--------|----------|
| Global install (`codexa` command) | Node.js + npm |
| Local dev / running from source | [Bun](https://bun.sh) |
| Codex/OpenAI route | Codex CLI installed and authenticated |
| Claude/Anthropic route | Claude Code CLI installed and authenticated |
| Mistral Vibe route | Mistral Vibe CLI (`vibe`) installed and authenticated |
| Antigravity route | Antigravity CLI (`agy`) installed and authenticated |
| Local route | LM Studio (or any OpenAI-compatible server) |
| Gemini/Google route | *(Legacy)* Gemini CLI installed and authenticated (falls back to OpenAI route) |

## Installing Codexa

```
npm install -g @golba98/codexa@latest
```

Verify:

```
codexa --version
```

## Updating Codexa

```
npm install -g @golba98/codexa@latest
```

After updating, confirm the version:

```
codexa --version
```

If it still shows the old version, check which binary is active:

```bash
# Linux/macOS
which -a codexa

# Windows PowerShell
Get-Command codexa
```

If the wrong binary is active, see [Troubleshooting](#troubleshooting).

## Tool Overview

Codexa and provider CLIs are independent tools with separate version numbers. Updating one does not update the others.

| Tool | Purpose | Version check | Update |
|------|---------|---------------|--------|
| Codex CLI | OpenAI coding agent | `codex --version` | `codex update` or reinstall |
| Claude Code CLI | Anthropic coding agent | `claude --version` | `npm install -g @anthropic-ai/claude-code@latest` |
| Mistral Vibe CLI | Mistral coding agent | `vibe --version` | `vibe --setup` or reinstall |
| Antigravity CLI | Antigravity coding agent | `agy --version` | Reinstall via package manager |
| Codexa | TUI wrapper / workspace experience | `codexa --version` | `npm install -g @golba98/codexa@latest` |

## Provider CLI Setup

Codexa can route to multiple providers. Each provider CLI must be installed and authenticated separately — Codexa does not manage provider authentication.

### Installing OpenAI Codex CLI

**Standalone (macOS/Linux):**

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

**Standalone (Windows):**

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

**npm (all platforms):**

```
npm install -g @openai/codex
```

**Homebrew (macOS):**

```
brew install --cask codex
```

After installing, run `codex` once and sign in with ChatGPT when prompted, or configure an API key for API key auth.

> Codexa does not manage Codex authentication. The Codex route requires an already-authenticated Codex CLI.

**Updating Codex CLI:**

| Install method | Update command |
|----------------|----------------|
| Standalone macOS/Linux | Rerun the `curl` installer |
| Standalone Windows | Rerun the PowerShell installer |
| npm | `npm install -g @openai/codex@latest` |
| Homebrew | `brew upgrade --cask codex` |

Preferred self-update (when supported): `codex update`

### Installing Claude Code CLI

```
npm install -g @anthropic-ai/claude-code
```

Verify:

```
claude --version
```

Authenticate — run `claude` once and sign in when prompted:

```
claude
```

> Codexa does not manage Claude authentication. The Claude route requires an already-authenticated Claude Code CLI. Codexa routes to the `claude` executable — make sure it is on your PATH and working before switching to the Anthropic provider in Codexa.

**Updating Claude Code CLI:**

```
npm install -g @anthropic-ai/claude-code@latest
```

### Installing Gemini CLI (Legacy / Deprecated)

> [!NOTE]
> Google/Gemini is no longer supported as an active provider route inside Codexa and falls back automatically to the OpenAI/Codex route.

If you are using legacy features that route to the `gemini` executable, install the Gemini CLI separately and authenticate per Google's instructions.

If the Gemini executable is not on PATH or has a non-standard name, specify it explicitly:

```bash
# Environment variable
export GEMINI_EXECUTABLE="/path/to/gemini"

# or in .codex/config.toml
gemini_command_path = "/path/to/gemini"
```

### Installing Mistral Vibe CLI

Codexa supports routing through the Mistral Vibe CLI (`vibe`).

1. **Install Vibe CLI** — Install the Mistral Vibe CLI tool.
2. **Authenticate Vibe** — Run `vibe` or `vibe --setup` in a terminal and sign in when prompted.
3. **Environment & Config (Optional)**:
   - Codexa automatically detects the active model from your environment (`VIBE_ACTIVE_MODEL`) or configuration files (`.vibe/config.toml` in your project/workspace, or `~/.vibe/config.toml`).
   - You can customize the active session location using the `VIBE_HOME` environment variable.

### Installing Antigravity CLI

Codexa supports routing through the Antigravity CLI (`agy`).

1. **Install Antigravity CLI** — Install the Antigravity CLI tool (`agy`).
2. **Authenticate Antigravity** — Authenticate the CLI according to your provider setup.
3. **Environment & Config (Optional)**:
   - Specifying the `agy` command path:
     ```toml
     # in .codex/config.toml
     antigravity_command_path = "/path/to/agy"
     ```
   - Alternatively, set the `AGY_EXECUTABLE` environment variable.

### Using Local Models (LM Studio)

Codexa can route the Local provider through any OpenAI-compatible server.

1. Start LM Studio and load a model.
2. Enable the LM Studio local server.
3. Confirm the endpoint is `http://localhost:1234/v1`.
4. Open Codexa's provider picker with `/providers`.
5. Select `Local`, refresh models if needed, then choose `Use in Codexa`.

Environment variable configuration:

```bash
export CODEXA_LOCAL_BASE_URL="http://localhost:1234/v1"
export CODEXA_LOCAL_API_KEY="lm-studio"
export CODEXA_LOCAL_MODEL="google/gemma-4-26b-a4b"
```

Provider configuration is stored in Codexa user data and remains isolated per workspace:

- Windows: `%LOCALAPPDATA%\\Codexa\\workspaces\\<workspace-hash>\\providers.json`
- macOS: `~/Library/Application Support/Codexa/workspaces/<workspace-hash>/providers.json`
- Linux: `$XDG_DATA_HOME/codexa/workspaces/<workspace-hash>/providers.json` (or `~/.local/share/codexa/...`)

Existing `.codexa/providers.json` files are read as a legacy fallback and are never deleted. New saves go to user data, so opening or configuring Codexa no longer adds `.codexa` files to projects.

The provider config format is:

```json
{
  "providers": {
    "local": {
      "enabled": true,
      "type": "openai-compatible",
      "base_url": "http://localhost:1234/v1",
      "api_key": "lm-studio",
      "default_model": "google/gemma-4-26b-a4b",
      "models": {
        "google/gemma-4-26b-a4b": {
          "contextLength": 8192
        }
      }
    }
  }
}
```

`OPENAI_BASE_URL`, `OPENAI_API_BASE`, and `OPENAI_API_KEY` are also accepted for the Local provider only. They do not redirect other routes.

## Running Codexa

### Interactive mode

Launch from the directory you want as the workspace:

```bash
cd <your-workspace>
codexa
```

The session is locked to the directory Codexa was launched from.

### CLI flags

| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show help |
| `--version` | `-v` | Show version |
| `--profile <name>` | | Load a named config profile |
| `--config <key=value>` | `-c` | Runtime config override (repeatable) |
| `--model <name>` | `-m` | Override the active model |

Non-flag arguments are sent as an initial prompt on startup:

```bash
codexa "explain this codebase"
codexa --profile review --model gpt-5.4 "review src/app.tsx"
```

### Exec mode (headless)

Run a single prompt non-interactively and exit:

```bash
codexa exec "refactor src/utils.ts to use async/await"
codexa exec --model gpt-5.4-mini --reasoning low "summarize changes in HEAD"
codexa exec --timing "run the test suite and fix failures"
```

Exec-specific flags:

| Flag | Description |
|------|-------------|
| `--prompt <text>` | Prompt text (alternative to positional arg) |
| `--model <name>` | Override model |
| `--reasoning <level>` | Set reasoning level |
| `--profile <name>` | Load config profile |
| `-c <key=value>` | Runtime config override |
| `--timing` / `--benchmark-diagnostics` | Print performance timing to stderr |
| `--codexa-prompt-policy <raw\|wrapped>` | Prompt formatting (default: raw) |

## Execution Modes

Set via `/mode` or `[codexa].mode` in `config.toml`:

| Mode | Key | Behavior |
|------|-----|----------|
| Read-only | `suggest` | No file writes |
| Auto | `auto-edit` | Automatic file editing |
| Full Access | `full-auto` | Strongest autonomy (default) |

Mode aliases for `/mode`: `ask` → `suggest`, `add` / `auto` → `auto-edit`, `plan` / `default` → `full-auto`

## Reasoning

Set via `/reasoning` or `model_reasoning_effort` in `config.toml`:

`none` · `minimal` · `low` · `medium` · `high` (default) · `xhigh` · `max`

## Slash Commands

Type `/` in the composer to access in-app commands. Key commands:

| Command | Description |
|---------|-------------|
| `/help` | Show full command reference |
| `/clear` | Clear conversation and cancel active run |
| `/exit` · `/quit` | Exit the app |
| `/model [name]` · `/models` | Switch model or open picker |
| `/backend [name]` · `/backends` | Switch backend or list available |
| `/providers` | Open provider picker |
| `/mode [name]` | Switch execution mode |
| `/reasoning [level]` | Set reasoning level |
| `/plan [on\|off]` | Toggle plan-review workflow |
| `/theme [name]` · `/themes` | Switch theme or open picker |
| `/config` | Show layered config sources and active values |
| `/config trust [on\|off\|status]` | Manage project trust |
| `/permissions` | Open permissions panel |
| `/permissions approval-policy <policy>` | Set approval policy |
| `/permissions sandbox <mode>` | Set sandbox mode |
| `/permissions network [on\|off]` | Set network access |
| `/runtime service-tier [flex\|fast]` | Set service tier |
| `/runtime personality [none\|friendly\|pragmatic]` | Set personality |
| `/settings` | Open settings panel |
| `/status` | Show effective runtime config |
| `/workspace` | Show locked workspace path |
| `/workspace relaunch <path>` | Restart TUI in another directory |
| `/auth` · `/auth status` | Auth panel or status probe |
| `/update check` | Check npm registry for a newer Codexa version |
| `/mouse` | Toggle mouse mode (wheel scroll vs. native selection) |
| `/verbose` | Toggle verbose output |
| `/copy` | Copy last response to clipboard |
| `/diagnose github` | Run GitHub connectivity diagnostics |
| `/diagnose providers` | Collect diagnostics for all configured providers |
| `!<command>` | Run a shell command inline |

## Layered Config

Runtime settings are resolved from a layered `config.toml` surface. Priority order (highest wins):

1. CLI `--config` overrides
2. Active profile patch (`[profiles.<name>]` section)
3. Project config: `.codex/config.toml` (only when project is trusted)
4. User config: `~/.codex/config.toml`
5. Built-in defaults

**Supported TOML keys:**

```toml
# Model and reasoning
model = "gpt-5.4"
model_reasoning_effort = "high"    # none | minimal | low | medium | high | xhigh | max

# Permissions
approval_policy = "on-request"     # untrusted | on-request | never
sandbox_mode = "workspace-write"   # read-only | workspace-write | danger-full-access
service_tier = "flex"              # flex | fast
personality = "none"               # none | friendly | pragmatic

# Sandbox write permissions
[sandbox_workspace_write]
network_access = true
writable_roots = ["/path/to/dir"]

# Codexa-specific
[codexa]
backend = "codex-subprocess"       # codex-subprocess (default)
mode = "full-auto"                 # suggest | auto-edit | full-auto

# Gemini CLI path (if using Gemini)
gemini_command_path = "C:\\path\\to\\gemini.cmd"

# Default profile to load
profile = "dev"

# Named profiles
[profiles.dev]
model = "gpt-5.4"
model_reasoning_effort = "high"
sandbox_mode = "workspace-write"

[profiles.safe]
approval_policy = "on-request"
sandbox_mode = "read-only"
```

**Example with CLI overrides:**

```bash
codexa --profile review --config model="gpt-5.4" --config codexa.mode="suggest"
```

### Project Trust

Project config (`.codex/config.toml`) is only applied when the detected project root is explicitly trusted:

```
/config trust status
/config trust on
/config trust off
```

Untrusted project config is detected but blocked, and shown visibly in `/config`.

## Workspace Management

Codexa locks the session to the directory it was launched from:

```bash
cd <your-workspace>
codexa
```

To recover from the wrong workspace without restarting manually:

```
/workspace relaunch .
/workspace relaunch <workspace-path>
```

## Themes

16 built-in themes. Switch with `/theme <name>` or open the picker with `/themes`:

`purple` · `mono` · `dark` · `black` · `emerald` · `solar` · `cyber` · `ocean` · `nordic` · `green` · `amber` · `vaporwave` · `dracula` · `gruvbox` · `synthwave` · `custom`

Default: `mono` (Black & White).

## UI Preferences

UI-only preferences are stored in `~/.codexa-settings.json` (separate from runtime config):

| Setting | Command | Options |
|---------|---------|---------|
| Workspace display | `/setting workspace <mode>` | `dir` · `name` · `simple` |
| Terminal title | `/setting terminal-title <mode>` | `dir` · `name` · `simple` |
| Busy loader | `/setting busy-loader <bool>` | `true` · `false` |
| Mouse mode | `/mouse` | wheel scroll · native selection |

## Published vs Local Codexa

**Published Codexa** (`npm install -g @golba98/codexa@latest`):
- Installed globally; available as `codexa` anywhere
- Stable release; updates on demand via npm
- Use this for daily work

**Local Codexa** (`bun run dev` from the repo):
- Runs directly from the working tree
- Reflects uncommitted changes immediately (with `--watch`)
- Header shows `Codexa vX.Y.Z-dev local` so you can tell it apart from the published build
- Use this for testing new features or contributing

> **Gotcha:** When testing local changes, confirm you are running the local build and not the global one. Use `Get-Command codexa` (Windows) or `which -a codexa` (Linux/macOS) to check.

## Maintainer Documentation

- [Architecture](docs/ARCHITECTURE.md) explains Codexa's entry points, subsystem boundaries, prompt and rendering flows, provider layers, state model, persistence, and maintenance invariants with diagrams.
- [Source Guide](docs/SOURCE_GUIDE.md) catalogs the purpose of every file under `src/` and records the maintenance rules for each source area.
- [Release Guide](docs/RELEASING.md) documents the validation, version bump, and NPM publishing commands.
- [Developer Scripts](scripts/README.md) lists every package command and explains launcher, shim, audit, build-metadata, smoke, and test behavior.

## Local Development

**Requirement:** [Bun](https://bun.sh) installed.

```bash
# Linux/macOS
cd /path/to/13-Custom-CLI-Normal
bun install

bun run typecheck    # Type-check without emit
bun test             # Run all tests
bun run dev          # Start with file watching (development)
bun run start        # Single run without watching
bun run build        # Generate build info + typecheck
```

```powershell
# Windows PowerShell
cd C:\Development\1-JavaScript\13-Custom-CLI-Normal
bun install

bun run typecheck
bun test
bun run dev
bun run start
bun run build
```

Dev launches lock the workspace to the directory Bun was invoked from.

**Option A — Install a separate `codexa-dev` command (recommended for contributors):**

```
bun run install:dev-bin
```

This installs two shims into your npm global bin directory — `codexa-dev` and the short alias `cxd` — both pointing at the local repo. The published `codexa` command is not modified — they coexist.

```bash
cd <your-workspace>
codexa-dev    # or: cxd
```

To confirm exactly which file is executing: `CODEXA_DEBUG_LAUNCH=1 codexa-dev`

Uninstall by removing the `codexa-dev` and `cxd` shims from your npm global bin directory (`npm prefix -g`).

**Option B — Redirect the global `codexa` command to the repo:**

```
npm link
```

This replaces the global `codexa` with a symlink to the repo. Undo with `npm unlink -g @golba98/codexa`.

**Refresh the global `codexa` from this checkout** (without publishing to npm):

```
npm install -g .
```

## Testing

```bash
bun test                              # Run all tests
bun test src/ui/layout.test.ts        # Run a specific file or pattern
```

Tests are colocated with source files (`*.test.ts` / `*.test.tsx`).

## Troubleshooting

### `npm install -g @golba98/codexa@latest` installs an older version

Run these diagnostics to understand the npm registry state:

```bash
npm view @golba98/codexa version
npm view @golba98/codexa versions --json
npm view @golba98/codexa dist-tags --json
```

If `dist-tags.latest` points to an older version, the registry may be slow to propagate. Wait a few minutes and retry, or install a specific version explicitly:

```bash
npm install -g @golba98/codexa@1.0.3
```

### `codexa --version` still shows an old version after updating

Check which binary is active and what version is installed globally:

```bash
# Linux/macOS
which -a codexa

# Windows PowerShell
Get-Command codexa

# Check globally installed version
npm list -g --depth=0 @golba98/codexa
```

Multiple `codexa` entries from `which -a` means more than one binary exists on PATH. The first one wins. If a local dev build (`codexa-dev` or `npm link`) is ahead of the published binary on PATH, it will shadow the global install.

### Multiple `codexa` binaries on PATH

Run `which -a codexa` to see all of them. The first one in the list is what runs. Reorder PATH, or uninstall/unlink the unwanted binary:

```bash
npm unlink -g @golba98/codexa    # remove npm link
npm uninstall -g @golba98/codexa # remove global install
```

Then reinstall: `npm install -g @golba98/codexa@latest`

### Installed from a local tarball

If you installed from a `.tgz` file rather than from the npm registry, `npm list -g` shows the version from that tarball. To switch to the registry version:

```bash
npm uninstall -g @golba98/codexa
npm install -g @golba98/codexa@latest
```

### npm global prefix not on PATH

Find where npm installs global binaries:

```bash
npm prefix -g       # e.g. /home/you/.local/share/npm
```

The `bin/` subdirectory of that path must be on your PATH. Add it to `~/.bashrc` or `~/.zshrc`:

```bash
export PATH="$(npm prefix -g)/bin:$PATH"
```

Then restart your terminal.

### Local linked build running instead of published package

If you ran `npm link` from the repo, `codexa` points at the local source. The header shows `Codexa vX.Y.Z-dev local` in that case. To go back to the published version:

```bash
npm unlink -g @golba98/codexa
npm install -g @golba98/codexa@latest
```

### Update notice does not appear

Codexa checks npm for updates on every interactive startup. The local cache at `~/.codexa-update-check.json` is only used as a best-effort fallback if npm is temporarily unavailable. The update notice appears when the npm registry `latest` version is newer than the running version.

Published npm versions are immutable. Versions before the fixed update checker may not show update notices even when a newer package exists. If in doubt, update directly:

```bash
npm install -g @golba98/codexa@latest
```

If you expect a notice but don't see one:

1. Check the current registry state: `npm view @golba98/codexa dist-tags --json`
2. Force an explicit check in-app: `/update check`
3. Update checks are disabled for local dev builds (`codexa-dev` / `cxd`)

| Symptom | Fix |
|---------|-----|
| `codex: command not found` | Install Codex CLI and restart the terminal |
| `claude: command not found` | Install Claude Code CLI: `npm install -g @anthropic-ai/claude-code` |
| `codexa: command not found` | Run `npm install -g @golba98/codexa@latest`, or use `bun run dev` from the repo |
| Codexa still shows old version after update | Check `which -a codexa` — a different binary may be earlier on PATH |
| Codex updated but Codexa did not | Independent tools — update Codexa: `npm install -g @golba98/codexa@latest` |
| Codexa updated but Codex did not | Independent tools — update Codex: `codex update` |
| Local changes not reflected when running `codexa` | You may be running the global binary — use `bun run dev` or `codexa-dev` from the repo |

## Versions

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

**Current release: v1.0.8**

v1.0.8 is a packaging-maintenance release that normalizes the published executable path without changing runtime behavior.

Other recent releases introduce major additions, including:
- **Mistral Vibe CLI Routing**: Connect through the `vibe` CLI tool (`vibe --setup`).
- **Antigravity CLI Routing**: Connect through the `agy` CLI tool (`agy`).
- **Dynamic Model Discovery & Caching**: Models are discovered dynamically and cached locally at `~/.codexa-model-cache.json` for instant launch, with instant provider sync for the model picker.
- **Native Terminal Scrollback**: History follows native scrollback with composer anchored at the bottom.
- **Kitty Keyboard Protocol Fix**: Corrected probe output leak.
- **Google/Gemini Route Deprecation**: In-Codexa routing for Google/Gemini now falls back to OpenAI/Codex.
