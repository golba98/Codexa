# Codexa Exec Performance

## Baseline

Latest valid full benchmark from `C:\Development\1-JavaScript\15-Benchmarks`:

| Category | Raw Codex avg | Codexa avg | Delta |
| --- | ---: | ---: | ---: |
| Streaming | 8.290s | 9.036s | +0.746s / +9.0% |
| Repo | 28.509s | 29.603s | +1.094s / +3.8% |
| Diagnostics | 30.141s | 13.220s | -16.921s / -56.1% |
| Failure | 12.834s | 16.133s | +3.299s / +25.7% |

Benchmark settings: `gpt-5.4-mini`, medium reasoning, two runs, safe fixture repo.

## Investigation

- Headless `codexa exec` already bypassed the Ink/React TUI entrypoint, but the launcher still probed Bun before starting the exec process.
- Provider launch preparation probed the Codex executable and Codex CLI help before every fresh exec process, adding startup work before the real model turn.
- Exec mode wrapped the user prompt with Codexa-specific instructions and project instructions, while raw `codex exec` receives the prompt directly and lets Codex handle repo instructions.
- Structured tool events produced both tool activity logs and equivalent tool progress logs.
- Windows process termination success text could leak into diagnostics even though it is cleanup noise, not useful user output.
- Provider cleanup could call `kill()` even after the Codex child had already exited if cleanup was invoked later.

## Changes

- Added optional timing via `CODEXA_EXEC_TIMING=1`, `codexa exec --timing ...`, and legacy `--benchmark-diagnostics`.
- Changed headless exec prompt policy to raw passthrough by default. Use `--codexa-prompt-policy wrapped` for the previous Codexa prompt wrapper.
- Removed normal-path Bun probing from the launcher and normal-path Codex capability/help probing from provider launch preparation.
- Kept compatibility fallback: if direct structured launch is rejected before structured events, Codexa retries with capability probing and legacy output mode.
- Suppressed duplicate equivalent tool progress lines in headless stderr.
- Suppressed process termination success noise from headless diagnostics.
- Guarded provider cleanup so successful, already-exited child processes are not killed again.

## Timing Mode

Timing is disabled by default.

```powershell
$env:CODEXA_EXEC_TIMING = "1"
codexa exec --model gpt-5.4-mini --reasoning medium "Reply with exactly: CODEXA_READY"
```

```powershell
codexa exec --timing --model gpt-5.4-mini --reasoning medium "Reply with exactly: CODEXA_READY"
```

Timing lines are emitted to stderr as:

```text
[codexa exec timing] phase=<name> elapsed_ms=<n> delta_ms=<n>
```

## Rerun Benchmark

From `C:\Development\1-JavaScript\15-Benchmarks`:

```powershell
npm run bench:remaining -- -Runs 2 -TimeoutSeconds 120
```

The benchmark should keep both tools on `gpt-5.4-mini` with medium reasoning and should report no unsafe repo usage, dirty fixture state, failures, or timeouts.

## After Benchmark

Validation run:

- Date: 2026-05-07
- Artifact folder: `C:\Development\1-JavaScript\15-Benchmarks\results\live\2026-05-07-002344-codexa-vs-codex-remaining`
- Command: `npm run bench:remaining -- -Runs 2 -TimeoutSeconds 120`

| Category | Raw Codex avg | Codexa avg | Delta |
| --- | ---: | ---: | ---: |
| Streaming | 9.282s | 8.992s | -0.290s / -3.1% |
| Repo | 27.754s | 30.106s | +2.352s / +8.5% |
| Diagnostics | 12.057s | 12.061s | +0.004s / +0.0% |
| Failure | 16.723s | 10.142s | -6.581s / -39.4% |

Compared with the supplied baseline, Streaming moved from +0.746s overhead to -0.290s, and Failure moved from +3.299s overhead to -6.581s. Repo was worse in this two-run validation sample (+8.5% versus the target of ±5%); the individual runs show one close pair and one slower Codexa run, so this remains the main area to recheck with more samples.

Remaining suspected bottlenecks, if overhead persists:

- Fresh process startup cost from `node -> bun -> codex`.
- Codex CLI startup variance on Windows.
- Model-side latency variance from different hidden prompts or tool choices if raw prompt parity is changed.
