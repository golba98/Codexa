# Codexa

Codexa is a terminal workspace for coding with provider CLIs and local
OpenAI-compatible models.

## Install

Requirements:

- Node.js and npm for the published install
- npm or Bun
- At least one supported provider CLI, unless using a local model

Install the published package:

```bash
npm install -g @golba98/codexa
codexa
```

Update it later:

```bash
npm install -g @golba98/codexa@latest
codexa --version
```

Run a local checkout without installing it:

```bash
bun install
bun run dev
```

## Providers

Codexa can use these routes:

| Provider | Setup |
| --- | --- |
| OpenAI / Codex | Install and authenticate the `codex` CLI. |
| Anthropic / Claude | Install and authenticate the `claude` CLI. |
| Mistral Vibe | Install and authenticate the `vibe` CLI. |
| Antigravity | Install and authenticate the `agy` CLI. |
| Local model | Start an OpenAI-compatible server, such as LM Studio. |
| Codexa Native | Available only from the local `codexa-dev` channel. |

Codexa keeps provider credentials in the provider's own CLI or local
configuration. It does not require credentials in this repository.

Google/Gemini routes are retained only for legacy configuration migration and
are not an active selectable route.

## Use Codexa

Start the interactive terminal UI:

```bash
codexa
```

Useful commands:

```bash
codexa --help
codexa --version
codexa exec "summarize this project"
codexa --model gpt-5.4
codexa --profile work
```

Inside Codexa, common slash commands include:

```text
/help       Show commands
/model      Choose a model
/providers  Choose a provider
/reasoning  Choose reasoning effort
/settings   Open settings
/theme      Choose a theme
/clear      Clear the transcript
/update     Check for updates
```

Use `Esc` to close a panel. Use `Ctrl+O` or `Ctrl+M` to open model selection,
and `Ctrl+T` to choose a theme.

## Configuration

Codexa stores user data outside the project workspace. Project-specific
configuration can be placed in `.codex/config.toml` after the project is
trusted.

Common configuration areas include:

- provider and model defaults
- reasoning level
- approval and sandbox mode
- writable roots
- workspace display and busy-loader preferences
- named profiles

Run `/settings` or `codexa --help` for the supported options. Existing legacy
`.codexa/providers.json` files are read as a migration fallback and are not
deleted automatically.

## Development

Commands used by this repository:

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

The local development launcher can be installed separately from the published
`codexa` command:

```bash
bun run install:dev-bin
codexa-dev
```

See the developer references for implementation details:

- [Architecture](docs/ARCHITECTURE.md)
- [Source guide](docs/SOURCE_GUIDE.md)
- [Documentation guide](docs/DOCUMENTATION.md)
- [Release guide](docs/RELEASING.md)

## Troubleshooting

Check which binary is running:

```bash
which -a codexa
codexa --version
npm list -g @golba98/codexa --depth=0
```

If the command is missing, reinstall it or use the local launcher:

```bash
npm install -g @golba98/codexa@latest
bun run dev
```

If an update notice does not appear, run `/update check` or update directly
with npm. Local development launches do not show startup update notices.

## Versions

Read [VERSIONS.md](VERSIONS.md) for a plain-language explanation of each
release. [CHANGELOG.md](CHANGELOG.md) contains the detailed technical record.
