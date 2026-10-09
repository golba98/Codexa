# Ubume Source Guide

This is the maintenance catalog for production TypeScript files under `src/`. It describes ownership and purpose; [Ubume Architecture](ARCHITECTURE.md) explains how the subsystems work together, and [Developer Scripts](../scripts/README.md) documents repository automation outside `src/`, and [`src/core/README.md`](../src/core/README.md) maps the core folders.

## How to use this guide

- Find the owning directory before adding or moving code.
- Change the source file and its focused tests together.
- Update this catalog whenever a file is added, removed, renamed, or changes responsibility.
- Update the architecture document when a dependency boundary, entry point, data flow, persistence rule, provider layer, or terminal invariant changes.
- Treat names as navigation aids, not proof: verify behavior in the current implementation before editing it.

## Cross-cutting maintenance rules

1. **Keep dependencies directional.** Entrypoints and `app/App.tsx` may compose lower layers; core and session modules must not import UI components.
2. **Keep side effects at boundaries.** Parsers, reducers, measurement, and formatting helpers should remain deterministic. Process, filesystem, terminal, and persistence effects belong in their named boundary modules.
3. **Preserve runtime truth.** Provider availability, discovered models, reasoning choices, context metadata, and launch support must reflect what the runtime can actually do.
4. **Protect terminal ownership.** A terminal row, mode, resize path, or clear boundary should have one owner with paired cleanup.
5. **Keep app state out of projects.** Mutable caches, plans, attachments, provider state, and debug output belong in platform app data unless a file is intentional project configuration.
6. **Test contracts, not filenames.** Colocated tests should cover public behavior, edge cases, migrations, cleanup, and regression-prone terminal dimensions.
7. **Do not hand-edit generated metadata.** `src/config/buildInfo.ts` is written by `scripts/gen-build-info.mjs` and may change during `bun run build`.

## Production file catalog

Tests and shared test fixtures are colocated or under `src/test/` and are intentionally omitted. Generated build metadata is marked in its existing entry.

### `src/`

| File | Purpose |
| --- | --- |
| `src/cli.ts` | Headless entry point for `ubume exec`, `--headless-benchmark` and the other terminal commands; dispatches to `headless/commands.ts` with interrupt handling. |
| `src/index.tsx` | Bootstraps the Ink application, validates the terminal, owns terminal-mode setup/cleanup, frame locking, resize handling, and the single App render root. |

### `src/app/`

| File | Purpose |
| --- | --- |
| `src/app/App.tsx` | Composes app hooks, clear-frame wiring, runtime presentation, and the interactive roots. |
| `src/app/OverlayPanels.tsx` | Renders un-memoized overlays, shared policy selection, and tool approval resolution. |
| `src/app/commandDispatch.ts` | Dispatches parsed command actions through a typed handler table. |
| `src/app/conversationPersistence.ts` | Shares conversation saves, recovery cleanup, and scratch-state transitions. |
| `src/app/promptRunPrep.ts` | Prepares per-turn runtime and history, final responses, authentication text, and shell batching. |
| `src/app/routeStatus.ts` | Derives the current route status with provider diagnostics. |
| `src/app/useAppComposer.tsx` | Memoizes the composer element and plan entry panels while preserving callback identities. |
| `src/app/useAppDebugTracing.ts` | Tracks startup, UI transitions, blank frames, and root measurements. |
| `src/app/useAppInput.ts` | Validates submissions, interprets commands, imports attachments, and starts runs. |
| `src/app/useAppState.ts` | Initializes settings, session state, registries, route state, and app refs during render. |
| `src/app/useComposerEditing.ts` | Handles drafts, paste/image registration, and clearing the conversation. |
| `src/app/useConversation.ts` | Owns conversation persistence, resume/import flows, autosave, and transcript replacement. |
| `src/app/useFocusRouting.ts` | Owns focus restoration, input debug snapshots, settings persistence, and cleanup effects. |
| `src/app/useModelCatalog.ts` | Discovers models, probes authentication, and refreshes provider availability. |
| `src/app/useModelSelection.ts` | Validates model/reasoning selection and persists route choices. |
| `src/app/useOverlayRouting.ts` | Opens model/settings/permission panels and routes panel actions. |
| `src/app/usePlanFlow.ts` | Coordinates plan generation, review, approved execution, startup prompts, and queue draining. |
| `src/app/usePromptExecution.ts` | Executes shell commands and relaunches workspaces with paired cleanup. |
| `src/app/usePromptRun.ts` | Owns provider startup, streamed updates, checkpoints, and completion callbacks. |
| `src/app/useProviderRoute.ts` | Checks local backends, routes provider actions, and launches setup commands. |
| `src/app/useProviderUsage.ts` | Owns `/usage` panel state for the active route: resolves the usage adapter and scope, opens the panel, requests through the shared usage service, and drops results for a scope the user has left. |
| `src/app/useRunLifecycle.ts` | Finalizes and cancels runs, resets the home screen, quits, and saves plans. |
| `src/app/useRunRefs.ts` | Owns the stable shared run refs without moving render-time assignments into effects. |
| `src/app/useRuntimeSettings.ts` | Applies layered runtime overrides and persists provider routes/defaults. |
| `src/app/useSettings.ts` | Handles preferences and policy setters, and builds one settings save payload. |
| `src/app/useUpdateCheck.ts` | Owns the update-check scheduler for the interactive session: runs the startup check behind the initial overlay gate, keeps checking in the background, and applies results to the existing update state without opening overlays or moving focus. Exposes the shared check used by `/update`. |
| `src/app/useWorkbenchActions.ts` | Coordinates queue edits, interrupts, external editing, rewind, and confirmed imports. |

### `src/commands/`

| File | Purpose |
| --- | --- |
| `src/commands/diagnosticsFormat.ts` | Formats GitHub, provider CLI, and provider route diagnostics consistently. |
| `src/commands/handler.ts` | Parses slash commands into typed actions and formats deterministic help, status, configuration, and validation messages. |

### `src/config/`

| File | Purpose |
| --- | --- |
| `src/config/buildInfo.ts` | Generated build metadata containing the packaged version and Git revision; regenerated by scripts/gen-build-info.mjs. |
| `src/config/launchArgs.ts` | Parses interactive launch flags, profiles, models, prompts, and runtime overrides into the shared LaunchArgs shape. |
| `src/config/layeredConfig.ts` | Loads, validates, merges, and diagnoses built-in, user, trusted-project, profile, and CLI configuration layers. |
| `src/config/legacyEnv.ts` | Copies pre-rename `CODEXA_*` environment variables into unset `UBUME_*` names, leaving the Codexa model-family variables alone. |
| `src/config/persistence.ts` | Loads and saves user-facing Ubume settings with normalization and safe fallback behavior. |
| `src/config/runtimeConfig.ts` | Defines runtime policy types, defaults, resolution, labels, writable-root operations, and effective configuration summaries. |
| `src/config/settings.ts` | Defines application constants, selectable models/modes/backends/themes, user-setting schemas, labels, and display helpers. |
| `src/config/tomlSerialize.ts` | Serializes supported configuration objects to stable TOML while preserving valid scalar and nested structures. |
| `src/config/trustStore.ts` | Persists and queries whether project roots are trusted before project configuration is applied. |

### `src/core/codex/`

| File | Purpose |
| --- | --- |
| `src/core/codex/codexAppServerClient.ts` | Minimal JSON-RPC client for one short-lived `codex app-server --listen stdio://` process: `initialize` handshake, id-correlated requests, ignored notifications, timeout/abort, and guaranteed child shutdown. Used by model discovery and `/usage`. |
| `src/core/codex/codexAuth.ts` | Probes Codex authentication and converts results into run gating, labels, guidance, and likely-auth-failure classification. |
| `src/core/codex/codexCapabilities.ts` | Discovers and parses Codex CLI model capabilities from provider output. |
| `src/core/codex/codexExecArgs.ts` | Builds the exact Codex CLI exec argument vector from effective runtime configuration and launch context. |
| `src/core/codex/codexLaunch.ts` | Resolves and starts Codex CLI processes with platform-aware executable and environment handling. |
| `src/core/codex/codexPrompt.ts` | Builds planning/execution prompts and detects execution intent, safe cleanup requests, and hollow responses. Recognizes blocked fast-cleanup tool failures so runs can stop with an actionable message. Formats warnings and recovery guidance when a write-intent run returns a hollow response. |

### `src/core/computerUse/`

| File | Purpose |
| --- | --- |
| `src/core/computerUse/browser.ts` | Owns browser workers, sessions, tool transport, cancellation, and cleanup. |
| `src/core/computerUse/capability.ts` | Resolves browser enablement and capability policy from runtime configuration. |
| `src/core/computerUse/types.ts` | Defines browser requests, results, session state, and tool contracts. |

### `src/core/executables/`

| File | Purpose |
| --- | --- |
| `src/core/executables/codexExecutable.ts` | Resolves the Codex executable and verifies usable command candidates. |
| `src/core/executables/executableResolver.ts` | Resolves Claude Code and Antigravity (`agy`) executables with platform and override handling. Provides shared cross-platform executable-name, PATH, override, and resolution utilities. |

### `src/core/externalSessions/`

| File | Purpose |
| --- | --- |
| `src/core/externalSessions/antigravitySessions.ts` | Lists Antigravity sessions from SQLite and reads session protobuf state. |
| `src/core/externalSessions/claudeSessions.ts` | Lists Claude Code sessions from `~/.claude/projects` (head/tail reads) and streams a session JSONL into transcript entries. |
| `src/core/externalSessions/codexSessions.ts` | Lists Codex threads from `state_*.sqlite` (rollout scan fallback) and parses rollout JSONL into transcript entries. |
| `src/core/externalSessions/index.ts` | Converts a native transcript into Ubume conversation messages for "continue in Ubume". Routes listing and transcript reads to the store for each source. Builds the `claude --resume` / `codex resume` / `agy --conversation` / `vibe --resume` launch in the session's folder. |
| `src/core/externalSessions/storeIo.ts` | Walks protobuf wire format without a schema and returns its text fields. Shared JSONL head/tail/stream readers, bounded-concurrency mapping, and title helpers. Opens another tool's SQLite store read-only (with an immutable fallback for WAL databases). |
| `src/core/externalSessions/types.ts` | Session source, scope, summary, and transcript types plus display labels. |
| `src/core/externalSessions/vibeSessions.ts` | Lists and reads native Mistral Vibe session transcripts. |

### `src/core/models/`

| File | Purpose |
| --- | --- |
| `src/core/models/codexModelCapabilities.ts` | Normalizes selectable Codex models, reasoning levels, defaults, lookup, and display formatting. |
| `src/core/models/modelCache.ts` | Seeds startup model capabilities from Codex and Ubume last-good cache files without blocking live discovery. Persists and loads last-good model discovery results per provider. |

### `src/core/perf/`

| File | Purpose |
| --- | --- |
| `src/core/perf/debugLog.ts` | Emits environment-gated stdin, focus, paste, and terminal-input diagnostics. Emits privacy-aware Local streaming diagnostics when explicitly enabled. Emits environment-gated model/provider state snapshots for picker and routing diagnosis. Emits environment-gated update-check scheduling and result diagnostics. |
| `src/core/perf/profiler.ts` | Collects opt-in prompt/run phase timings, counters, and session performance summaries. |
| `src/core/perf/renderDebug.ts` | Provides opt-in render counts, lifecycle traces, frame diagnostics, and React render instrumentation. |

### `src/core/process/`

| File | Purpose |
| --- | --- |
| `src/core/process/commandRunner.ts` | Runs shell commands with streamed output, cancellation, summaries, and platform-aware process cleanup. |
| `src/core/process/processValidation.ts` | Validates executable paths and process-launch inputs before spawning commands. |

### `src/core/providerLauncher/`

| File | Purpose |
| --- | --- |
| `src/core/providerLauncher/launcher.ts` | Builds and launches external provider CLI commands (and arbitrary resume commands via `launchCliCommand`) in the inherited terminal with safe hand-off and restoration. |
| `src/core/providerLauncher/registry.ts` | Builds provider-picker records from runtime truth, workspace overrides, discovery, and active/default route state. |
| `src/core/providerLauncher/types.ts` | Defines provider IDs, workspace configuration, launch commands, picker actions, and persisted route types. |
| `src/core/providerLauncher/workspaceConfig.ts` | Loads, migrates, normalizes, and saves per-workspace provider configuration in Ubume app data. |

| `src/core/providerRuntime/registry.ts` | Registers provider runtimes and resolves discovery, activation validation, migrations, defaults, and active routes. Formats provider labels and chooses provider setup commands. |
### `src/core/providerRuntime/`

| File | Purpose |
| --- | --- |
| `src/core/providerRuntime/anthropic.ts` | Implements Claude Code route validation, model discovery, process execution, and streamed event adaptation. |
| `src/core/providerRuntime/capabilityProfile.ts` | Resolves cached provider model feature profiles such as tools, vision, and reasoning support. |
| `src/core/providerRuntime/claudeCodeDiscovery.ts` | Discovers Claude Code models and reasoning metadata from commands, packages, caches, settings, and fallbacks. |
| `src/core/providerRuntime/codexaNative.ts` | Implements the Codexa Native route and its CuPy accelerated execution support. |
| `src/core/providerRuntime/contextMetadata.ts` | Resolves, caches, and formats model context-window metadata from provider config, discovery, and known registries. |
| `src/core/providerRuntime/antigravity.ts` | Implements Google provider runtime backed by Antigravity CLI (`agy`), route validation, model discovery, process execution, buffered response adaptation, and cancellation. |
| `src/core/providerRuntime/local.ts` | Checks local-server readiness, discovers models, resolves configuration, delegates active Local requests to the Harness adapter, and reports diagnostics. |
| `src/core/providerRuntime/localBackends.ts` | Defines LM Studio/OpenAI-compatible request and response helpers used by the local runtime. Verifies a local Unsloth Studio instance, resolves secure API authentication, and parses loaded models. |
| `src/core/providerRuntime/mistralVibe.ts` | Discovers Vibe configuration/models, resolves and launches the CLI, manages sessions, and adapts routed output. |
| `src/core/providerRuntime/models.ts` | Defines shared provider model fallbacks, aliases, normalization, and conversion to Codex-style capabilities. Normalizes provider reasoning levels and selects valid defaults for discovered models. |
| `src/core/providerRuntime/types.ts` | Defines the multi-provider runtime, route, discovery, model, validation, and chat request contracts, including restored conversation history. |

### `src/core/providerRuntime/localHarness/`

| File | Purpose |
| --- | --- |
| `src/core/providerRuntime/localHarness/bridgePolicy.ts` | Pure workspace and approval decisions for harness tool requests. |
| `src/core/providerRuntime/localHarness/config.ts` | Harness configuration, fingerprints, reasoning, output budgets, and subprocess environment. |
| `src/core/providerRuntime/localHarness/messages.ts` | Harness route descriptions, redaction, cancellation, hashing, and failure messages. |
| `src/core/providerRuntime/localHarness/notifications.ts` | Harness event handlers with explicit process and active-run ownership context. |
| `src/core/providerRuntime/localHarness/profile.ts` | Harness profile YAML and session scratch directory preparation. |
| `src/core/providerRuntime/localHarness/runtime.ts` | Resolves the default max output tokens for Local models that advertise no cap, so reasoning models are not cut off mid-thought. |

### `src/core/providers/`

| File | Purpose |
| --- | --- |
| `src/core/providers/codexJsonStream.ts` | Incrementally parses Codex JSONL events into assistant, reasoning, tool, and lifecycle callbacks. |
| `src/core/providers/codexSubprocess.ts` | Implements the runnable Codex backend, spawning the CLI and adapting its streams to BackendRunHandlers. |
| `src/core/providers/codexTranscript.ts` | Parses human/legacy Codex transcript output and filters noise while preserving response and activity ordering. |
| `src/core/providers/registry.ts` | Registers low-level backends, resolves the configured/default backend, and formats backend summaries. |
| `src/core/providers/runControl.ts` | Tracks stopped process promises and cancellation ownership for active runs. |
| `src/core/providers/types.ts` | Defines BackendProvider, run options, conversation history, progress updates, callbacks, and benchmark lifecycle hooks. |

### `src/core/shared/`

| File | Purpose |
| --- | --- |
| `src/core/shared/clipboard.ts` | Copies text through platform-specific clipboard commands with explicit success/failure reporting. |
| `src/core/shared/githubDiagnostics.ts` | Checks Git/GitHub CLI, remote identity, and local write readiness and classifies diagnostic results. |
| `src/core/shared/text.ts` | Measures ANSI/Unicode text, wraps content, truncates safely, and pads terminal rows. |
| `src/core/shared/values.ts` | Dependency-free value helpers shared by every layer: `isRecord`, `errorMessage`, `normalizeLineBreaks` and `formatDuration`. |

### `src/core/terminal/`

| File | Purpose |
| --- | --- |
| `src/core/terminal/clearFrameBoundary.ts` | Coordinates atomic transcript clearing across session state, Ink caches, terminal output, and repaint boundaries. |
| `src/core/terminal/externalEditor.ts` | Suspends terminal ownership for an external editor and restores the draft. |
| `src/core/terminal/frameLock.ts` | Serializes and normalizes Ink stdout frames to prevent interleaving, duplicates, width residue, and resize corruption. |
| `src/core/terminal/inkRenderReset.ts` | Locates Ink internals and resets render caches when a deliberately fresh frame is required. |
| `src/core/terminal/terminalCapabilities.ts` | Detects supported TTY environments and reports blocking errors or compatibility warnings. |
| `src/core/terminal/terminalControl.ts` | Provides the single controller for terminal writes, mouse, paste, cursor, alternate-screen, and reset sequences. |
| `src/core/terminal/terminalSanitize.ts` | Removes unsafe terminal control characters while preserving explicitly allowed text layout. |
| `src/core/terminal/terminalTitle.ts` | Tracks intended terminal titles and applies/restores title sequences across lifecycle changes. |

### `src/core/usage/`

| File | Purpose |
| --- | --- |
| `src/core/usage/types.ts` | Normalised usage contract: snapshot status, billing mode, limits (unknown ≠ zero), facts, links, adapter and request context. |
| `src/core/usage/normalize.ts` | Pure helpers: percentage/fraction validation, reset-time parsing (epoch s/ms, ISO), window labels, provider-text sanitising, and credential-free usage scope keys. |
| `src/core/usage/registry.ts` | Maps the active route to the adapter for the account it actually executes with (Claude Code vs direct API) and its scope key; unsupported fallback. |
| `src/core/usage/usageService.ts` | Per-scope cache, refresh cooldown (`UBUME_USAGE_COOLDOWN_SECONDS`), single in-flight request, and stale fallback that keeps the last good snapshot. |
| `src/core/usage/codexUsage.ts` | Codex adapter: `account/read` and `account/rateLimits/read` over the app-server; maps windows, buckets, credits and API-key/signed-out states. |
| `src/core/usage/claudeCodeUsage.ts` | Claude Code adapter: `claude auth status` plus the experimental `get_usage` SDK control request on a hook-free, tool-free, non-persisted stream-json host. |
| `src/core/usage/antigravityUsage.ts` | Google (Antigravity) adapter: print-mode `agy -p /usage` and `/credits` JSON with per-model-group quota buckets; rejects replies that ran a turn. |
| `src/core/usage/anthropicApiUsage.ts` | Direct Anthropic API adapter built only from observed `anthropic-ratelimit-*` headers. |
| `src/core/usage/observedRateLimits.ts` | Parses and stores rate-limit response headers that runtimes already receive; makes no requests. |
| `src/core/usage/mistralVibeUsage.ts` | Reports that Mistral Vibe exposes no programmatic usage, budget or rate-limit interface. |
| `src/core/usage/localUsage.ts` | Local adapter: model, context window (percentage only when verified/configured), harness token counts, and N/A vs remote-endpoint quota. |
| `src/core/usage/localUsageTracker.ts` | Records exact Local harness token usage per scope for the current conversation; ignores compaction re-emits. |

### `src/core/version/`

| File | Purpose |
| --- | --- |
| `src/core/version/channel.ts` | Reads and normalizes the package version through a leaf module that avoids configuration/version import cycles. Formats version and build-channel labels from package and generated build metadata. |
| `src/core/version/packageManager.ts` | Detects how Ubume was installed and derives the appropriate update command. |
| `src/core/version/updateCheck.ts` | Caches update-check results in app data with expiry and corruption-tolerant reads. Checks npm `dist-tags` for newer versions with an abortable timeout and SemVer-precedence comparison. |
| `src/core/version/updateScheduler.ts` | Schedules update checks with injected timers: single-flight requests, a periodic interval after successes, jittered exponential backoff after failures, and disposal that aborts in-flight requests. Classifies only completed comparisons as verified results. |

### `src/core/workspace/`

| File | Purpose |
| --- | --- |
| `src/core/workspace/appData.ts` | Resolves platform-specific Ubume data, workspace, conversation, cache, attachment, and debug paths. |
| `src/core/workspace/attachments.ts` | Imports external attachments into app data, identifies images, and rewrites prompts to safe workspace-visible paths. |
| `src/core/workspace/checkpoints.ts` | Captures file checkpoints and journals guarded file restore operations. |
| `src/core/workspace/conversationStore.ts` | Persists workspace-scoped conversation metadata and canonical messages (with optional per-reply activity summaries) with atomic JSON writes. |
| `src/core/workspace/launchContext.ts` | Describes installed/dev launch context and builds guarded workspace relaunch commands. |
| `src/core/workspace/ownership.ts` | Acquires and releases workspace execution and conversation ownership leases. |
| `src/core/workspace/planStorage.ts` | Normalizes, saves, and reads reviewed plans from Ubume workspace data. |
| `src/core/workspace/projectInstructions.ts` | Finds and loads AGENTS.md/project instructions with explicit missing, loaded, and error states. |
| `src/core/workspace/scratchDir.ts` | Describes, lazily creates, removes when unused, and prunes per-session `.ubume/scratch/<session>` folders where the Local agent keeps throwaway test/debug files. |
| `src/core/workspace/workspaceActivity.ts` | Snapshots workspace files, detects changes, aggregates activity, and tracks modifications during runs. |
| `src/core/workspace/workspaceFiles.ts` | Resolves, reads, and guards workspace file selections. |
| `src/core/workspace/workspaceGuard.ts` | Normalizes diagnostic paths, blocks or explains paths and commands outside the active workspace, and classifies destructive shell commands. |
| `src/core/workspace/workspaceRoot.ts` | Resolves, normalizes, and compares the active workspace root across platforms and launch modes. |

### `src/headless/`

| File | Purpose |
| --- | --- |
| `src/headless/commands.ts` | Dispatches CLI headless commands, including exec, benchmark, sessions, and diagnostics. |
| `src/headless/context.ts` | Builds resolved runtime/provider context for headless command execution. |
| `src/headless/diagnostics.ts` | Reports command-line environment, provider availability, and launch diagnostics. |
| `src/headless/execArgs.ts` | Parses ubume exec arguments, prompt policy, timing flags, and shared launch options. |
| `src/headless/execRunner.ts` | Runs a backend without Ink, streams assistant text to stdout, diagnostics to stderr, and returns stable exit codes. |
| `src/headless/savedExec.ts` | Persists and resumes headless execution conversations with workspace ownership. |

### `src/session/`

| File | Purpose |
| --- | --- |
| `src/session/appSession.ts` | Defines the aggregate session reducer and hook for transcript events, input history, active runs, clear epochs, and UI lifecycle. |
| `src/session/chatLifecycle.ts` | Implements pure lifecycle/event reducers for progress, thinking, tools, response segments, plans, completion, failure, and cancellation. |
| `src/session/conversation.ts` | Converts durable dialogue into timeline events (including saved activity summaries) and plain role/content provider request history. |
| `src/session/eventIds.ts` | Allocates event/turn IDs, advances them past restored events, and creates startup/auth state. |
| `src/session/liveRenderScheduler.ts` | Batches provider deltas and progress updates at separate cadences before session dispatch. Schedules provider start after the submitted prompt frame has had an opportunity to render. |
| `src/session/persistedResponse.ts` | Builds the assistant message saved for each run (completed, canceled, failed) with a compact files-changed / commands-run summary for `/resume`. |
| `src/session/planFlow.ts` | Models plan-mode transitions, approval/revision decisions, and execution hand-off. |
| `src/session/sessionCatalog.ts` | Builds local/native resume catalogs and resolves saved-workspace relaunch plans. |
| `src/session/transcriptExport.ts` | Pairs chronological prompt/reply turns and copies their readable transcript. |
| `src/session/types.ts` | Defines screens, UI lifecycle states, timeline events, run stream items, tool activity, and shared session helpers. |
| `src/session/workbench.ts` | Owns prompt queues, snapshots, tool-output inspection, and persisted workbench state. |

### `src/ui/`

| File | Purpose |
| --- | --- |
| `src/ui/layout.ts` | Calculates responsive terminal dimensions, layout modes, row budgets, panel space, and viewport state. |
| `src/ui/theme.tsx` | Defines theme palettes, the React theme provider, and the useTheme hook. Normalizes theme changes and determines persisted/current theme transitions. |

### `src/ui/chrome/`

| File | Purpose |
| --- | --- |
| `src/ui/chrome/AppShell.tsx` | Owns responsive overlay and panel composition plus reusable shell row budgeting; TranscriptShell remains the main-chat/native-scrollback owner. |
| `src/ui/chrome/BottomComposer.tsx` | Renders the single prompt composer and its provider/model/context status area. |
| `src/ui/chrome/TopHeader.tsx` | Renders responsive Ubume branding and workspace/auth/provider header content. |
| `src/ui/chrome/UpdateAvailableCard.tsx` | Renders an actionable notice when a newer Ubume version is available. |
| `src/ui/chrome/statusIndicators.tsx` | Displays width-aware animated status text without destabilizing surrounding rows. Provides the shared spinner animation primitive. Calculates deterministic frames and labels for busy-state animations. |

### `src/ui/chrome/composer/`

| File | Purpose |
| --- | --- |
| `src/ui/chrome/composer/composerKeymap.ts` | Pure composer key classification and raw terminal key sequences. |
| `src/ui/chrome/composer/composerModel.ts` | Composer props, measurement, status labels, and suggestion helpers. |
| `src/ui/chrome/composer/useComposerInput.ts` | Composer editing, paste, mentions, focus, and raw-key lifecycle. |

### `src/ui/input/`

| File | Purpose |
| --- | --- |
| `src/ui/input/focus.ts` | Defines focus identifiers and helpers shared by composer and overlay controls. |
| `src/ui/input/inputBuffer.ts` | Implements cursor-aware Unicode editing, history movement, paste, deletion, and buffer updates. |
| `src/ui/input/pastedContent.ts` | Registers pasted text and image tokens and rewrites submitted attachment content. |
| `src/ui/input/rawArrowKeys.ts` | Resolves arrow keys from raw stdin chunks so panels survive split escape sequences. |
| `src/ui/input/slashCommands.ts` | Defines discoverable slash-command metadata, aliases, filtering, and completion behavior. |
| `src/ui/input/useStdinRawModeLease.ts` | Holds Ink's raw-mode refcount above zero for the App lifetime so shell swaps never detach the stdin readable listener. |

### `src/ui/panels/`

| File | Purpose |
| --- | --- |
| `src/ui/panels/AttachmentImportPanel.tsx` | Confirms external attachment import and shows source/destination safety information. |
| `src/ui/panels/AuthPanel.tsx` | Displays authentication state and login/logout guidance. |
| `src/ui/panels/ExternalSessionViewer.tsx` | Read-only, scrollable transcript of a native Claude Code / Codex / Mistral Vibe session with open-natively and continue-in-Ubume actions. |
| `src/ui/panels/ModelPickerScreen.tsx` | Coordinates provider-scoped model discovery, loading/error states, selection, and reasoning hand-off. |
| `src/ui/panels/PermissionsPanel.tsx` | Displays and edits approval, sandbox, network, writable-root, service-tier, and personality settings. |
| `src/ui/panels/PlanActionPicker.tsx` | Offers execute, revise, or cancel actions after a plan is produced. |
| `src/ui/panels/ProviderPicker.tsx` | Displays provider availability, current/default route state, models, and provider actions. |
| `src/ui/panels/ProviderSetupPrompt.tsx` | Explains provider setup and routes install/login choices. |
| `src/ui/panels/ResumePicker.tsx` | Tabbed `/resume` picker: Ubume conversations plus Claude Code, Codex, and Mistral Vibe sessions for this folder or all projects. |
| `src/ui/panels/SelectionPanel.tsx` | Provides the reusable keyboard-driven selection list with visible-window management. |
| `src/ui/panels/SettingsPanel.tsx` | Displays and edits persistent user interface settings. |
| `src/ui/panels/SimplePickers.tsx` | Selects execution mode and explains its behavior. Selects Codex reasoning effort for the active model. Previews and selects a persisted color theme. |
| `src/ui/panels/TextEntryPanel.tsx` | Provides a reusable focused text-entry overlay. |
| `src/ui/panels/ToolApprovalPanel.tsx` | Displays a tool request and collects allow/deny/cancel decisions. |
| `src/ui/panels/UpdatePromptPanel.tsx` | Presents detected update information and the install command. |
| `src/ui/panels/UsagePanel.tsx` | `/usage` overlay: provider usage rows with R refresh (respecting cooldown/in-flight), Esc/q close, and arrow-key scrolling on short terminals. |
| `src/ui/panels/WorkbenchPanel.tsx` | Displays transcript, queue, diff, and checkpoint recovery views. |
| `src/ui/panels/responsivePickerViewport.ts` | Calculates picker rows and viewport windows for terminal dimensions. |
| `src/ui/panels/resumePickerRows.ts` | Pure row/label formatting and section types for the resume picker. |
| `src/ui/panels/usagePanelRows.ts` | Pure, width-bounded row builder for the usage panel: bars only for reported percentages, extreme-value rounding, local-time resets, and live/cached/stale/observed labels. |

### `src/ui/render/`

| File | Purpose |
| --- | --- |
| `src/ui/render/Markdown.tsx` | Provides common bordered panel layout and hint treatment. Parses and renders terminal-safe Markdown blocks, inline styles, lists, links, tables, and code. |
| `src/ui/render/diffRenderer.ts` | Parses unified diffs and emits width-aware colored terminal rows. |
| `src/ui/render/logoVariants.ts` | Chooses full, compact, or tiny Ubume branding for the available terminal dimensions. |
| `src/ui/render/outputPipeline.ts` | Normalizes provider output before it reaches higher-level terminal rendering. |
| `src/ui/render/runtimeDisplay.ts` | Formats execution-mode labels and descriptions for terminal display. Formats runtime policy and provider/model metadata into compact display values. |
| `src/ui/render/terminalAnswerFormat.ts` | Normalizes assistant answer conventions, especially local file references, for terminal presentation. |

### `src/ui/timeline/`

| File | Purpose |
| --- | --- |
| `src/ui/timeline/ActionRequiredBlock.tsx` | Renders questions or actions that require explicit user input. |
| `src/ui/timeline/AgentBlock.tsx` | Renders assistant response segments, tool actions, progress, and run metadata in stream order. |
| `src/ui/timeline/DashCard.tsx` | Provides a reusable dashed-border informational card. |
| `src/ui/timeline/Timeline.tsx` | Builds turn/event items, manages scroll/follow-tail navigation, and renders the measured transcript viewport. |
| `src/ui/timeline/TimelineRows.tsx` | Timeline row rendering and memo comparators. |
| `src/ui/timeline/TranscriptShell.tsx` | Commits static transcript rows and live-tail rows while preserving native terminal scrollback behavior. |
| `src/ui/timeline/TurnGroup.tsx` | Groups a user prompt, run, and assistant response and derives phase/opacity presentation. |
| `src/ui/timeline/liveViewportWindow.ts` | Tail-windows a running turn's live rows to the conversation viewport so Ink never clears the terminal and scrollback mid-stream. |
| `src/ui/timeline/progressEntries.ts` | Normalizes provider progress entries into stable visible thinking blocks. |
| `src/ui/timeline/runActivityView.ts` | Normalizes terminal commands and paths into friendly activity labels. Aggregates and formats changed-file and tool activity for timeline display. Merges consecutive reasoning stream events so contiguous thought renders under one header. |
| `src/ui/timeline/staticTranscriptCache.ts` | Incrementally builds native rows for finalized turns keyed by event identity and opacity, and retains row objects only for the newest turns. |
| `src/ui/timeline/timelineItems.ts` | Pure transcript item construction and turn presentation state. |
| `src/ui/timeline/timelineMeasure.ts` | Converts timeline items into stable semantic rows, caches measurements, and builds viewport snapshots. |
| `src/ui/timeline/timelineViewport.ts` | Pure viewport anchoring, scrolling, reflow, and row selection. |
| `src/ui/timeline/useTimelineViewport.ts` | Viewport state and effects, preserving finalize transition ordering. |

### `src/ui/timeline/measure/`

| File | Purpose |
| --- | --- |
| `src/ui/timeline/measure/caches.ts` | Timeline row cache ownership and reset entry point. |
| `src/ui/timeline/measure/cards.ts` | Timeline bordered cards, user input, and impact summaries. |
| `src/ui/timeline/measure/eventRows.ts` | Standalone, introductory, and action-required event rows. |
| `src/ui/timeline/measure/markdownRows.ts` | Markdown and code-block row measurement. |
| `src/ui/timeline/measure/nativeTranscript.ts` | Native scrollback transcript parts and turn build instrumentation. |
| `src/ui/timeline/measure/rows.ts` | Styled row wrapping, width, padding, and snapshot assembly. |
| `src/ui/timeline/measure/stableSnapshot.ts` | Stable and live snapshot construction with frozen row groups. |
| `src/ui/timeline/measure/streamRows.ts` | Stream event rendering, coalescing, live indicators, and turn rows. |
| `src/ui/timeline/measure/types.ts` | Timeline measurement and render-item types without a component dependency. |
