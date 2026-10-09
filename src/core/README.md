# Core module map

Core code owns provider integration, processes, filesystem state, and terminal boundaries. It must not import UI components. The production file catalog is in [SOURCE_GUIDE](../../docs/SOURCE_GUIDE.md).

| Folder | Responsibility |
| --- | --- |
| `providers/` | Codex subprocess I/O, JSON stream/transcript parsing, backend registry, and shared run contracts. |
| `providerRuntime/` | Provider runtimes, routing/execution registry, discovery, models/reasoning, capability/context metadata, and local backend detection. |
| `providerRuntime/localHarness/` | Persistent local agent harness; config/environment/fingerprints, profiles, explicit notification handlers, pure tool policy, messages, and process lifecycle. Preserve child and active-run ownership checks. |
| `providerLauncher/` | Workspace provider config, provider UI state, and external CLI launch/resume boundaries. |
| `codex/` | Codex launch/prompt assembly, capability detection, and authentication probes. |
| `models/` | Codex model metadata discovery and shared model cache/seed persistence. |
| `executables/` | Shared cached executable resolvers and the distinct Codex resolver. |
| `process/` | `commandRunner.ts`, subprocess control, and executable path validation. |
| `terminal/` | Sanitization, raw input, title/control sequences, capability detection, and atomic clear/resize/overlay frame ownership. `clearFrameBoundary.ts` is intentionally protected from simplification. |
| `workspace/` | Roots/guards, project instructions, attachments, app-data paths, plan storage, conversations, ownership, checkpoints, and file recovery. |
| `externalSessions/` | Native session listing/readers, shared store I/O, transcript imports, and native resume launch plans. |
| `usage/` | Provider usage adapters for `/usage`: normalised snapshot contract, route-to-adapter registry, cooldown/in-flight/stale service, and passive Local/API observations. Adapters read usage only through each CLI's supported structured interface. |
| `version/` | Build channels, package version branding, and update checking/cache compatibility. |
| `shared/` | Values/record/error guards, text wrapping and width, line normalization, clipboard/image handling, and GitHub diagnostics. |
| `perf/` | Shared debug log factory, input/model/local stream tracing, render diagnostics, and profiling. |
| `computerUse/` | Browser capabilities, approval scope, worker transport, and browser session lifecycle. |

## Provider boundaries

`providerLauncher/` selects workspace routes and launches external CLIs. `providerRuntime/` discovers and executes a provider route. `providers/` owns the low-level Codex subprocess and stream parsing. These layers have different responsibilities.

Home and CODEX_HOME resolution come from `config/settings.ts`; platform app-data paths come from `workspace/appData.ts`. Preserve user-visible Codexa environment aliases and legacy data/config migrations.

## Debug instrumentation

- `perf/debugLog.ts` shares a writer while retaining each caller's flags, filenames, redaction, and failure handling. Input tracing uses `UBUME_DEBUG_INPUT=1`; local stream tracing uses `UBUME_DEBUG_LOCAL_STREAM=1` and the separate content opt-in.
- `perf/renderDebug.ts` owns render/flicker tracing (`UBUME_RENDER_DEBUG=1`).
- `perf/profiler.ts` records performance sessions.
- `scripts/claudeCodeDiscoveryDebug.ts` is the standalone `bun run debug:claude-models` entry point.
