# Changelog

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

Once v1.0.3 is published to npm, users on v1.0.2 will see the in-app update notice on next startup (within 6 hours — the cache TTL). To see it immediately: delete `~/.codexa-update-check.json` and restart Codexa, or run `/update check` in-app.

The update checker fetches `dist-tags.latest` from `https://registry.npmjs.org/@golba98%2Fcodexa` and compares it against the running version. Update checks are disabled for local dev builds.

---

## [1.0.2] — internal

Color system and package cleanup pass. Not re-released as a standalone version; improvements folded into v1.0.3.

## [1.0.1] — initial release

Initial published release of Codexa.
