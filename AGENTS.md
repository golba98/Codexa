# Repository Operating Guide

This file contains repository-specific working rules for Codex on this project.

## Priority Order

- Follow task-specific user instructions first.
- Then follow this file.
- If a rule conflicts with existing project code or current work, preserve the user’s requested change and adjust the implementation accordingly.

## Decision Rule

- If a detail is missing but the safe, obvious choice exists, proceed with that assumption and state it briefly.
- Ask a question only when the missing detail would likely produce the wrong file change, command, or behavior.

## Project Structure

- `bin/ubume.js` is the CLI entry point; headless commands flow through `src/cli.ts` into `src/headless/commands.ts`.
- `src/app/` owns interactive orchestration, typed hooks, shared run refs, and overlay rendering.
- `src/index.tsx` starts the Ink app; `src/app/App.tsx` composes typed app hooks and owns clear-frame wiring.
- `src/ui/` holds Ink components, layout, themes, helpers, and colocated UI tests, grouped into `chrome/`, `timeline/`, `panels/`, `render/`, and `input/` with shared foundations (theme, layout) at the root.
- `src/core/` holds backend integration, subprocess launching, terminal utilities, providers, models, Codex auth, shared values/text, and workspace helpers.
- `src/config/`, `src/session/`, `src/commands/`, and `src/headless/` cover configuration, lifecycle state, slash commands, and non-interactive execution.
- `src/test/` stores shared test helpers.
- Use `docs/` for durable notes and `scripts/` for standalone utilities.

## Common Commands

- `bun run dev` starts the TUI with file watching.
- `bun run start` runs `src/index.tsx` once.
- `bun run typecheck` runs `tsc --noEmit`.
- `bun run format` formats `src/` with Biome; `bun run check` verifies formatting and lint (also part of `bun run build`).
- `bun test` runs the full Bun test suite.
- `bun test src/ui/layout.test.ts` runs a focused test file or pattern.
- `bun run build` regenerates build info, then runs type checking and `bun run check`.
- `bun run audit:ubume-gap` and `bun run smoke:terminal-bench` run repo-specific audit and smoke scripts.

## Coding Style

- Use TypeScript ESM and keep imports explicit.
- Formatting and lint are enforced by Biome (`biome.json`): run `bun run format` before committing and `bun run check` to verify. Don't hand-format against it.
- Keep React components concise and name them in `PascalCase`.
- Name hooks `use...`, utilities `camelCase`, and tests `sourceName.test.ts` or `sourceName.test.tsx`.
- Put new `src/ui/` files in the matching domain folder (`chrome/`, `timeline/`, `panels/`, `render/`, `input/`); only true cross-group foundations belong at the `src/ui/` root.

## Testing Expectations

- Put focused tests next to the code you change.
- Add or update tests for reducers, parsers, terminal rendering, provider behavior, and command argument generation when those areas change.
- Bun automatically discovers colocated `*.test.ts` and `*.test.tsx` files.
- Run `bun test`, `bun run typecheck`, and `bun run check` before publishing or opening a PR.

## Commit And PR Norms

- Use Conventional Commit-style subjects, such as `docs: add REPO_STRUCTURE.md` or `refactor(core): move terminal utilities`.
- Prefer `type(scope): summary` when a scope adds clarity.
- PRs should include a short problem statement, implementation summary, tests run, and linked issues when applicable.
- Include terminal screenshots or recordings for visible TUI changes.
- Call out config, provider, or workspace-locking behavior changes.

## Security And Configuration

- Do not commit local credentials, `.env` files, `node_modules/`, or tool-specific local state.
- Treat project config in `config.toml` as intentional input before relying on it.
- Keep executable path handling explicit for provider CLIs such as Gemini, Claude, and Codex (OpenAI).
