# Codexa 1.0.5 — Unreleased

Release notes for the changes currently planned for the next Codexa release.

## Added

- **Mistral Vibe CLI provider** — Codexa can discover and launch the `vibe` executable, use Vibe’s existing authentication, display configured Vibe models, and select Vibe as a workspace provider.
- **Vibe session continuity** — workspace sessions can resume through the Vibe CLI, with a safe retry using a fresh session when a saved session is no longer valid.
- **Vibe diagnostics and setup guidance** — missing executables, authentication failures, and unavailable provider configuration now produce actionable messages.
- **Provider-picker integration** — Mistral Vibe appears in provider selection and workspace defaults while retaining its native CLI terminal behavior.

## Fixed

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

## Validation

- Full Bun test suite passes.
- TypeScript typecheck passes.
- Kitty and regular-terminal PTY startup smokes show no Kitty query or `[?0u` leakage.
- Changes are tracked as unreleased until the package version and release date are finalized.
