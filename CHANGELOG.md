# Changelog

## Unreleased

### Fixed

- **Provider and model pickers now consume the terminal space available to them** — fixed three/five-row-style windowing has been replaced by a shared responsive capacity and continuous scroll offset. Short lists render in full; overflowing lists show the selected position rather than artificial page ranges.
- **Picker resize and compact behavior is stable** — selection remains visible while navigating or resizing, offsets and invalid dimensions are clamped, and 80×20 panel screens use the existing compact header so list rows take priority. At 100×22 all current provider rows fit alongside the composer and runtime status.
- **Narrow and wide picker rows remain bounded** — secondary metadata yields to names at narrow widths, display-width-aware ellipses prevent border wrapping, and wider layouts retain aligned provider capability metadata.
- **All short-terminal overlay panels expose their options** — Theme (`Ctrl+T`), Mode (`Ctrl+P`), Settings, Auth, provider, and model screens use the compact one-line Codexa header at 24 rows or fewer and no longer lose rows to a redundant close-panel hint.
- **Dense Auth and Settings panels remain readable** — Auth collapses secondary guidance before hiding its three preferences, while Settings keeps each option group on one clipped row so neighboring labels cannot overlap.
- **Theme and generic selection lists no longer drop options** — the fixed `ink-select-input` viewport and stacked padded cards were replaced with the shared continuous responsive list. All nine themes fit at 100×22, the current item owns the cursor, and arrow-key theme previews apply immediately.
- **Development startup is cleaner** — `codexa-dev` no longer prints the `Launch mode` readiness/tip transcript block on startup or after `/clear`; the relaunch command itself remains available.

### Tests

- Added shared viewport tests for complete-list fit, continuous scrolling, larger-terminal capacity, data/resize clamping, and invalid dimensions; updated provider, model, and shell integration coverage for responsive indicators and row use.
- Manually verified the live provider and model panels at 80×20, 100×22, 120×30, and 160×40, including resizing an open 20-model list with its selected item retained.

---

## [1.0.8] — 2026-07-14 — Packaging Maintenance

### Changed

- **Published executable metadata is normalized** — the package now records the `codexa` binary as `bin/codexa.js`, matching npm's canonical package format and avoiding publish-time normalization warnings.
- **Runtime behavior is unchanged** — this maintenance release contains no CLI, configuration, provider, or UI behavior changes.

---

## [1.0.7] — 2026-07-14 — Clean Workspaces

### Changed

- **Codexa no longer creates `.codexa` directories in projects** — provider preferences, imported attachments, and default diagnostic logs now use platform user-data storage instead of the active workspace.
- **Provider settings remain workspace-specific without becoming project files** — Codexa stores each workspace's route, model, and reasoning preferences under a hashed user-data directory.

### Migration

- Existing `.codexa/providers.json` files remain untouched and load as a legacy fallback. When you next save provider settings, Codexa writes the migrated configuration to user data only.
- Existing `.codexa` directories are never deleted automatically.

---

## [1.0.6] — 2026-07-14 — Startup Update Notice

### Fixed

- **New releases are checked on every interactive startup** — Codexa now fetches npm's `latest` tag each time the TUI opens, so a release published after a previous launch is detected on the next run instead of waiting for a cached check to expire.
- **Update prompts are delivered safely** — if Codexa is busy or another panel is open when npm responds, the update prompt waits until the user returns to the idle main screen. Choosing “Later” dismisses it only for that session.
- **Package-manager guidance matches the install** — passive update notices now show the detected npm, pnpm, Yarn, or Bun update command.

### Notes

- Automatic checks remain disabled for local development launches. Headless `codexa exec` output is unchanged.

---

## [1.0.4] — 2026-05-30 — Update Notice Reliability

### Fixed

- **Update notices now use the npm `latest` tag reliably** — Codexa compares the running version against `dist-tags.latest` for `@golba98/codexa` and shows a clear prompt when the installed version is older.
- **Manual `/update check` bypasses stale cache** — explicit checks fetch fresh npm metadata and report update available, already up to date, or a short failure reason.
- **Failed update checks are not cached as success** — startup still fails silently on network or malformed-registry errors, but those failures no longer hide future updates.

### Notes

- Published npm versions are immutable. v1.0.2 contains update-check code, but any runtime prompt defects in that published package cannot be patched retroactively. Users on older versions should run `npm install -g @golba98/codexa@latest`.

---

## [1.0.3] — 2026-05-30 — Package-Ready Release

**This is the package-ready release.** The installed/downloaded Codexa package now includes the full startup UI and matches the working dev/local version.

### Fixed

- **Installed package now shows full Codexa UI** — the large ASCII logo/header, version line, workspace, provider, and footer are all present after `npm install -g @golba98/codexa`. Previously, the published tarball predated the UI overhaul and produced a stripped-down startup screen.
- **`gen-build-info` now runs as part of `prepublishOnly`** — the `APP_VERSION` constant embedded in the package (`src/config/buildInfo.ts`) is guaranteed to match `package.json` at publish time. Previously, publishing without running `npm run build` first could leave a stale version constant in the tarball, causing the header brand line and `codexa --version` to disagree.

### Changed

- **Semantic color-token system** — theme tokens are now lowercase (`logoPrimary`, `text`, `textMuted`, etc.) rather than the legacy uppercase API. This was a ground-up refactor of `src/ui/theme.tsx` and all consuming components.
- **Responsive ASCII logo** — `src/ui/logoVariants.ts` introduces three logo variants (full block-art wordmark, 4-row ASCII fallback, compact single-line) selected by viewport size. Minimum column/row thresholds ensure the logo degrades gracefully on small terminals.
- **Package exclusions corrected** — test files (`*.test.ts`, `*.test.tsx`) and dev-only scripts are excluded from the published tarball. Runtime source is included in full.
- **Linux and Windows package paths verified** — `bin/codexa.js` uses `import.meta.url`-relative `packageRoot` resolution and `join()` throughout; Windows selects `bun.exe`, Linux/macOS selects `bun`.

### Notes

- Dev and production share the same UI renderer. The installed `codexa` command shows `Codexa v1.0.3`; the dev launchers (`codexa-dev` / `cxd`) show `Codexa v1.0.3-dev local`.
- This release does not include new features. It is a package correctness and release-process fix.

### Update checker behavior (for users on v1.0.2)

v1.0.2 contains update-check code, but any prompt defects in the published v1.0.2 package cannot be patched retroactively. If the notice does not appear, run `npm install -g @golba98/codexa@latest`.

The update checker fetches `dist-tags.latest` from `https://registry.npmjs.org/@golba98%2Fcodexa` and compares it against the running version. Update checks are disabled for local dev builds.

---

## [1.0.2] — internal

Color system and package cleanup pass. Not re-released as a standalone version; improvements folded into v1.0.3.

## [1.0.1] — initial release

Initial published release of Codexa.
