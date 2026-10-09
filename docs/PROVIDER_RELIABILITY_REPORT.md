# Google / Antigravity regression repair

## Root cause and recovery

Commit `3912d38` registered native Gemini as Google alongside Antigravity. Commit `5db378c` (PR #291; equivalent history includes `22628c9`) removed the Antigravity runtime, discovery, executable resolution and native session/protobuf support. Google consequently pointed to the wrong implementation.

The complete recoverable implementation is from `3912d38`: `providerRuntime/antigravity.ts`, AGY executable resolution, `externalSessions/antigravitySessions.ts` and protobuf/store helpers, model parsing/effort discovery, native conversation handoff and corresponding tests. This repair retains that execution mechanism rather than constructing a Gemini wrapper.

## Architecture and reference audit

Google is the sole visible registration and maps to `antigravityRuntime`, backend kind `antigravity-cli-auth`. The runtime verifies the AGY help interface, discovers models with `agy models`, optionally reads `/effort`, and executes `agy -p <history plus prompt> --model <native identifier>`. Native resume uses `--conversation`. Gemini executable names are rejected before invocation; there is no fallback.

Legacy `gemini.ts`, `geminiDiscovery.ts`, `geminiSettings.ts` and their runtime tests are removed. Repository references are classified as: AGY runtime/session compatibility; shared Gemini model-family metadata; fixtures proving legacy non-execution; inactive migration records; or historical release notes. Shared Google/Gemini model metadata and unrelated providers remain.

## Migration and models

The `antigravity` alias resolves to Google in CLI arguments, saved selections, sessions and native imports. Proven canonical AGY Google settings win over historical Antigravity fields. Original raw records, including unknown credential fields, are retained in inactive `legacyProviderData`. Legacy-only Google routes are blocked until explicit selection. Parsing/serialization is idempotent; saves use mode 0600. Native credentials and session stores are never migrated or deleted.

Only AGY-proven caches are usable by Google. Old Gemini caches remain inactive. Live inventory preserves actual selectors and human-readable labels; adjustable reasoning comes from advertised variants or effort metadata. Unknown models and unsupported reasoning fail explicitly. Refresh retains selected preferences, and each real send validates the live inventory.

## Capability limits

Historical responses are buffered; Ubume multi-turn continuation replays history in the prompt. Native sessions retain the original AGY conversation handoff. Structured tool events and token streaming were not implemented historically and are not claimed here. Image input is disabled. Tool execution/authentication are delegated to AGY; Google’s permissions panel says so instead of offering ineffective Codex controls.

## Validation

Deterministic process fixtures test the actual installed Ubume launcher, exact AGY arguments, saved-session history, aliases, conflicting configuration, legacy blocking, authentication failure, unavailable models, invalid reasoning, missing runtime, legacy executable rejection and cancellation with child-process termination. Fixtures do not establish real account access.

Real authenticated AGY execution succeeded: single prompt returned `AGY_OK`; a scratch-workspace conversation returned `AGY_CONTEXT_OK`; resuming that Ubume session while switching from `gemini-3.8-flash-low` to `gemini-3.8-flash-medium` returned the remembered `UBUME_AGY_TEST_629`. Isolated Ubume data artifacts are under `/tmp/ubume-agy-real-kqq_yhri`; AGY authentication remained in its existing runtime store.

Real Ink execution returned `AGY_TUI_OK`. Native AGY `--conversation` resumption returned `AGY_NATIVE_RESUME_OK`; the read-only native session reader listed the scratch conversations. Interrupting a running TUI request terminated its observed AGY child PID 232830. A sanitized real terminal capture is in `recordings/google-antigravity-terminal.txt`. The terminal-bench smoke command also completed real AGY tool-backed directory/file listing.

Interactive `--provider` has never been a supported startup selection mechanism; it now fails with guidance rather than interpreting the provider name as a prompt for Codex. Interactive selection uses `/model` or a saved route. `ubume exec --provider google` and the backward-compatible `antigravity` alias are tested.

Validation commands: `bun run format`; `bunx biome check --write` on changed files to organize imports; `bun run typecheck`; `bun run check`; `bun run build`; `bun test --max-concurrency=1`; focused headless/runtime/config/cache/session/UI regression tests; `bun run audit:ubume-gap` (17/17); `bun run smoke:terminal-bench` (successful authenticated AGY execution); `git diff HEAD --check`.

Remaining limitations: real invalid-credential/account-switch scenarios were not exercised by altering existing credentials; deterministic failures/context tests cover them where implemented. Windows execution and real authenticated execution for unaffected providers were not performed. Historical native protobuf extraction remains best effort. Tool output is buffered and does not become structured Ubume tool events. No package was released and nothing was pushed.

Final validation: `bun test --max-concurrency=1` — **1,971 passed, 0 failed across 177 files (137.07 seconds)**. `bun run format`, `bun run typecheck`, `bun run lint`, `bun run check`, `bun run build` and `git diff HEAD --check` passed. Full-suite log: `/tmp/ubume-full-tests.log`; build log: `/tmp/ubume-final-build.log`; lint log: `/tmp/ubume-final-lint.log`.

Changed files: additions restore the Antigravity runtime, discovery/runtime tests, native session reader/tests and protobuf tests, plus executable verification, identity compatibility and installed-launcher process regressions. Modifications wire registries, launcher/config layers, model cache/catalog, headless execution/diagnostics, session resumption, picker/reasoning/permission/display hooks and corresponding tests. Deletions remove the Gemini runtime/discovery/settings modules and obsolete executable/runtime tests. README, architecture/source/terminal documentation and CHANGELOG describe the corrected backend and migration. The generated build-info revision was refreshed by the normal build. Work is on `fix/restore-antigravity-as-google`; pre-existing repair work was preserved.
