# Rendering Flicker Fix Notes

## Title And Output Ownership

- `src/index.tsx` is the only interactive startup owner for the terminal title.
- `bin/codexa.js` no longer writes terminal title OSC sequences before Bun spawn, after spawn, on spawn errors, on close, or from a launcher title interval.
- `bin/codexa.js` no longer strips OSC/title sequences from child stdout/stderr in interactive pipe mode; child output is forwarded unchanged.
- `src/app.tsx` no longer refreshes or reasserts the terminal title from busy state, provider validation, model changes, `/clear`, shell execution, prompt execution, tool completion, or provider process lifecycle callbacks.
- Terminal title helpers remain available for explicit one-shot writes, but interval/retry title guards were removed from live UI usage.

## Runtime Display Derivation

- Runtime provider/model/status text is now derived synchronously with `useMemo` from the active provider route, active runtime display, provider diagnostics, and registry nonce.
- The status display prefers active route values, then last-known diagnostics such as `selectedModel`, then stable fallback labels.
- Local provider availability falls back through diagnostics and renders `checking`, `reconnecting`, `unavailable`, or `Unknown` instead of going blank.

## Status Bar Stability

- The bottom composer remains the single owner of the fixed one-row runtime/status display.
- Provider/model text falls back to `Local / Detecting...`.
- The context region always renders, using `Unknown` when no context metadata is available.
- Status bar render counts are traced through the render debug log when render debugging is enabled.

## Diagnostics

- Render/model diagnostics are file-only.
- Enable with `CODEXA_RENDER_DEBUG=1`; `CODEXA_DEBUG_MODEL_STATE=1` is also accepted as an alias for model-state diagnostics.
- The default diagnostic path is `.codexa/debug/render-status.log`, unless `CODEXA_RENDER_DEBUG_FILE` is set.
- No render diagnostics are written with `console.log`, `console.error`, stdout, or stderr during active TUI rendering.

## Remaining Risky Writers

- `frameLock` still wraps stdout and may inject row-clear padding.
- `clearFrameBoundary` still owns transcript clear and resize repaint paths.
- Startup clear still writes viewport/scrollback clear sequences before Ink starts.
- Alternate screen, bracketed paste, mouse-mode restoration, and resize repaint paths still write terminal control sequences.
- Provider CLI launch still writes a newline before handing control to the external CLI.

## Verification

- Passed: `bun install`
- Passed: `bun run typecheck`
- Passed: `bun run build`
- Passed: `bun test src/appRenderStability.test.ts src/core/terminal/terminalTitle.test.ts src/index.test.tsx src/ui/AppShell.test.tsx src/ui/BottomComposer.test.ts src/core/providerRuntime/local.test.ts`
- Passed: `bun test src/core/terminal/frameLock.test.ts src/index.test.tsx`
- Passed: `bun test src/core/perf/renderDebug.test.ts src/core/terminal/frameLock.test.ts src/index.test.tsx`
- Full suite: `bun test` still fails outside this patch area.
  - `src/ui/ActivityIndicator.test.tsx`: error/provider-failed glyph assertions expect `�`.
  - Header/logo layout tests fail for wide metadata/logo rendering.
  - After those failures, many `node:test` files report Bun runner `NotImplementedError: test() inside another test() is not yet implemented`.
- Not run: manual interactive smoke test.
