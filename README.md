# Ubume CLI

Ubume is a terminal coding workspace for provider CLIs and local
OpenAI-compatible models.

*Ubume* (IsiXhosa) conveys structure, form, embodiment, and configuration — reflecting how Ubume coordinates external provider engines and local models into a unified, stateful CLI environment.

## Install

```bash
npm install -g ubume
ubume
```

Requires Node.js and one supported provider CLI, unless you use a local model.

Update Ubume with:

```bash
npm install -g ubume@latest
ubume --version
```

## Providers

Ubume can use these routes:

| Provider | Setup |
| --- | --- |
| OpenAI / Codex | Install and authenticate the `codex` CLI. |
| Anthropic / Claude | Install and authenticate the `claude` CLI. |
| Mistral Vibe | Install and authenticate the `vibe` CLI. |
| Local model | Open Local, choose LM Studio or Unsloth, and use a model loaded in that server. |
| Codexa Native | Available only from the local `ubume-dev` channel. |

Credentials remain with the provider CLI or local server.

## Usage

```bash
ubume --version
ubume exec "summarize this project"
ubume --model gpt-5.4
```

Useful commands inside Ubume:

```text
/help       Show commands
/model       Choose a model
/providers   Choose a provider
/permissions Configure safety
/settings    Open settings
/update      Check for updates
/queue       Manage instructions queued during runs
/transcript  Inspect commands and tool output
/diff        Review file changes
/rewind      Preview recovery or branch a conversation
/resume      Browse all providers and restore a saved session
```

Press Shift+Tab to rotate Plan, Read-only, Auto, and Full Access without
opening a panel. Large pastes are displayed as `[Pasted Content … chars]`
while their complete content is sent to the model. You can keep typing during
runs; Enter queues the next instruction. Ctrl+C interrupts or clears the draft;
on an empty prompt, press it twice to exit. Ctrl+L redraws.
See the [terminal workbench guide](docs/TERMINAL_WORKBENCH.md) for editing keys,
file attachments, change review, recovery, and resume behavior.

## Development

```bash
bun install
bun run dev
bun test
bun run build
```

Install the separate local development launcher with:

```bash
bun run install:dev-bin
ubume-dev
```

Developer references:

- [Architecture](docs/ARCHITECTURE.md)
- [Source guide](docs/SOURCE_GUIDE.md)
- [Documentation guide](docs/DOCUMENTATION.md)
- [Release guide](docs/RELEASING.md)

## Versions

Read [VERSIONS.md](VERSIONS.md) for a plain-language explanation of each
release. [CHANGELOG.md](CHANGELOG.md) contains the detailed technical record.

### Terminal commands without the TUI

Use `ubume doctor`, `ubume status --json`, `ubume providers`, and `ubume sessions list` to diagnose and inspect Ubume from a shell. `ubume exec "prompt"` saves a session by default; continue it with `ubume exec --resume <id> "next instruction"`, or use `--no-save` for a transient run. Pipe prompts with `ubume exec --stdin`. See [terminal command usage](docs/TERMINAL_COMMANDS.md) for JSON output, file attachments, diagnostics, and session diffs.

Saved chats, including LM Studio and Unsloth conversations, live in Ubume's user data folder under `chats/`. `/resume` includes provider sections and Local backend/model filters. See [resume and storage details](docs/TERMINAL_WORKBENCH.md).

Local models can use integrated structured browser tools through the DeepSeek Harness. See [browser setup and usage](docs/LOCAL_BROWSER.md). Install Chromium with `ubume browser install`.
