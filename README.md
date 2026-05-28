# Codexa

A terminal UI (TUI) wrapper around the `codex` CLI. Built with TypeScript, Bun, and Ink (React for terminal rendering). Codexa gives `codex` a richer interactive shell with scrollable conversation history, workspace locking, layered TOML config, themes, and in-app slash commands.

## Quick Start

Fastest path for normal users:

1. **Install Codex CLI** — see [Installing OpenAI Codex CLI](#installing-openai-codex-cli)
2. **Authenticate** — run `codex` once and sign in with ChatGPT when prompted
3. **Install Codexa** — `npm install -g @golba98/codexa`
4. **Run Codexa** — `cd <your-workspace> && codexa`

Verify both tools are ready:

```
codex --version
codexa --version
```

## Installing OpenAI Codex CLI

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

After installing, run `codex` once and sign in with ChatGPT when prompted, or configure an API key if using API key auth.

> Codexa does not manage Codex authentication. The Codex provider route requires an already-authenticated Codex CLI.

## Updating OpenAI Codex CLI

**Preferred (self-update, when supported):**

```
codex update
```

**Fallbacks by install method:**

| Install method | Update command |
|----------------|----------------|
| Standalone macOS/Linux | Rerun the `curl` installer |
| Standalone Windows | Rerun the PowerShell installer |
| npm | `npm install -g @openai/codex@latest` |
| Homebrew | `brew upgrade --cask codex` |

If `codex --version` still shows the old version after updating, check which binary is active:

```powershell
# Windows
Get-Command codex

# Linux/macOS
which codex
```

## Installing Published Codexa

```
npm install -g @golba98/codexa
```

Verify:

```
codexa --version
```

Update:

```
npm install -g @golba98/codexa@latest
```

If `codexa --version` still shows the old version, check which binary is active:

```powershell
# Windows
Get-Command codexa

# Linux/macOS
which codexa
```

## Codex Provider Requirements

Codexa can route to multiple providers including Codex, Anthropic, Google Gemini, and Local (LM Studio). The **Codex route** requires the OpenAI Codex CLI to be installed and authenticated separately. See [Installing OpenAI Codex CLI](#installing-openai-codex-cli).

Codexa and Codex CLI are independent tools with separate version numbers. Updating one does not update the other.

| Tool | Purpose | Version check | Update |
|------|---------|---------------|--------|
| Codex CLI | OpenAI coding agent | `codex --version` | `codex update` or reinstall |
| Codexa | TUI wrapper / workspace experience | `codexa --version` | `npm install -g @golba98/codexa@latest` |

## Published vs Local Codexa

**Published Codexa** (`npm install -g @golba98/codexa`):
- Installed globally; available as `codexa` anywhere
- Stable release; updates on demand via npm
- Use this for daily work

**Local Codexa** (`bun run dev` from the repo):
- Runs directly from the working tree
- Reflects uncommitted changes immediately (with `--watch`)
- Use this for testing new features or contributing

> **Gotcha:** When testing local changes, confirm you are running the local build and not the global one. Use `Get-Command codexa` (Windows) or `which codexa` (Linux/macOS) to check. If it points to the global install, use `bun run dev` from the repo, or install `codexa-dev` as described in [Running Local Codexa](#running-local-codexa-development).

## Running Local Codexa (Development)

**Requirement:** [Bun](https://bun.sh) installed.

```powershell
# Windows PowerShell
cd C:\Development\1-JavaScript\13-Custom-CLI-Normal
bun install

bun run typecheck    # Type-check without emit
bun test             # Run all tests
bun run dev          # Start with file watching (development)
bun run start        # Single run without watching
bun run build        # Generate build info + typecheck
```

```bash
# Linux/macOS
cd /path/to/13-Custom-CLI-Normal
bun install

bun run typecheck
bun test
bun run dev
bun run start
bun run build
```

Dev launches lock the workspace to the directory Bun was invoked from. For the normal end-user flow, install `codexa-dev` globally or use `npm link`, then run from the intended workspace.

**Option A — Install a separate `codexa-dev` command (recommended for contributors):**

```
bun run install:dev-bin
```

This installs two shims into your npm global bin directory — `codexa-dev` and the
short alias `cxd` — both pointing at the local repo (`scripts/run-local-dev.mjs`,
channel `local-dev`). The published `codexa` command is not modified — they coexist.
Run from any workspace:

```
cd <your-workspace>
codexa-dev        # or: cxd
```

Both run the local TypeScript source directly via Bun (there is no compiled
`dist/`), so there is no stale build to worry about — the header/logo you see is
the one in the repo. The brand line shows `Codexa vX.Y.Z-dev local` so you can
tell the dev build apart from the published one. To confirm exactly which file is
executing, run `CODEXA_DEBUG_LAUNCH=1 codexa-dev` (or `cxd`).

Uninstall by removing the `codexa-dev` and `cxd` shims from your npm global bin
directory (`npm prefix -g`).

**Refresh the published global `codexa` from this checkout** (so the plain
`codexa` command also serves the current header without publishing to npm):

```
npm install -g .
```

**Option B — Redirect the global `codexa` command to the repo:**

```
npm link
```

This replaces the global `codexa` with a symlink to the repo. Undo with `npm unlink -g @golba98/codexa`.

## Usage

### Interactive mode

Launch from the directory you want to use as the workspace:

```powershell
cd "<path-to-your-workspace>"
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

```powershell
codexa "explain this codebase"
codexa --profile review --model gpt-5.4 "review src/app.tsx"
```

### Exec mode (headless)

Run a single prompt non-interactively and exit:

```powershell
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
| `/mouse` | Toggle mouse mode (wheel scroll vs. native selection) |
| `/verbose` | Toggle verbose output |
| `/copy` | Copy last response to clipboard |
| `/diagnose github` | Run GitHub connectivity diagnostics |
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
backend = "codex-subprocess"       # codex-subprocess (only active backend in v1)
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

```powershell
codexa --profile review --config model="gpt-5.4" --config codexa.mode="suggest"
```

### Gemini CLI Executable

Codexa resolves the Gemini executable directly by path rather than through shell aliases or wrappers. To specify the Gemini CLI location:

```powershell
$env:GEMINI_EXECUTABLE = "C:\Users\you\AppData\Roaming\npm\gemini.cmd"
```

or in `config.toml`:

```toml
gemini_command_path = "C:\\Users\\you\\AppData\\Roaming\\npm\\gemini.cmd"
```

### Using local models with LM Studio

Codexa can route the Local provider through OpenAI-compatible local servers such as LM Studio.

1. Start LM Studio.
2. Load a model.
3. Enable the LM Studio local server.
4. Confirm the endpoint is `http://localhost:1234/v1`.
5. Open Codexa's provider picker with `/providers`.
6. Select `Local`, refresh models if needed, then choose `Use in Codexa`.

Codexa checks `GET http://localhost:1234/v1/models` and uses the returned model IDs in the Local model picker. If LM Studio returns `google/gemma-4-26b-a4b`, that model appears as a selectable Local model.

Context length is detected separately from model discovery. Codexa first looks for context metadata returned by the provider, then CLI metadata, then an explicit workspace config override, then exact known registry entries. If no trusted source provides a limit, Codexa shows `Context: Unknown` and does not calculate a context percentage.

Environment variable configuration:

```powershell
$env:CODEXA_LOCAL_BASE_URL = "http://localhost:1234/v1"
$env:CODEXA_LOCAL_API_KEY = "lm-studio"
$env:CODEXA_LOCAL_MODEL = "google/gemma-4-26b-a4b"
```

Workspace provider configuration in `.codexa/providers.json`:

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

`OPENAI_BASE_URL`, `OPENAI_API_BASE`, and `OPENAI_API_KEY` are also accepted for the Local provider only. They do not redirect OpenAI/Codex, Gemini, or Claude routes.

Use the `models.<modelId>.contextLength` override only when you know the loaded model/server limit. Values must be positive integers; zero, negative, and non-numeric values are ignored.

### Project Trust

Project config (`.codex/config.toml`) is only applied when the detected project root is explicitly trusted. Manage trust with:

```text
/config trust status
/config trust on
/config trust off
```

Untrusted project config is detected but blocked, and shown visibly in `/config`.

## Workspace Management

Codexa locks the session to the directory it was launched from. To start in the correct workspace:

```powershell
cd "<path-to-your-workspace>"
codexa
```

To recover from the wrong workspace without restarting manually:

```text
/workspace relaunch .
/workspace relaunch <workspace-path>
```

`/workspace relaunch` restarts the TUI process in the target directory. It does not hot-swap the workspace in the running process.

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

## Testing

```powershell
bun test                              # Run all tests
bun test src/ui/layout.test.ts        # Run a specific file or pattern
```

Tests are colocated with source files (`*.test.ts` / `*.test.tsx`).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `codex: command not found` | Install Codex CLI (see [Installing OpenAI Codex CLI](#installing-openai-codex-cli)) and restart the terminal |
| `codexa: command not found` | Run `npm install -g @golba98/codexa`, or use `bun run dev` from the repo |
| Codexa still shows an old version after update | Run `Get-Command codexa` / `which codexa` to check which binary is active; the wrong binary may be earlier on PATH |
| Codex updated but Codexa did not | They are independent tools — update Codexa separately: `npm install -g @golba98/codexa@latest` |
| Codexa updated but Codex did not | They are independent tools — update Codex separately: `codex update` |
| Local changes are not reflected when running `codexa` | You may be running the global binary. Use `bun run dev` from the repo, or run `bun run install:dev-bin` to install `codexa-dev` that always points at the repo. |

## Repo Hygiene

Local-only files kept out of version control:

- `node_modules/`
- `.claude/`
- `.env` and other local secret files
- Editor, OS, and cache files
