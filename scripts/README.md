# Scripts

Standalone development and audit utilities. All run with Node unless noted; tests are co-located (`*.test.ts`, run by `bun test`).

| Script | npm alias | Purpose |
|---|---|---|
| `run-local-dev.mjs` | `bun run dev:run` | Launch the local checkout as if installed: interactive runs go to `src/index.tsx`, `exec` / `--headless-benchmark` go to `src/exec.ts` |
| `install-local-dev-bin.mjs` | `bun run install:dev-bin` | Install a `codexa` shim on PATH pointing at this checkout |
| `gen-build-info.mjs` | `bun run gen-build-info` | Write `src/config/buildInfo.ts` with the current git commit hash and app version (also part of `bun run build`) |
| `audit-codexa-capabilities.mjs` | `bun run audit:codexa-gap` | Audit Codexa's feature coverage against the upstream `codex` CLI |
| `smoke-terminal-bench.mjs` | `bun run smoke:terminal-bench` | Smoke-run the terminal benchmark harness (see `docs/TERMINAL_BENCH.md`) |
