# Codexa 1.0.5 — Unreleased

Release notes for the changes currently planned for the next Codexa release.

## Added

- **Instant dynamic model lists for OpenAI/Codex** — the model picker now seeds from the codex CLI's own model catalog (`~/.codex/models_cache.json`) and Codexa's last-good discovery, so all current models and their full reasoning-level ranges (low through ultra) appear immediately at launch without waiting for a live probe. The static compatibility list is now a true last resort instead of the visible default.
- **Persistent per-provider model cache** — successful model discoveries for every provider are saved to `~/.codexa-model-cache.json` and survive restarts: pickers open instantly with the previous session's models while a background refresh updates the list in place.
- **Claude Fable support** — the Anthropic provider now recognizes the Fable family: `fable` is offered first among the Claude aliases with the full effort range (low through max, defaulting to xhigh), and discovery classifies Fable model IDs and labels into their own family.
- **Mistral Vibe CLI provider** — Codexa can discover and launch the `vibe` executable, use Vibe’s existing authentication, display configured Vibe models, and select Vibe as a workspace provider.
- **Vibe session continuity** — workspace sessions can resume through the Vibe CLI, with a safe retry using a fresh session when a saved session is no longer valid.
- **Vibe diagnostics and setup guidance** — missing executables, authentication failures, and unavailable provider configuration now produce actionable messages.
- **Provider-picker integration** — Mistral Vibe appears in provider selection and workspace defaults while retaining its native CLI terminal behavior.

## Fixed

- **Model picker no longer lags behind a provider switch** — pressing "Use in Codexa" on a provider (Antigravity, Claude, GPT, Mistral) now flips the model picker to the new provider immediately instead of showing the previous provider's models until background route validation finished. While a first-ever discovery is still running, the picker shows a provider-named "Discovering models..." state instead of a stale or empty list, and a failed activation rolls the picker back to the previous provider.
- **Faster Antigravity re-activation** — switching back to Antigravity within a session reuses the validated route and discovered model catalog instead of re-spawning the `agy` executable probes every time.
- **New Claude models are discovered automatically** — model discovery now recognizes major-only Claude model ids (e.g. `claude-sonnet-5`, `claude-fable-5`), so newly released models appear in the picker instead of the family staying pinned to an older version (previously stuck on Sonnet 4.6). Each launch also persists the freshly discovered Claude catalog to the model cache, so new models show up after a CLI update with no manual "Refresh models".
- **Kitty terminal startup leak** — Codexa no longer uses Ink’s automatic Kitty keyboard-protocol probe, which could expose the `ESC[?0u` response as visible text above the startup screen or inside the composer. Direct Kitty sessions enable the protocol without probing; other terminals skip it.
- **OpenAI-compatible local responses** — local providers now handle message content, text completions, content-part arrays, and separated reasoning payloads more reliably, with clear errors for genuinely empty responses.
- **Terminal resize and frame stability** — resize recovery preserves the current frame and avoids transient blank or duplicated output.
- **Responsive startup branding** — the logo and metadata fall back cleanly across wide, compact, and very small terminal sizes.
- **Startup and overlay ownership** — the main chat remains in the normal terminal buffer while overlays own alternate-screen behavior, preventing duplicate startup frames and blank overlay transitions.
- **`/clear` rendering reset** — clearing the transcript now performs an atomic visible reset and restores the clean home screen without appended duplicate startup content.
- **Terminal title ownership** — startup title writes are centralized so live UI updates and child-process activity do not cause title flicker.

## Changed

- **Google/Gemini route policy** — Google/Gemini is no longer an active Codexa provider route; fallback behavior and tests now reflect the removed route.
- **Native terminal scrollback** — main chat history follows the terminal’s scrollback buffer, with the composer anchored at the live tail.
- **Provider model discovery** — provider registries and workspace configuration use discovered model capabilities and preserve provider-specific defaults more consistently.
- **`src/ui` reorganized into domain folders** — Ink components are now grouped into `chrome/`, `timeline/`, `panels/`, `render/`, and `input/` (shared foundations stay at the `src/ui` root), with imports, tests, and structure docs updated accordingly. No behavior change.

## Validation

- Full Bun test suite passes.
- TypeScript typecheck passes.
- Kitty and regular-terminal PTY startup smokes show no Kitty query or `[?0u` leakage.
- Changes are tracked as unreleased until the package version and release date are finalized.
