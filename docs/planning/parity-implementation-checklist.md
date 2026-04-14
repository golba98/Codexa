# Codexa Codex CLI Parity Implementation Checklist

Source of truth for ranking and scope: [docs/planning/parity-implementation-backlog.md](</C:/Development/1-JavaScript/13-Custom CLI/docs/planning/parity-implementation-backlog.md>)

This checklist is a status-tracking companion to the ranked backlog. It does not replace the backlog, and it does not re-audit the codebase beyond the baseline verification captured here.

Baseline verification date: 2026-04-14

## Status policy

Only these statuses are valid in this tracker:

- `done`
- `in_progress`
- `foundation_only`
- `not_started`
- `deferred`

Status rules:

- Mark a row `done` only when the feature is user-facing, wired through runtime forwarding where relevant, and covered by at least one test.
- Mark a row `foundation_only` when adjacent plumbing exists but the backlog scope is still missing.
- Keep the backlog wording intact here; use this file only to track status, evidence, missing work, and closure criteria.

Update rules:

- Every future status change must include one verification note in the updating PR: how the change was exercised, which command or picker now exists, and which test file covers it.
- Re-check a row only when a merged change claims parity for that row; do not re-audit unrelated rows.
- Audit-excluded items stay excluded unless they are explicitly reopened later.

## Foundational work

### Rank 1 — Unified policy and runtime config state

- Rank: 1
- Title: Unified policy and runtime config state
- Priority: P0
- Status: `foundation_only`
- Dependency ranks: None
- Backlog scope: Add first-class in-memory state for approval policy, sandbox mode, network access, writable roots, service tier, personality, and any session-level policy Codexa needs to forward to `codex`
- Evidence: [src/config/settings.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/config/settings.ts>) defines model, mode, reasoning, and sandbox-adjacent state; [src/config/persistence.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/config/persistence.ts>) persists only backend/model/mode/reasoning/layout/theme/auth preference; [src/app.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/app.tsx>) wires those settings through the current TUI state.
- Missing for closure: no first-class approval policy, explicit sandbox policy, network access, writable roots, service tier, or personality state exists in the session or persisted config model.
- Done when: Codexa has a unified runtime policy model that is user-visible, persisted or layered where intended, forwarded into execution, and covered by tests proving effective settings resolution.

### Rank 2 — Permissions and sandbox controls

- Rank: 2
- Title: Permissions and sandbox controls
- Priority: P0
- Status: `foundation_only`
- Dependency ranks: 1
- Backlog scope: Implement `/permissions` and equivalent picker flows; separate approval policy from mode; expose sandbox mode, network access, and writable roots in a way that actually changes execution
- Evidence: [src/config/settings.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/config/settings.ts>) maps `suggest` and `auto-edit` to sandbox flags and `full-auto` to `--full-auto`; [src/config/persistence.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/config/persistence.ts>) has no permission policy fields; [src/app.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/app.tsx>) only exposes mode-based execution selection.
- Missing for closure: mode is still acting as a coarse sandbox proxy, and there is no `/permissions`, no approval-policy control, no network-access control, and no writable-root management.
- Done when: approval policy, sandbox mode, network access, and writable roots are controllable independently in the TUI and command surface, forwarded to `codex`, and covered by tests for argument building and command handling.

### Rank 3 — `config.toml`, layered config, profiles, and CLI overrides

- Rank: 3
- Title: `config.toml`, layered config, profiles, and CLI overrides
- Priority: P0
- Status: `not_started`
- Dependency ranks: 1
- Backlog scope: Replace JSON-only settings as the effective parity surface; support project and user config, profile selection, and `--config`-style overrides; keep Codexa-specific UI preferences separate if needed
- Evidence: [src/config/persistence.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/config/persistence.ts>) reads and writes `~/.codexa-settings.json`; [src/config/settings.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/config/settings.ts>) contains no TOML or layered resolver; [bin/codexa.js](</C:/Development/1-JavaScript/13-Custom CLI/bin/codexa.js>) launches the TUI directly and does not parse config overrides or profiles.
- Missing for closure: no `config.toml` ingestion, no project plus user layering, no profile selection, no effective-settings resolver, and no launch-time `--config` override support exist.
- Done when: Codexa resolves effective config from project and user TOML layers plus explicit overrides, separates Codexa-only UI prefs where needed, and has tests covering precedence and parsing.

### Rank 4 — Session persistence and core session commands

- Rank: 4
- Title: Session persistence and core session commands
- Priority: P0
- Status: `not_started`
- Dependency ranks: 1
- Backlog scope: Persist conversations, add session IDs and status summaries, implement new-session behavior, saved-session resume, and fork-from-session behavior
- Evidence: [src/session/appSession.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/session/appSession.ts>) keeps transcript and history state entirely in memory; [src/commands/handler.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/commands/handler.ts>) has no `/status`, `/new`, `/resume`, or `/fork`; [src/ui/BottomComposer.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/ui/BottomComposer.tsx>) exposes no resume or fork workflow.
- Missing for closure: no saved session store, no session IDs in user workflows, no status summary command, and no new/resume/fork command or picker flow exist.
- Done when: sessions persist across launches, `/status`, `/new`, `/resume`, and `/fork` work in the TUI and any related CLI flows, and tests cover storage plus command behavior.

### Rank 5 — MCP client support and `/mcp`

- Rank: 5
- Title: MCP client support and `/mcp`
- Priority: P0
- Status: `foundation_only`
- Dependency ranks: 3
- Backlog scope: Read MCP definitions from config, expose available servers and tools in the UI, and implement at least `/mcp` listing parity before deeper MCP management
- Evidence: [src/core/providers/codexJsonStream.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/core/providers/codexJsonStream.ts>) can surface `mcp_tool_call` events from Codex output; [src/commands/handler.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/commands/handler.ts>) has no `/mcp`; [src/app.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/app.tsx>) has no MCP panel or configured-server view.
- Missing for closure: there is no Codexa-side MCP configuration model, no runtime server registry, no `/mcp` command, and no visibility into configured MCP servers or tools.
- Done when: MCP definitions load from config, Codexa shows configured MCP servers and tool availability, `/mcp` lists them, and tests cover config ingestion plus command output.

## Quick wins

### Rank 6 — Align `/copy` semantics with Codex CLI

- Rank: 6
- Title: Align `/copy` semantics with Codex CLI
- Priority: P1
- Status: `not_started`
- Dependency ranks: None
- Backlog scope: Change `/copy` to target the latest completed assistant output, with the same fallback semantics the audit identified as relevant
- Evidence: [src/commands/handler.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/commands/handler.ts>) exposes `/copy`; [src/app.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/app.tsx>) assembles and copies the full conversation transcript rather than the latest completed assistant response.
- Missing for closure: `/copy` still targets the whole transcript and does not implement Codex CLI-style latest-response semantics or fallback behavior.
- Done when: `/copy` selects the latest completed assistant output with the intended fallback path and has tests for transcript edge cases.

### Rank 7 — Split `/clear` from “start a new chat”

- Rank: 7
- Title: Split `/clear` from “start a new chat”
- Priority: P1
- Status: `foundation_only`
- Dependency ranks: 4
- Backlog scope: Preserve a terminal-clear-only path and add a distinct new-conversation path matching Codex CLI semantics
- Evidence: [src/commands/handler.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/commands/handler.ts>) implements `/clear`; [src/session/appSession.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/session/appSession.ts>) only supports transcript clearing; [src/ui/BottomComposer.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/ui/BottomComposer.tsx>) documents `Ctrl+L` as the clear path.
- Missing for closure: `/clear` still conflates terminal clearing and conversation reset, and there is no distinct new-conversation path such as `/new`.
- Done when: Codexa has a terminal-clear-only behavior plus a separate new-chat workflow that matches the intended Codex CLI semantics and is covered by command-handling tests.

### Rank 8 — Fast mode / service tier controls

- Rank: 8
- Title: Fast mode / service tier controls
- Priority: P1
- Status: `not_started`
- Dependency ranks: 1
- Backlog scope: Add service-tier state, `/fast`, persistence, and execution forwarding
- Evidence: [src/config/settings.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/config/settings.ts>) has no service-tier or fast-mode state; [src/config/persistence.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/config/persistence.ts>) persists no such field; [src/commands/handler.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/commands/handler.ts>) has no `/fast`.
- Missing for closure: there is no fast-mode state, no user-facing command or picker, no persistence, and no execution forwarding for service-tier selection.
- Done when: users can enable and inspect fast mode or service tier through the command or picker surface, the provider forwards it correctly, and tests cover config plus argument generation.

### Rank 9 — Personality selection

- Rank: 9
- Title: Personality selection
- Priority: P1
- Status: `not_started`
- Dependency ranks: 1
- Backlog scope: Add personality state and `/personality` command with supported options only
- Evidence: [src/config/settings.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/config/settings.ts>) defines no personality options; [src/config/persistence.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/config/persistence.ts>) persists no personality; [src/commands/handler.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/commands/handler.ts>) has no `/personality`.
- Missing for closure: there is no supported personality list, no command or picker, and no runtime forwarding path.
- Done when: supported personalities are modeled, selectable, persisted or layered appropriately, forwarded into execution, and covered by tests.

### Rank 10 — Windows `/sandbox-add-read-dir`

- Rank: 10
- Title: Windows `/sandbox-add-read-dir`
- Priority: P1
- Status: `not_started`
- Dependency ranks: 2
- Backlog scope: Add the Windows-only command and route it into the sandbox policy model without affecting non-Windows behavior
- Evidence: [src/commands/handler.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/commands/handler.ts>) has no `/sandbox-add-read-dir`; [src/app.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/app.tsx>) has no Windows-specific sandbox-read grant flow; [src/core/workspaceGuard.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/core/workspaceGuard.ts>) enforces workspace bounds but does not model extra read directories.
- Missing for closure: the command does not exist, there is no Windows-only policy path for extra read directories, and there is no forwarding layer for it.
- Done when: Windows users can add sandbox read directories through the documented command, the policy model carries the change without affecting other platforms, and tests cover Windows-specific handling.

## Medium-risk improvements

### Rank 11 — Broader slash-command parity batch

- Rank: 11
- Title: Broader slash-command parity batch
- Priority: P1
- Status: `foundation_only`
- Dependency ranks: 1, 3, 4
- Backlog scope: Implement the highest-value session commands first: `/status`, `/debug-config`, `/diff`, `/compact`; treat `/review`, `/statusline`, and `/ps` as the second half of the same batch once their supporting state exists
- Evidence: [src/commands/handler.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/commands/handler.ts>) implements only the current smaller command set; [src/session/appSession.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/session/appSession.ts>) already tracks transcript and UI state that broader commands would build on; [src/ui/BottomComposer.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/ui/BottomComposer.tsx>) already renders fixed status-line and command suggestion affordances.
- Missing for closure: `/status`, `/debug-config`, `/diff`, `/compact`, `/review`, `/statusline`, and `/ps` remain absent, and their runtime behaviors are not wired.
- Done when: the prioritized slash commands exist, produce useful output from live runtime state, and are covered by parser plus UI or reducer tests.

### Rank 12 — CLI parity surface beyond the TUI

- Rank: 12
- Title: CLI parity surface beyond the TUI
- Priority: P1
- Status: `not_started`
- Dependency ranks: 3, 4
- Backlog scope: Add launch-time flags first, then subcommands that reuse persisted session or sandbox logic, then completion generation once the CLI surface stabilizes
- Evidence: [bin/codexa.js](</C:/Development/1-JavaScript/13-Custom CLI/bin/codexa.js>) only resolves Bun and launches the TUI for the current working directory; there is no CLI argument parser, no parity subcommands, and no completion generator in the repo.
- Missing for closure: Codexa is still effectively flagless and lacks parity subcommands such as `resume`, `fork`, `sandbox`, and shell completion output.
- Done when: the launcher parses documented parity flags, exposes the planned non-TUI subcommands, and has tests covering argument parsing and entrypoint behavior.

### Rank 13 — Composer and workflow UX parity

- Rank: 13
- Title: Composer and workflow UX parity
- Priority: P1
- Status: `foundation_only`
- Dependency ranks: 4, 11
- Backlog scope: Stage this internally as four separate deliverables: `@` mention search, `Ctrl+G` editor handoff, previous-message edit/fork flow, and queued follow-up prompts during active runs
- Evidence: [src/ui/BottomComposer.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/ui/BottomComposer.tsx>) already handles command suggestions, paste, history, and shortcut routing; [src/app.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/app.tsx>) manages active-run state and follow-up continuation; [src/session/appSession.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/session/appSession.ts>) provides the core in-memory transcript state these workflows would extend.
- Missing for closure: there is still no `@` mention picker, no external-editor handoff, no previous-message edit or fork workflow, and no queued follow-up submission while a run is active.
- Done when: all four deliverables are user-visible, integrated with the active-run and session model, and covered by interaction tests where practical.

## High-risk / advanced work

### Rank 14 — MCP server mode

- Rank: 14
- Title: MCP server mode
- Priority: P2
- Status: `not_started`
- Dependency ranks: 5
- Backlog scope: Support Codexa running as an MCP server only after MCP client parity is stable
- Evidence: [bin/codexa.js](</C:/Development/1-JavaScript/13-Custom CLI/bin/codexa.js>) contains only the TUI launch path; there is no MCP server transport, alternate entrypoint mode, or command surface for server operation.
- Missing for closure: no server transport, no MCP server runtime mode, and no CLI entrypoint for running Codexa as an MCP server exist.
- Done when: Codexa can run as an MCP server through a stable entrypoint, the transport is tested, and the client-parity dependency is satisfied first.

### Rank 15 — Lifecycle hooks

- Rank: 15
- Title: Lifecycle hooks
- Priority: P2
- Status: `not_started`
- Dependency ranks: 1, 2, 3
- Backlog scope: Add hook loading and a minimal pre and post shell command hook path before broader event coverage
- Evidence: [src/app.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/app.tsx>) runs prompt and shell flows directly; [src/config/settings.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/config/settings.ts>) has no hook feature state; there is no hook loader or runtime module in the repo.
- Missing for closure: there is no hook configuration, no loader, no lifecycle event model, and no pre or post command interception path.
- Done when: Codexa can load configured hooks, run the minimal supported pre or post shell-command hooks safely, and has tests for hook resolution plus execution boundaries.

### Rank 16 — Multi-agent / subagent support

- Rank: 16
- Title: Multi-agent / subagent support
- Priority: P2
- Status: `not_started`
- Dependency ranks: 4
- Backlog scope: Treat as a separate product layer, not an incremental slash-command change
- Evidence: [src/session/types.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/session/types.ts>) defines a single-thread timeline model; [src/session/appSession.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/session/appSession.ts>) manages one in-memory session state; [src/app.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/app.tsx>) has no agent thread UI or multi-agent coordination flow.
- Missing for closure: there is no thread model for multiple agents, no command surface for agent switching or spawning, and no UI for parallel agent work.
- Done when: session and UI layers support multiple agent threads as a distinct product surface, and tests cover the new thread model plus primary workflows.

### Rank 17 — Apps / connectors browser

- Rank: 17
- Title: Apps / connectors browser
- Priority: P2
- Status: `not_started`
- Dependency ranks: 5
- Backlog scope: Add app discovery only after MCP parity is credible
- Evidence: [src/app.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/app.tsx>) has no connector browser or picker flow; [src/commands/handler.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/commands/handler.ts>) has no `/apps`; there is no app integration module in the repo.
- Missing for closure: there is no apps or connectors discovery surface, no command, and no integration data model.
- Done when: Codexa can discover and browse apps or connectors on top of credible MCP parity, and tests cover the listing and selection surface.

### Rank 18 — Shell snapshot support

- Rank: 18
- Title: Shell snapshot support
- Priority: P2
- Status: `not_started`
- Dependency ranks: 1, 2
- Backlog scope: Defer until core shell policy and session behavior are stable
- Evidence: [src/app.tsx](</C:/Development/1-JavaScript/13-Custom CLI/src/app.tsx>) supports direct foreground shell execution only; [src/core/process/CommandRunner.ts](</C:/Development/1-JavaScript/13-Custom CLI/src/core/process/CommandRunner.ts>) has no snapshot feature path; there is no snapshot state or UI model in the repo.
- Missing for closure: no shell snapshot state, no capture or restore flow, and no user-facing controls exist.
- Done when: shell snapshots are modeled, user-visible, correctly bounded by policy, and covered by tests around capture plus restore behavior.
