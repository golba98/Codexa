# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev             # Interactive TUI with file watching
bun run start           # Interactive TUI, single run
bun test                # Run all tests
bun test <pattern>      # Run one test file, e.g.: bun test src/ui/layout.test.ts
bun run typecheck       # tsc --noEmit
bun run format          # Biome formatter over src/
bun run check           # Biome format + lint verification (CI mode)
bun run build           # gen-build-info + typecheck + check (no bundling step)
```

Repo scripts (documented in `scripts/README.md`):

```bash
bun run dev:run -- exec "print the current directory"  # Run this checkout through the real launcher split
bun run install:dev-bin      # Install `ubume-dev` / `ubd` shims (plus legacy `codexa-dev` / `cxd`) pointing at this checkout
bun run audit:ubume-gap      # Read-only static capability audit
bun run smoke:terminal-bench # Real headless request through the installed launcher (needs provider auth)
bun run debug:claude-models  # Claude Code model-discovery debug output
```

`src/config/buildInfo.ts` is **generated** by `scripts/gen-build-info.mjs` (via `bun run build`) — never hand-edit it.

## Documentation map

This repo already carries deep docs; read them before spelunking:

- `docs/ARCHITECTURE.md` — subsystem boundaries, prompt data flow, invariants.
- `docs/SOURCE_GUIDE.md` — per-file catalog of everything under `src/`. Update it when a file is added, removed, renamed, or changes responsibility.
- `src/core/README.md` — folder map for `src/core`, including the three provider layers.
- `scripts/README.md` — developer automation.
- `AGENTS.md` — coding style, testing expectations, commit/PR norms (applies to Claude too).

## Architecture Overview

Ubume is a terminal UI wrapping coding-agent CLIs (Codex, Claude Code, Gemini, Mistral Vibe, Antigravity) plus local OpenAI-compatible servers. Stack: TypeScript + Bun + Ink 7 / React 19.

### Two entry points

`bin/ubume.js` (Node ESM launcher) dispatches on the first argument and spawns Bun:

- **Interactive** → `src/index.tsx` → `startApp()` → Ink render of `src/app/App.tsx`.
- **Headless** (`ubume exec …`, `--headless-benchmark`) → `bin/ubume.js` → `src/cli.ts` → `src/headless/commands.ts`, using `execArgs.ts` and `execRunner.ts` for execution. This path avoids Ink and React. Check it when changing configuration or provider behavior.

### Terminal lifecycle (`src/index.tsx` + `src/core/terminal/`)

Ink's own resize handler is removed (`inkInstance.unsubscribeResize()`) so the app is the sole resize authority. `index.tsx`'s `onResize` is intentionally **non-imperative** — it only tracks dimensions and arms invalid-dimension recovery. It must NOT clear the terminal or reset Ink caches; doing so out-of-band flashes a blank frame during streaming.

Repaint authority lives in `src/core/terminal/clearFrameBoundary.ts`, which wraps Ink's `renderInteractiveFrame` and owns every screen-lifecycle transition *atomically with the frame it writes*:

- **`/clear`** — physically clears the transcript with a scrollback-inclusive `\x1b[2J\x1b[3J\x1b[H` and resets Ink's frame caches (`resetInkOutputForFreshFrame`) atomically with the authoritative frame.
- **Width-changing resize** (including the provisional→real dimension settle VTE terminals emit at startup) — the repaint is **deferred, not immediate**. Frames are suppressed until a commit whose layout matches the new width (the viewport hook settles ~100ms late), then a fresh `<Static>` key is requested (`onWidthResizeRefresh`) and the first frame carrying re-flushed static content is committed as clear + full static + live output in one write. Never a cleared screen with a composer-only frame and the transcript arriving after. This must use the scrollback-inclusive clear, not a viewport-only `\x1b[2J`: a width grow re-exposes the pre-resize frame from scrollback and would otherwise stack it behind the new frame on GNOME Terminal.
- **Alternate-screen overlays** — entering/leaving an overlay (`screen !== "main"`) switches DECSET 1049 inside the frame write, resets Ink caches so the first overlay frame is written in full into the blank alt buffer, holds `<Static>` chunks flushed while the overlay is open, and on exit restores the saved normal-buffer caches (plus `log.sync`) and replays the held chunks. Do **not** toggle the alternate screen from React effects — the frame write happens before effects run, so the overlay frame would land in the normal buffer.

This is intentional and must not be "simplified."

### Root App (`src/app/App.tsx`)

`src/app/App.tsx` composes typed hooks for settings, focus, conversation persistence, provider routes, models, prompt execution, and plan flow. `useRunRefs.ts` owns stable lifecycle refs; `OverlayPanels.tsx` remains un-memoized. Clear-frame disposal, synchronization, and terminal buffer wiring stay inline in App. Hook calls preserve effect declaration order, and render-time ref assignments remain in render.

### Session State (`src/session/`)

- `types.ts` — `TimelineEvent` is the union of all event kinds (`UserPromptEvent`, `AssistantEvent`, `RunEvent`, `ShellEvent`, `SystemEvent`, `ErrorEvent`). `UIState` is a machine: `IDLE → THINKING → RESPONDING → AWAITING_USER_ACTION / ERROR`.
- `appSession.ts` — reducer/dispatch hook. Splits events into `staticEvents` (finalized, never re-rendered) and `activeEvents` (in-flight, re-rendered per delta) to keep render scope small.
- `chatLifecycle.ts` — pure reducers for every state transition.
- `planFlow.ts` — plan → review → execute machine (`idle → generating → awaiting_action → executing`).
- `liveRenderScheduler.ts` — queue prompt submissions and pace live re-renders.

### Config System (`src/config/`)

Layered TOML, resolved in priority order:

1. Built-in defaults (`DEFAULT_RUNTIME_CONFIG`)
2. User config: `~/.codex/config.toml`
3. Project config: `.codex/config.toml` (only when the project is trusted)
4. Profile patches (`[profiles.<name>]` in any loaded layer)
5. CLI overrides (`--config key=value`)

`layeredConfig.ts` orchestrates the merge using Bun's TOML parser (`Bun.TOML.parse`). `runtimeConfig.ts` holds the `RuntimeConfig` type and merge utilities. `settings.ts` + `persistence.ts` own UI-only preferences in `~/.ubume-settings.json` (theme, directory display, auth preference) and define the available backends/models/modes/reasoning levels. `trustStore.ts` keeps the project trust whitelist in `~/.codex/ubume-trust.json`.

Mutable app state (caches, plans, attachments, debug logs) belongs in the platform app-data dir resolved by `src/core/workspace/appData.ts` — not in the user's project.

### The three provider layers (`src/core/`)

Similarly named, **not** duplicates. Top to bottom:

- **`providerLauncher/`** — which provider is active for a workspace (`workspaceConfig`), provider UI state (`registry`), and spawning provider CLIs (`launcher`).
- **`providerRuntime/`** — one runtime per provider (`anthropic`, `gemini`, `local`, `antigravity`, `mistralVibe`) behind a shared `ProviderRuntime` interface, plus routing (`registry`), model discovery and metadata (`models`, `capabilityProfile`, `contextMetadata`), and Claude Code discovery. The OpenAI/Codex runtime is defined inline in `registry.ts` and delegates down to `providers/`.
- **`providers/`** — low-level Codex subprocess I/O: spawns the `codex` binary (resolved via `CODEX_EXECUTABLE` or PATH) and parses its output (`codexSubprocess`, `codexJsonStream`, `codexTranscript`).


Other core folders: `codex/` (launch/prompt assembly), `models/` (Codex capability discovery + caches), `executables/` (resolve external CLI binaries), `process/`, `terminal/`, `workspace/` (root, guard, activity, project instructions, plan storage), `version/` (channel + update check), `shared/`, `perf/`.

### UI Layer (`src/ui/`)

Grouped by domain — put new files in the matching folder; only true cross-group foundations (`theme.tsx`, `layout.ts`) live at the root.

- `chrome/` — app shell and persistent chrome: `AppShell.tsx`, `TopHeader.tsx`, `BottomComposer.tsx`, `composer/` input/model/keymap helpers, `statusIndicators.tsx`, and update cards.
- `timeline/` — transcript: `Timeline.tsx`, `TurnGroup.tsx`, `AgentBlock.tsx`, `timelineMeasure.ts` facade, `measure/` row/caches/builders, viewport/item helpers, `TimelineRows.tsx`, and `useTimelineViewport.ts`.
- `panels/` — pickers and overlays: model/provider pickers, `SimplePickers.tsx` (mode, reasoning, theme), session viewers, settings, auth, permissions, plan review.
- `render/` — text/output pipeline: `outputPipeline.ts`, `Markdown.tsx`, `diffRenderer.ts`, `runtimeDisplay.ts` (shared wrapping and widths live in `core/shared/text.ts`).
- `input/` — keyboard and command handling: `focus.ts`, `inputBuffer.ts`, `slashCommands.ts`, `commandNormalize.ts`.

**Render pipeline** for subprocess output (`render/outputPipeline.ts`): sanitize (strip ANSI — diff colors are re-applied at render time from theme tones, so stripping is safe) → normalize (CRLF→LF, collapse blanks, drop noise) → classify (markdown into typed `Segment[]`: prose, code, diff, list, header) → measure (`timeline/timelineMeasure.ts` turns segments into `TimelineRow[]` with heights for the viewport).

`chrome/AppShell.tsx` is memoized with a custom comparator specifically to avoid re-renders during streaming deltas — be careful adding props to it.

### Slash Commands (`src/commands/handler.ts`)

Handles in-app `/` commands (`/config`, `/workspace`, `/model`, `/clear`, …) and returns a `CommandResult` that `App` dispatches as state changes.

## Conventions

- Keep dependencies directional: entry points and `app/App.tsx` compose lower layers; `core/` and `session/` must never import UI components.
- Keep side effects at boundaries — parsers, reducers, measurement, and formatters stay deterministic; process/filesystem/terminal effects live in their named boundary modules.
- Tests are colocated (`sourceName.test.ts[x]`) and auto-discovered by Bun. Add or update tests for reducers, parsers, terminal rendering, provider behavior, and command-argument generation when touching those areas.
- Formatting and lint are enforced by Biome (`biome.json`, 100-column, double quotes, semicolons). Run `bun run format` rather than hand-formatting.
- Run `bun test`, `bun run typecheck`, and `bun run check` before opening a PR. Conventional Commit subjects (`type(scope): summary`).
