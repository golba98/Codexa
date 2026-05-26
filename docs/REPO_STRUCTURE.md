# Repository Structure

A guide to where things live and where new code should go.

## Top-Level Layout

```
bin/          Compiled CLI entry point (bin/codexa.js)
src/          TypeScript source (see below)
docs/         Supplementary documentation and notes
scripts/      Standalone audit and benchmark scripts
.github/      GitHub Actions workflows and Gemini automation commands
```

## `src/` Layout

### Root files

- `index.tsx` — App entry point. Handles terminal capability detection, Ink render lifecycle, and the custom resize/repaint strategy.
- `app.tsx` — Root React component. Single source of truth for all runtime state, screen routing, and the backend run lifecycle.
- `exec.ts` — Headless single-run execution entry (used by `codexa exec`).

### `src/config/`

Configuration loading and preferences.

| File | Purpose |
|---|---|
| `layeredConfig.ts` | Resolves the 5-layer TOML config (defaults → user → project → profile → CLI) |
| `runtimeConfig.ts` | `RuntimeConfig` type: policy, sandbox, network, approval, writable roots |
| `settings.ts` | UI preferences, available backends/models/modes, helper formatters |
| `persistence.ts` | Load/save `~/.codexa-settings.json` |
| `launchArgs.ts` | CLI argument parser (`--profile`, `--config`, `--model`, …) |
| `trustStore.ts` | Project trust whitelist (`~/.codex/codexa-trust.json`) |

### `src/core/`

Backend integration, subprocess management, workspace utilities, and terminal I/O.

**Subdirectories:**

| Directory | Contents |
|---|---|
| `terminal/` | Terminal I/O utilities: capability detection, ANSI control sequences, output sanitization, selection detection, title management |
| `executables/` | CLI executable resolution: generic resolver + Codex / Claude / Gemini wrappers |
| `models/` | Model metadata and capabilities: `modelSpecs` (verified specs cache), `codexCapabilities` (CLI feature detection), `codexModelCapabilities` (full model feature matrix) |
| `auth/` | Codex authentication probing and status |
| `perf/` | Performance profiler and render debug tracing |
| `process/` | `CommandRunner` — run arbitrary shell commands for `/shell` actions |
| `providers/` | Default codex-subprocess backend: JSON stream parser, transcript event streaming, provider interface types |
| `providerLauncher/` | Provider registry, workspace config (active route / model / reasoning), launcher initialization |
| `providerRuntime/` | Native Anthropic and Gemini provider implementations, model config, reasoning settings |

**Root-level files in `src/core/`** (no clear subdirectory grouping):

| File | Purpose |
|---|---|
| `codex.ts` | `streamCodex()` — spawns codex subprocess and streams lines to handlers |
| `codexLaunch.ts` / `codexExecArgs.ts` | Build subprocess command and argument list |
| `codexPrompt.ts` | Build and format prompts for codex |
| `launchContext.ts` | Runtime context object (workspace, forward-args, relaunch plan) |
| `workspaceRoot.ts` / `workspaceGuard.ts` / `workspaceActivity.ts` | Workspace path resolution, locking, and file-activity tracking |
| `projectInstructions.ts` | Load `CLAUDE.md` from project root |
| `planStorage.ts` | Save/load plan JSON to disk |
| `hollowResponseFormat.ts` | JSON output format for hollow (non-streaming) responses |
| `githubDiagnostics.ts` | Collect GitHub repo context for diagnostics |
| `cleanupFastFail.ts` | Cleanup handler on subprocess exit |
| `clipboard.ts` | Clipboard read/write stub |
| `inputDebug.ts` | Debug input event tracing |

### `src/session/`

React state management for the conversation lifecycle.

| File | Purpose |
|---|---|
| `types.ts` | All event types (`TimelineEvent` union) and UI state machine (`UIState`) |
| `appSession.ts` | Session reducer + `useAppSessionState` hook. Splits events into `staticEvents` (finalized) and `activeEvents` (in-flight) |
| `chatLifecycle.ts` | Pure reducer functions for all state transitions |
| `planFlow.ts` | Plan → review → execute state machine |
| `liveRenderScheduler.ts` | Batches re-renders during streaming to avoid per-chunk repaints |
| `promptRunSchedule.ts` | Microtask scheduler for prompt submission |
| `planTranscript.ts` | Helper to verify a finalized plan against transcript text |

### `src/commands/`

Slash command handler (`/model`, `/config`, `/workspace`, `/clear`, …). Single file `handler.ts` with a `handleCommand()` export; returns a `CommandResult` that `app.tsx` dispatches as state changes.

### `src/headless/`

Headless (non-interactive) execution mode used by `codexa exec`. `execRunner.ts` is the runner; `execArgs.ts` builds the argument set.

### `src/ui/`

All Ink components and rendering utilities. Kept flat by design — co-locating related tests avoids deep nesting in a directory with 48 files.

**Key rendering pipeline** (for subprocess output): `outputPipeline.ts` → sanitize → normalize → classify (Markdown segments) → `timelineMeasure.ts` (row heights for viewport).

Notable files:

| File | Purpose |
|---|---|
| `AppShell.tsx` | Layout shell: `TopHeader` + `Timeline` + `BottomComposer` |
| `Timeline.tsx` | Scrollable event list with virtual-height measurement |
| `TurnGroup.tsx` | Renders a single conversation turn |
| `BottomComposer.tsx` | Multiline text input with slash-command completion |
| `timelineMeasure.ts` | Row height calculation engine (performance critical; do not split) |
| `theme.tsx` | Theme system and `useTheme()` hook |
| `focus.ts` | Focus ID registry and keyboard routing |
| `layout.ts` | Responsive layout breakpoints and viewport hook |

### `src/types/`

Ambient type declarations (`react-dom.d.ts`).

### `src/test/`

Shared test utilities (`runtimeTestUtils.ts`).

---

## Test Convention

Test files are co-located with their source: `foo.ts` → `foo.test.ts`. Bun discovers tests automatically by scanning for `*.test.ts` / `*.test.tsx` files — no manifest needed.

---

## Key Commands

```bash
bun run dev          # Start with file watching
bun run start        # Single run
bun test             # Run all tests
bun test <pattern>   # Run one test file, e.g.: bun test src/ui/layout.test.ts
bun run typecheck    # TypeScript type-check without emitting
```
