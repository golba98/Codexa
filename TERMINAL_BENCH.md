# Terminal-Bench Headless Adapter

`codexa exec "<prompt>"` is a small headless execution path for benchmark harnesses. It runs from the current working directory, resolves the same layered Codex/Codexa runtime config as the interactive app, and submits a single prompt through the existing backend provider pipeline.

## How It Differs From Interactive Codexa

Interactive `codexa` launches the Ink TUI, keeps a transcript on screen, supports plan review flows, and expects a human to respond to prompts. `codexa exec` does not start Ink. It streams assistant text to stdout and sends startup, config, progress, tool, and error diagnostics to stderr.

Headless execution always forces `planMode: false` so Terminal-Bench runs do not block on plan approval. It still preserves the configured provider, model, reasoning level, mode, sandbox mode, approval policy, network access, writable roots, service tier, and personality settings.

## Prompt And Config Flags

Use either a positional prompt:

```sh
codexa exec "Print the current directory, list files, and stop."
```

or `--prompt`:

```sh
codexa exec --prompt "Print the current directory, list files, and stop."
```

Runtime config flags are supported after `exec`:

```sh
codexa exec --profile bench -c approval_policy=\"never\" --prompt "Run the task."
```

## Smoke Test

From this repository:

```sh
bun run smoke:terminal-bench
```

The script runs:

```sh
codexa exec "Print the current directory, list files, and stop."
```

## Terminal-Bench And Harbor Wrapping

Terminal-Bench or Harbor can wrap `codexa exec` as the command under test. Keep stdout reserved for the assistant answer when collecting benchmark output. Capture stderr separately if you want provider startup, progress, tool, and failure diagnostics.

Benchmark jobs should configure non-interactive policies ahead of time through profiles or `-c/--config` overrides. For example, use an approval policy and sandbox mode that can complete without interactive approval prompts.

## Limitations

Headless mode is intentionally single-shot. It does not support interactive approval prompts, plan approval flows, follow-up questions, slash commands, shell bang commands, theme settings, or TUI transcript controls.

Full Terminal-Bench submission may still need an external wrapper image or script for timeout handling, result collection, and benchmark-specific environment setup.

## UI Smoothness Still Needs Manual Benchmarking

This adapter bypasses Ink, so it is useful for agent correctness and command-line benchmark automation. It does not measure the interactive UI render path. Smoothness, resize behavior, keyboard handling, and transcript layout still need manual or browser/terminal-focused benchmarking against the normal `codexa` TUI.
