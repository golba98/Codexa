# Code Quality & Package Readiness Audit — Codexa

**Date:** 2026-05-30  
**Branch:** `quality/codexa-package-ready-maintenance-pass`  
**Scope:** Full audit — every source file, config, script, and doc reviewed for both code quality and package publishing correctness.

---

## Project Structure Summary

| Layer | Path | Role |
|---|---|---|
| CLI entry | `bin/codexa.js` | Node.js launcher (shebang: `#!/usr/bin/env node`); spawns Bun to run `src/index.tsx` |
| App bootstrap | `src/index.tsx` | `startApp()` — Ink lifecycle, custom resize handling |
| Root component | `src/app.tsx` | `<App />` — all runtime state, screen routing, backend orchestration |
| Session state | `src/session/` | Reducer-based state machine (`appSession`, `chatLifecycle`, `planFlow`) |
| Config | `src/config/` | Layered TOML config; UI settings; trust store |
| Core / backend | `src/core/` | Subprocess providers, terminal utilities, model specs, auth probing |
| UI | `src/ui/` | 80+ Ink components; render pipeline; theme system |
| Commands | `src/commands/` | Slash command (`/config`, `/model`, `/shell`, etc.) handler |
| Headless | `src/headless/` | Non-interactive exec mode |
| Types | `src/types/` | Ambient TypeScript declarations |
| Scripts | `scripts/` | Dev-only tooling (build info, local install, smoke tests, audit) — NOT shipped |
| Docs | `docs/` | Architecture docs, gap audits, perf notes — NOT shipped |

**Stack:** TypeScript · Bun · Ink (React for terminal) · ESNext modules  
**Runtime model:** TypeScript source is published and executed directly by Bun at runtime (no compile step). Bun ≥ 1.0.0 is required on the user's machine.  
**Test runner:** Bun native (`bun test`) — 1,217 tests across 103 files

---

## How the Package Runs After Install

```
npm install -g @golba98/codexa
codexa
```

1. npm installs `bin/`, `src/` (non-test files), `package.json`, `README.md`, `node_modules/`
2. User runs `codexa` → shell resolves to `bin/codexa.js` (Node.js entry, shebang `#!/usr/bin/env node`)
3. `bin/codexa.js` reads `package.json` for the version string
4. `bin/codexa.js` resolves `src/index.tsx` relative to the package root
5. `bin/codexa.js` spawns: `bun run --silent <packageRoot>/src/index.tsx`
6. Bun runs the TypeScript source directly (Bun's built-in transpiler — no `dist/` needed)
7. If Bun is not found: clear error message — `"Bun is required to launch codexa. Install Bun, then run this command again."`

Runtime config is read from user home (`~/.codex/config.toml`) and the project workspace (`.codex/config.toml`). No config file is bundled in the package.

---

## Package Readiness Issues — FIXED

### Issue 1: `scripts/` included in published package (all 6 files are dev-only)

**Severity:** Medium — inflated package size, confusing for users  
**Before:** `files: ["bin/", "src/", "scripts/", "config.toml"]` — shipped 6 dev-only scripts  
**Files affected:**
- `scripts/gen-build-info.mjs` — generates `src/config/buildInfo.ts` at build time (dev only)
- `scripts/install-local-dev-bin.mjs` — creates local `codexa-dev`/`cxd` shims (dev only)
- `scripts/run-local-dev.mjs` — local dev launcher (dev only)
- `scripts/run-local-dev.test.ts` — tests for the dev launcher (dev only)
- `scripts/audit-codexa-capabilities.mjs` — feature gap analysis tool (dev only)
- `scripts/smoke-terminal-bench.mjs` — terminal performance benchmarks (dev only)

None of these are referenced by `bin/codexa.js` or imported from `src/`. All are only invoked via npm scripts (`dev:run`, `install:dev-bin`, `gen-build-info`, etc.) during local development.

**Fix:** Removed `"scripts/"` from the `files` field.

---

### Issue 2: `config.toml` listed in `files` but file does not exist

**Severity:** Low — stale entry, harmless (npm silently ignores missing files), but misleading  
**Before:** `"config.toml"` in `files`  
**Analysis:** `src/config/layeredConfig.ts` never reads a config file from the package root. Runtime config is loaded from `~/.codex/config.toml` (user home) and `.codex/config.toml` (project workspace). No bundled config is needed.

**Fix:** Removed `"config.toml"` from the `files` field.

---

### Issue 3: 102 test files shipped in `src/`

**Severity:** High — test files doubled the package size, provided zero value to end users  
**Before:** 247 total files, 2.3 MB unpacked (474 kB compressed)  
**After:** 139 total files, 1.4 MB unpacked (305 kB compressed)

All `.test.ts` and `.test.tsx` files inside `src/` were being included because `src/` was in the `files` allowlist with no exclusions.

**Fix:** Added negation patterns to the `files` field:
```json
"files": [
  "bin/",
  "src/",
  "!src/**/*.test.ts",
  "!src/**/*.test.tsx"
]
```

**Note on `.npmignore`:** A `.npmignore` file was tried first with `src/**/*.test.ts` patterns, but npm v10 does not apply `.npmignore` glob exclusions within directories already whitelisted by the `files` field. The negation patterns in `files` itself is the correct mechanism and was verified to work.

---

## Package Contents — Before vs After

| What | Before | After |
|---|---|---|
| Total files | 247 | 139 |
| Packed size | 474 kB | 305 kB |
| Unpacked size | 2.3 MB | 1.4 MB |
| Test files shipped | 102 | 0 |
| Scripts shipped | 6 | 0 |
| `config.toml` ref | Stale (missing) | Removed |

---

## What Ships Now

| Path | Ships | Reason |
|---|---|---|
| `bin/codexa.js` | ✅ | Node.js CLI entry point |
| `src/**` (non-test) | ✅ | Application source code (Bun executes at runtime) |
| `package.json` | ✅ | npm always includes; read for version string |
| `README.md` | ✅ | npm always includes `README*` |
| `node_modules/` | ✅ | Production deps: `ink`, `react`, `react-dom`, `ink-select-input` |
| `src/**/*.test.*` | ❌ | Dev-only test files — excluded by `files` negation |
| `scripts/` | ❌ | Dev-only tooling — removed from `files` |
| `config.toml` | ❌ | Doesn't exist; runtime config from user home |
| `docs/` | ❌ | Not in `files`, never shipped |
| `.github/` | ❌ | Not in `files`, never shipped |
| `tsconfig.json` | ❌ | Not in `files`, not needed at runtime |

---

## Code Quality Issues Reviewed

All source files were reviewed in a prior full-codebase audit. This branch is focused on package readiness. Code quality changes are tracked on `quality/full-codebase-maintenance-pass`.

**Items confirmed clean in this review:**
- `bin/codexa.js` — correct shebang, correct paths, correct Bun error handling
- All `src/config/` files — no bundled config dependency, correct home-dir lookup
- All `scripts/` files — correctly identified as dev-only, no runtime references

---

## Intentionally NOT Changed

| Item | Reason |
|---|---|
| TypeScript source shipped instead of compiled JS | Intentional Bun-native design. Bun's runtime transpiler handles `.tsx`/`.ts` directly. No compile step needed. |
| Bun not in `peerDependencies` | `engines: { bun: ">=1.0.0" }` declares the requirement. `bin/codexa.js` has a clear user-facing error if Bun is missing. Adding `peerDependencies` for a runtime (not an npm package) is not standard practice. |
| `bin` only has `codexa` | `codexa-dev`/`cxd` are local dev shims created by `scripts/install-local-dev-bin.mjs` — intentionally NOT published commands. |

---

## Verification Commands & Results

```
npm pack --dry-run           → 139 files, 1.4 MB unpacked, 305 kB packed
grep "\.test\." (dry-run)    → 0 matches (no test files)
grep "scripts/" (dry-run)    → 0 matches (no scripts)
tar -tzf *.tgz | grep test   → 0 matches (confirmed in tarball)
bun run typecheck            → PASS (0 errors)
bun test                     → PASS (1217/1217, 103 files)
```
