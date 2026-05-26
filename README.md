# Codexa

A terminal UI (TUI) wrapper around the `codex` CLI. Built with TypeScript, Bun, and Ink (React for terminal rendering). Codexa gives `codex` a richer interactive shell with scrollable conversation history, workspace locking, layered TOML config, themes, and in-app slash commands.

## Prerequisites

- **Bun** — required to run locally from source
- **codex CLI** — the underlying agent that Codexa wraps. Must be available on `PATH` or pointed to via `CODEX_EXECUTABLE`

## Installation

**Local source install:**

```powershell
bun install
npm link
```

Then run `codexa` from the workspace directory you want to use.

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

## Development

```powershell
bun install          # Install dependencies
bun run dev          # Start with file watching
bun run start        # Single run without watching
bun run typecheck    # TypeScript type-check (no emit)
```

Dev launches lock the workspace to the directory Bun was invoked from. For the normal end-user flow, use `npm link` and run `codexa` from the intended workspace instead.

## Testing

```powershell
bun test                              # Run all tests
bun test src/ui/layout.test.ts        # Run a specific file or pattern
```

Tests are colocated with source files (`*.test.ts` / `*.test.tsx`).

## Repo Hygiene

Local-only files kept out of version control:

- `node_modules/`
- `.claude/`
- `.env` and other local secret files
- Editor, OS, and cache files
