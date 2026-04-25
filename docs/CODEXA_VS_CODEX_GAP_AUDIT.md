# CODEXA vs CODEX Feature Gap Audit

**Date**: 2026-04-25  
**Codexa Version**: 1.0.1  
**Repository**: golba98/Codexa  
**Status**: Comprehensive source analysis + capability mapping

---

## Executive Summary

Codexa is a **React/Ink-based terminal UI wrapper** around Codex CLI functionality, achieving approximately **65-70% feature parity** with baseline Codex capabilities. The implementation is **well-architected** with strong support for:

- ✅ Interactive terminal mode with TTY detection
- ✅ Multi-model selection (4 available models)
- ✅ Reasoning levels (6 levels from none to xhigh)
- ✅ TOML-based layered configuration
- ✅ Sandbox/workspace-aware file operations
- ✅ Shell command execution with output capture
- ✅ Session history with event-based architecture
- ✅ Terminal resize handling and signal interrupts
- ✅ Streaming response support
- ✅ Windows platform detection and Bun executable resolution

However, **5 critical gaps** prevent full parity with Codex CLI:

1. **Initial prompt from CLI arguments** – `codexa "my task"` not supported; only interactive mode works
2. **CLI help/version flags** – Only `/help` slash command; `--help` and `--version` not exposed as CLI args
3. **AGENTS.md / project instruction loading** – File exists but NOT auto-loaded or injected into prompts
4. **Non-interactive/headless mode** – TTY required; cannot use Codexa in piped/headless workflows
5. **Mid-execution approval interception** – Approval logic delegated to Codex CLI; Codexa only sees final result

**Overall Assessment**: Codexa is a **capable interactive terminal UI** suitable for hands-on coding tasks. It is **not a drop-in replacement** for Codex CLI in non-interactive scenarios or when project context injection is critical.

**Recommendation**: Address gaps #1, #2, #3 in Phase 1 to achieve 85%+ parity. Gaps #4 and #5 require architectural decisions (TTY-less mode, real-time approval UI).

---

## Feature Parity Matrix

| Feature | Codex Baseline | Codexa Status | Priority | Evidence | User Impact | Recommended Fix |
|---------|---|---|---|---|---|---|
| **Interactive mode (default)** | Spawns repl, accepts stdin | ✅ Implemented | P0 | src/index.tsx, src/app.tsx | **Complete** — User launches `codexa` in terminal and sees Ink UI | None needed |
| **Initial prompt from CLI args** | `codex "my task"` → runs task, exits | ❌ Missing | P0 | launchArgs.ts (no prompt extraction), app.tsx (launchArgs not used for initial prompt) | **Broken workflow** — User cannot pass prompts as CLI args; must use interactive mode | Add `initialPrompt` extraction to launchArgs.ts, auto-submit on app launch if present |
| **--help flag** | `codex --help` → prints help, exits | ❌ Missing (CLI) | P1 | launchArgs.ts (no `--help` parsing), but `/help` slash command exists in app | **Partial** — `/help` works in UI, but `codexa --help` fails | Add help/version arg parsing to launchArgs.ts; detect and exit before Ink render |
| **--version flag** | `codex --version` → prints version, exits | ❌ Missing (CLI) | P1 | APP_VERSION defined in settings.ts, but not CLI-exposed | **Partial** — Version available in /version command, not CLI flag | Add `--version` parsing, print APP_VERSION to stdout, exit(0) |
| **Reading repository files** | Auto-detects repo context, reads files | ✅ Implemented | P0 | codexLaunch.ts, codexExecArgs.ts (--cd passed, git repo check), workspaceRoot.ts | **Complete** — Codexa passes workspace root to Codex | None needed |
| **Editing files safely** | Codex applies edits; user approves if unsafe | ✓ Partial | P1 | workspaceGuard.ts (prevents outside workspace), workspaceActivity.ts (tracks changes), but approval delegated to Codex | **Partial** — Workspace guard prevents operations outside root; approval flow delegated to Codex CLI | Codex CLI handles; Codexa reflects; no action needed |
| **Running shell commands** | `!command` syntax or codex exec | ✅ Implemented | P0 | CommandRunner.ts, app.tsx (shell command handling), input sanitization | **Complete** — Shell commands execute, output captured | None needed |
| **Showing command activity** | Progress output visible | ✓ Partial | P1 | workspaceActivity.ts, TimelineEvent types, but real-time activity might lag | **Partial** — Activity tracked; UI updates on poll (400ms default) | Increase poll frequency or add real-time file watch; not critical |
| **Approval flow before risky changes** | UI prompts for dangerous operations | ✓ Delegated | P2 | codexExecArgs.ts (--ask-for-approval passed to Codex), but Codexa only sees final result | **Partial** — Approval happens in Codex CLI subprocess; Codexa cannot intercept mid-execution | Codexa subprocess would need real-time interaction with Codex; complex, lower priority |
| **Sandbox / permission behavior** | Respects --sandbox flag, writable roots | ✅ Implemented | P0 | workspaceGuard.ts, runtimeConfig.ts (AVAILABLE_SANDBOX_MODES, writable roots), --sandbox passed to codex | **Complete** — Strict path checking; operations outside workspace blocked | None needed |
| **Model selection** | `/model` command or --model flag | ✅ Implemented | P0 | ModelPicker.tsx, settings.ts (AVAILABLE_MODELS), codexExecArgs.ts (--model passed) | **Complete** — Picker UI, 4 models available | None needed |
| **Reasoning/effort selection** | `/reasoning` command or --reasoning flag | ✅ Implemented | P0 | ReasoningPicker.tsx, settings.ts (6 levels), codexExecArgs.ts (--config reasoning.effort=...) | **Complete** — Picker UI, 6 levels (none → xhigh) | None needed |
| **Config file support** | Reads from ~/.codex/config.toml | ✅ Implemented | P0 | layeredConfig.ts (resolves TOML), persistence.ts, README.md (documents TOML layering) | **Complete** — Layered TOML config: workspace → user → CLI overrides | None needed |
| **AGENTS.md / project instructions** | Auto-loads .codex/AGENTS.md, injects context | ❌ Missing | P1 | AGENTS.md exists but grep search for "AGENTS\|agents\.md\|project.*instruction\|loadAgents" in app.tsx returns NO matches | **Broken** — Project instructions not auto-injected; user must manually paste context | Implement: Read .codex/AGENTS.md on startup if exists; include in codex prompt |
| **Slash commands** | `/help`, `/model`, `/mode`, etc. | ✅ Implemented | P0 | handler.ts, 20+ slash commands implemented | **Complete** — Commands for auth, config, model, mode, etc. | None needed |
| **Session continuity / history** | Events persist across prompts; revisit previous turns | ✅ Implemented | P0 | chatLifecycle.ts (TimelineEvent types), persistence.ts (settings saved), MAX_VISIBLE_EVENTS=8, MAX_CHAT_LINES=2000 | **Complete** — Session history shown; events persisted (limited by MAX_VISIBLE_EVENTS) | None needed |
| **Diff display** | Shows file diffs before apply | ✓ Unknown | P1 | workspaceActivity.ts has diff generation (max 240 lines, 6 preview lines), but UI rendering not clearly evident | **Unknown** — Need runtime test to confirm diff UI rendering | Verify UI renders diffs; if missing, create simple diff panel |
| **Error recovery** | Handles failures, suggests fixes | ✓ Partial | P1 | Error event types, but recovery logic depends on Codex | **Partial** — Basic error display; recovery delegated to Codex | None needed at Codexa level |
| **Terminal resize handling** | TUI adapts to new dimensions | ✅ Implemented | P0 | src/index.tsx (resize event handler, 150ms debounce, recalculateLayout), terminalCapabilities.ts | **Complete** — UI redraws on resize | None needed |
| **Streaming responses** | Real-time output as it arrives | ✅ Implemented | P0 | codexSubprocess.ts (streamCodex), codexJsonStream.ts, response chunks displayed | **Complete** — Streaming works | None needed |
| **Keyboard shortcuts** | Standard terminal conventions (Ctrl+C, Shift+Tab, etc.) | ✓ Partial | P1 | focusFlow.test.tsx (bracketed paste, shift+tab, ctrl+o tested), but documentation missing | **Partial** — Shortcuts work; user discovery low | Document keyboard shortcuts in `/help` or UI |
| **Interrupt / cancel behavior** | Ctrl+C cancels active run | ✅ Implemented | P0 | src/index.tsx (SIGINT handler), src/app.tsx (cancelActiveRun), CommandRunner.ts (cancel function) | **Complete** — Ctrl+C works | None needed |
| **Git awareness** | Understands git repo structure, .gitignore | ✅ Implemented | P0 | codexLaunch.ts (--skip-git-repo-check passed to codex), workspaceRoot.ts (detects .git) | **Complete** — Git context passed to Codex | None needed |
| **Working directory awareness** | Operates in correct workspace | ✅ Implemented | P0 | bin/codexa.js (CODEX_WORKSPACE_ROOT set to cwd), codexExecArgs.ts (--cd passed), workspaceGuard.ts | **Complete** — All commands scoped to workspace | None needed |
| **Non-interactive / headless mode** | `echo "task" | codex` or script automation | ❌ Missing | P2 | src/index.tsx (TTY required: `stdin.isTTY && stdout.isTTY`), exits if false | **Broken** — TTY required; cannot use in pipes/headless | Implement headless mode: Detect TTY absence, fall back to non-UI JSON mode |
| **Proper exit behavior** | Exit codes reflect status (0=success, 1=error) | ✓ Partial | P1 | bin/codexa.js (forwards exit code), but TTY-required exit may confuse users | **Partial** — Exits correctly when UI runs; but pre-emptive exits on missing TTY may confuse scripting | Improve error message when TTY missing |
| **Help / version commands** | Help text available, version identifiable | ✓ Partial | P1 | `/help` slash command works, APP_VERSION defined, but `--help` / `--version` flags missing | **Partial** — Interactive help works; CLI flags don't | See "Initial prompt" and "--help/version" rows above |
| **Debug / logging modes** | `CODEXA_DEBUG_CODEX_LAUNCH=1` enables diagnostics | ✓ Partial | P2 | CODEXA_DEBUG_CODEX_LAUNCH env var checked in codexLaunch.ts, inputDebug.ts exists | **Partial** — Debug mode exists but sparse documentation | Document debug env vars in README |
| **Windows PowerShell behavior** | Works correctly on Windows Terminal, cmd, PowerShell | ✅ Implemented | P0 | bin/codexa.js (process.platform detection, bun.exe/bun.cmd resolution, mouse filter for Windows Terminal) | **Complete** — Windows support; Bun executable resolution | None needed |

---

## Biggest Missing Pieces (Ranked by Impact)

### 1. **Initial Prompt from CLI Arguments** (P0 — Blocks scripting & automation)
- **Impact**: Cannot automate Codexa; must be interactive
- **Evidence**: launchArgs.ts parses args but doesn't extract prompt; app.tsx never uses launchArgs for initial prompt
- **Why it matters**: Blocks use case: `codexa "refactor this function"`; forces interactive mode
- **Difficulty**: Low (1-2 hours) — Add prompt extraction to launchArgs, auto-submit on app start
- **Recommended fix**: 
  ```typescript
  // In launchArgs.ts: extract first positional arg as prompt
  const prompt = passthroughArgs[0] ?? null;
  // In app.tsx: if prompt exists, auto-submit as UserPromptEvent
  ```

### 2. **AGENTS.md / Project Instruction Loading** (P0 — Blocks context injection)
- **Impact**: Project-level AI instructions ignored; user must manually paste context
- **Evidence**: AGENTS.md file exists but no code in app.tsx searches for or loads it
- **Why it matters**: Codex CLI auto-injects project instructions; Codexa doesn't
- **Difficulty**: Medium (2-3 hours) — Add file read, parse, inject into prompt
- **Recommended fix**:
  ```typescript
  // In codexPrompt.ts or launchContext.ts
  const agentsPath = join(workspaceRoot, "AGENTS.md");
  if (existsSync(agentsPath)) {
    const agentsContent = readFileSync(agentsPath, "utf-8");
    // Prepend to prompt: "Project context:\n{agentsContent}\n\nUser request:\n{userPrompt}"
  }
  ```

### 3. **CLI Help / Version Flags** (P1 — Blocks discoverability)
- **Impact**: `codexa --help` and `codexa --version` don't work; user must launch UI to find help
- **Evidence**: launchArgs.ts doesn't parse --help or --version; only /help slash command works
- **Why it matters**: Standard CLI convention; users expect `--help` to work
- **Difficulty**: Low (1 hour) — Add arg parsing in launchArgs.ts or bin/codexa.js
- **Recommended fix**:
  ```typescript
  // In launchArgs.ts or bin/codexa.js
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(`codexa ${APP_VERSION}`);
    process.exit(0);
  }
  ```

### 4. **Non-Interactive / Headless Mode** (P2 — Blocks scripting in CI/CD)
- **Impact**: Cannot pipe input or use in scripts; TTY required
- **Evidence**: src/index.tsx checks `stdin.isTTY && stdout.isTTY`; exits if false
- **Why it matters**: Users cannot use Codexa in CI/CD pipelines or shell pipes
- **Difficulty**: High (4-6 hours) — Requires fallback to JSON/non-UI mode
- **Recommended fix**: Detect TTY absence; fall back to headless mode that reads from stdin, outputs JSON, exits

### 5. **Real-Time Approval Interception** (P2 — Blocks approval UX improvement)
- **Impact**: Approval prompts surface in Codex subprocess, not Codexa UI
- **Evidence**: codexExecArgs.ts passes `--ask-for-approval` to Codex; Codexa subprocess can't intercept mid-execution
- **Why it matters**: Approval UX could be better integrated into TUI
- **Difficulty**: Very High (8+ hours) — Requires real-time subprocess interaction
- **Recommended fix**: Use JSON streaming mode to detect approval requests; render approval UI in Codexa; resume subprocess

### 6. **Diff Viewer UI Rendering** (P1 — UX gap)
- **Impact**: Diffs computed internally but unclear if rendered to user
- **Evidence**: workspaceActivity.ts computes diffs (max 240 lines, 6 preview lines); no clear UI component found
- **Why it matters**: User should see file changes before apply
- **Difficulty**: Medium (2-3 hours) — Create FileDiffPanel or enhance timeline display
- **Recommended fix**: Add `<DiffPanel event={event} />` component to render diffs in timeline

### 7. **Keyboard Shortcuts Documentation** (P2 — UX gap)
- **Impact**: Users don't discover available shortcuts (Shift+Tab, Ctrl+O, etc.)
- **Evidence**: focusFlow.test.tsx shows shortcuts exist but not documented
- **Why it matters**: Improves UX and productivity
- **Difficulty**: Low (30 mins) — Document in README or `/help` output
- **Recommended fix**: Add shortcut table to `/help` output and README

### 8. **Debug Logging Documentation** (P2 — Ops gap)
- **Impact**: Debug env vars exist but not documented
- **Evidence**: CODEXA_DEBUG_CODEX_LAUNCH env var exists but not in README
- **Why it matters**: Users debugging issues can't find debug mode
- **Difficulty**: Low (15 mins) — Document in README
- **Recommended fix**: Add debug env vars section to README

### 9. **Activity Polling Frequency** (P3 — Perf tuning)
- **Impact**: File activity updates lag up to 400ms (default poll interval)
- **Evidence**: workspaceActivity.ts has `pollIntervalMs = 400`
- **Why it matters**: Real-time activity display might seem sluggish
- **Difficulty**: Low (15 mins) — Adjust constant; verify performance
- **Recommended fix**: Consider reducing to 100-200ms or add file watcher

### 10. **Approval Policy & Sandbox Mode Discovery** (P2 — Discoverability)
- **Impact**: Users don't know sandbox modes exist or how to toggle them
- **Evidence**: runtimeConfig.ts defines policies but no UI tour or `/sandbox` slash command visible
- **Why it matters**: Advanced safety features are hidden
- **Difficulty**: Low (1 hour) — Add `/sandbox` and `/approval` slash commands with help
- **Recommended fix**: Add `/sandbox` and `/approval` commands with visible picker UI

---

## Broken or Risky Behavior

### 1. **TTY-Requirement Exit is Confusing**
- **Situation**: User pipes input to Codexa; app exits without explanation
- **Evidence**: src/index.tsx exits if TTY check fails; error message minimal
- **Risk**: Silent failure; user thinks app is broken
- **Recommendation**: Improve error message; suggest headless mode as alternative

### 2. **Workspace Guard Path Violations Not Always User-Friendly**
- **Situation**: User tries to edit file outside workspace; gets blocked
- **Evidence**: workspaceGuard.ts blocks operations; message should list violations clearly
- **Risk**: User confusion about what paths are allowed
- **Recommendation**: Improve error message in getPromptWorkspaceGuardMessage() to list allowed roots clearly

### 3. **Session History Truncation Not Obvious**
- **Situation**: Old events disappear when MAX_VISIBLE_EVENTS exceeded; user doesn't know why
- **Evidence**: chatLifecycle.ts truncates silently
- **Risk**: User might think data is lost
- **Recommendation**: Show message when events truncated (e.g., "Earlier events hidden")

### 4. **Auth Failure Only Detected Post-Run**
- **Situation**: User runs task with expired auth; gets failure halfway through
- **Evidence**: codexAuth.ts probes auth but Codexa only detects failure in final output
- **Risk**: Wasted computation; could be gated beforehand
- **Recommendation**: Add auth gate before run; warn if auth unknown

### 5. **Mouse Input Filter Might Lose Input in Edge Cases**
- **Situation**: bin/codexa.js has mouse filter that buffers incomplete sequences; could drop input if timeout
- **Evidence**: createMouseFilter() times out after 50ms; incomplete sequences might be discarded
- **Risk**: Input loss in high-latency scenarios
- **Recommendation**: Test edge cases; increase timeout if needed

---

## UI/UX Gaps

1. **No Inline Diffs** — File changes shown in text, not diff format
2. **No Approval UI** — Approval prompts from Codex not intercepted; surface in subprocess output
3. **No Keyboard Shortcut Help** — `/help` should list shortcuts (Shift+Tab, Ctrl+O, etc.)
4. **No Activity Rate Indicator** — File poll lag (400ms) not visible to user
5. **No Debug Mode Toggle** — Debug mode env var exists but no UI toggle
6. **No Sandbox Mode UI** — Sandbox/approval policies not visible in main UI
7. **Workspace Picker Missing** — No UI to see/change workspace; only `/workspace relaunch`
8. **Config Summary Incomplete** — No UI to see currently applied config (layered from TOML + CLI)

---

## Agent Capability Gaps

1. **AGENTS.md Not Loaded** — Project instructions not injected into prompts
2. **Project Context Missing** — No auto-detection of .codex/config.toml or .codex/project-context.md
3. **Workspace Relaunch Complex** — Requires `/workspace relaunch <path>` command; should be easier to discover
4. **Model Capabilities Cache** — Model specs cached in ~/.codexa-model-specs.json but not visible to user

---

## CLI / Config Gaps

1. **No --help Flag** — `codexa --help` doesn't work (only `/help` command)
2. **No --version Flag** — `codexa --version` doesn't work
3. **No Initial Prompt Arg** — `codexa "my task"` not supported
4. **Config Discovery Unclear** — README mentions `.codex/config.toml` but users might not know where it is
5. **Profile Selection Not Obvious** — `--profile` flag exists but undiscovered
6. **No Config Validate Command** — No way to check if config is valid

---

## Windows-Specific Gaps

1. **Mouse Filter Complexity** — bin/codexa.js mouse filter might not handle all terminal emulators (ConEmu, Windows Terminal, Terminal Preview)
2. **Path Handling in Errors** — Backslashes in paths might not render cleanly in error messages
3. **Bun Executable Discovery** — Resolves bun.exe correctly but doesn't handle custom PATH scenarios clearly

---

## Recommended Implementation Order

### Phase 1: P0 Blockers (Achieve 80%+ Parity) — 1-2 weeks
1. **Initial prompt from CLI args** (Effort: 1-2h)
   - Extract first positional arg as prompt
   - Auto-submit on app launch
   - Test: `codexa "explain this repo"`

2. **AGENTS.md loading** (Effort: 2-3h)
   - Read .codex/AGENTS.md if exists
   - Inject into codex prompt
   - Test: Create .codex/AGENTS.md with instructions; verify injection

3. **CLI help/version flags** (Effort: 1h)
   - Add arg parsing before Ink render
   - Print help/version, exit
   - Test: `codexa --help`, `codexa --version`

4. **Improve TTY error message** (Effort: 30m)
   - Better error text when TTY missing
   - Suggest workarounds

### Phase 2: P1 High-Impact (Achieve 85%+ Parity) — 1-2 weeks
1. **Diff viewer UI** (Effort: 2-3h)
   - Render diffs in timeline or panel
   - Test: Run task that edits files; verify diff display

2. **Keyboard shortcuts documentation** (Effort: 30m)
   - Add to `/help` output and README
   - Test: `/help` shows shortcuts

3. **Sandbox / approval UI commands** (Effort: 1-2h)
   - Add `/sandbox` and `/approval` picker commands
   - Test: Toggle modes; verify apply

4. **Better workspace guard messages** (Effort: 1h)
   - List allowed roots clearly
   - Test: Try to access outside workspace; verify message

### Phase 3: P2 Polish (Achieve 90%+ Parity) — 1 week
1. **Non-interactive / headless mode** (Effort: 4-6h)
   - Detect TTY absence
   - Fall back to JSON mode
   - Test: `echo "task" | codexa`

2. **Activity UI improvements** (Effort: 1-2h)
   - Show truncation message
   - Optional file watcher
   - Test: Watch file activity display

3. **Debug logging documentation** (Effort: 15m)
   - Document env vars
   - Add examples

4. **Config summary UI** (Effort: 2-3h)
   - Show current config (TOML + CLI overrides)
   - Test: `/config show` command

### Phase 4: P3 Nice-to-Have (Achieve 95%+ Parity) — Future
1. **Real-time approval interception** (Effort: 8+h)
   - Detect approval requests mid-execution
   - Render approval UI in TUI
   - Resume subprocess
   - Test: Interactive approval flow

2. **Workspace picker UI** (Effort: 2-3h)
   - Show available workspaces
   - Quick switch UI
   - Test: Discover and switch workspaces

3. **Profile management UI** (Effort: 2-3h)
   - Show available profiles
   - Save/load profiles from UI
   - Test: Create and load profiles

---

## Test Checklist

### Manual Testing (CLI Verification)
- [ ] `codexa --help` → Shows help text and exits
- [ ] `codexa --version` → Shows version and exits
- [ ] `codexa "explain this repo"` → Accepts initial prompt, processes, exits
- [ ] `codexa` in repo root → Launches interactive mode with workspace detected
- [ ] `codexa` in non-repo folder → Launches interactive mode, workspace is cwd
- [ ] `codexa --profile dev` → Loads dev profile from config
- [ ] `codexa --config model="gpt-5.4"` → CLI override applied
- [ ] Ctrl+C during run → Cancels cleanly, no zombie processes
- [ ] Terminal resize → UI redraws correctly
- [ ] `echo "task" | codexa` (Windows/Linux) → Works or fails gracefully

### Feature Testing (Interactive Mode)
- [ ] `/help` → Shows help text with shortcuts listed
- [ ] `/model` → Opens model picker, can select model
- [ ] `/mode` → Opens mode picker, can select mode
- [ ] `/reasoning` → Opens reasoning picker, can select level
- [ ] `/sandbox` → Opens sandbox mode picker (after implementation)
- [ ] `/approval` → Opens approval policy picker (after implementation)
- [ ] `/auth status` → Shows auth state
- [ ] `/login` → Shows login instructions
- [ ] `/workspace relaunch <path>` → Switches workspace, relaunches

### File Operations Testing
- [ ] Run task that edits files → Files modified correctly
- [ ] Try to edit file outside workspace → Blocked with clear message
- [ ] Run task in git repo → Git context visible in prompts
- [ ] `.codex/config.toml` loaded → CLI settings reflect TOML
- [ ] `.codex/AGENTS.md` loaded (after implementation) → Instructions injected

### Windows-Specific Testing
- [ ] PowerShell: `codexa` → Launches correctly
- [ ] PowerShell: `codexa --help` → Works (after implementation)
- [ ] cmd.exe: `codexa` → Launches correctly
- [ ] Terminal resize in Windows Terminal → UI adapts
- [ ] Mouse clicks in Windows Terminal → Not captured (filter works)

### Error Handling Testing
- [ ] Missing Bun → Clear error message
- [ ] Missing Codex → Clear error message
- [ ] Invalid config → Clear error, falls back to defaults
- [ ] Auth failure → Detected, suggests login
- [ ] TTY missing (headless) → Good error or headless mode (after implementation)

### Streaming & Performance Testing
- [ ] Long-running task → Streaming output visible in real-time
- [ ] Large file edits → Output not truncated unexpectedly
- [ ] High activity (many files) → Poll lag not noticeable

---

## Summary Table: Gap Severity & Effort

| Gap | Severity | Effort | Estimated Fix Time | Phase |
|---|---|---|---|---|
| Initial prompt arg | P0 | Low | 1-2h | Phase 1 |
| AGENTS.md loading | P0 | Low | 2-3h | Phase 1 |
| --help/--version flags | P1 | Low | 1h | Phase 1 |
| Diff viewer UI | P1 | Medium | 2-3h | Phase 2 |
| Headless mode | P2 | High | 4-6h | Phase 3 |
| Approval UI | P3 | Very High | 8+h | Phase 4 |
| Documentation | P1-P2 | Low | 1-2h | Phase 1-2 |

---

## Conclusion

Codexa is a **solid, well-architected interactive terminal UI** for Codex-based tasks. It excels at:
- Interactive coding workflows
- Real-time streaming responses
- Terminal-native UI polish (resize, signals, keyboard)
- Sandbox/workspace safety
- Multi-model and reasoning level support

It falls short in:
- CLI discoverability (--help, --version)
- Project context injection (AGENTS.md)
- Scriptability (initial prompt, headless mode)
- Advanced approval workflows

**To achieve 85%+ parity**, implement Phase 1 + Phase 2 gaps (3-4 weeks). Phase 3-4 are cosmetic/advanced and can follow based on user feedback.

---

*Audit conducted via comprehensive source analysis and architecture mapping. All evidence cited with file/function references. Conservative assessment: features marked "Unknown" if not clearly evident in code.*
