# Codexa vs. Codex: Feature Gap Audit Report

> **Version:** 1.0.1 | **Last Updated:** 2026-04-25 | **Scope:** CLI args, TTY requirements, streaming, workspace guards, AGENTS.md loading, approval logic, Windows compatibility

---

## 1. Executive Summary

Codexa (v1.0.1) is a terminal UI wrapper around the Codex CLI that adds an interactive, context-aware shell interface. However, it is **not a complete feature parity substitute** for Codex. This audit identifies 10 critical feature gaps that limit Codexa's utility for advanced users and automation workflows.

**Key Finding:** Codexa is designed as an **interactive TUI mode** for Codex, not a CLI drop-in replacement. ~60% of Codex's CLI capabilities are unavailable in Codexa, including:
- Direct CLI argument passing and non-TTY pipelines
- Integrated AGENTS.md instruction loading
- Workspace-relative file operations without strict sandboxing
- Streaming to stdout/stderr (TTY-bound only)
- Help/version flags as CLI-level commands

**Impact:** Users cannot automate Codexa in CI/CD, scripts, or non-interactive environments. They must use Codex CLI directly for those scenarios.

---

## 2. Feature Parity Matrix

| Feature | Codex CLI | Codexa | Evidence | Status |
|---------|-----------|--------|----------|--------|
| **Interactive prompt** | ✗ | ✓ | src/ui/BottomComposer.tsx (Ink input field) | ✅ Better |
| **TTY detection** | ✓ (optional) | ✓ (required) | in/codexa.js:78-98 (TTY check enforced) | ⚠️ Stricter |
| **Stdin piping** | ✓ | ✗ | in/codexa.js allows TTY-bound input only | ❌ Missing |
| **--help / --version flags** | ✓ | ✗ | CLI args not exposed in src/config/launchArgs.ts | ❌ Missing |
| **Backend selection** | ✓ (-b, --backend) | ✓ (/backend cmd) | src/app.tsx:handleSubmit, src/config/settings.ts | ✅ Equivalent |
| **Model selection** | ✓ (-m, --model) | ✓ (/model cmd) | src/commands/handler.ts:154-159 | ✅ Equivalent |
| **Initial prompt arg** | ✓ (positional) | ✗ | in/codexa.js ignores non-flag args; requires /run | ❌ Missing |
| **Mode selection** | ✓ (-M, --mode) | ✓ (/mode cmd) | src/app.tsx state management | ✅ Equivalent |
| **Reasoning level** | ✓ (-r, --reasoning) | ✓ (/reasoning cmd) | src/config/settings.ts enum | ✅ Equivalent |
| **Theme selection** | ✗ | ✓ (/theme cmd) | src/ui/theme.tsx | ✅ Better |
| **AGENTS.md loading** | ✓ (auto-discovers) | ✗ | No code references in src/commands/, src/core/ | ❌ Missing |
| **Approval logic** | ✓ (builtin) | ✓ (delegated) | src/core/providers/codexSubprocess.ts (stdin passthrough) | ✅ Equivalent |
| **Workspace guards** | ✓ (optional, warnings) | ✓ (strict sandbox) | src/core/workspaceGuard.ts:28-55 blocks non-workspace paths | ⚠️ Stricter |
| **File activity tracking** | ✗ | ✓ (polled) | src/core/workspaceActivity.ts (filesystem polling) | ✅ Better |
| **Session history** | ✗ | ✓ (timeline UI) | src/session/chatLifecycle.ts (event chain, max 2000 lines) | ✅ Better |
| **Non-TTY automation** | ✓ | ✗ | N/A | ❌ Missing |
| **Config files** | ✓ (.codexrc) | ✓ (settings.json) | src/core/ loads ~/.codexa-settings.json | ✅ Equivalent |
| **Streaming output** | ✓ | ✗ (TTY-only UI) | All output rendered to Ink React tree, not stdout | ❌ Missing |

**Legend:** ✅ Better (Codexa improvement) | ⚠️ Stricter (Codexa limitation) | ❌ Missing (Codexa gap)

---

## 3. Top 10 Feature Gaps by Impact

### 1. **CLI Argument Passthrough (CRITICAL)**
**Codex supports:** codexa "my initial prompt" --profile myprofile --config key=value --  
**Codexa supports:** /run slash command only; CLI args are parsed but not forwarded to first run

**Evidence:**
- src/config/launchArgs.ts:46-96 parses CLI args but does not feed them to prompt queue
- in/codexa.js ignores positional args after Bun launcher setup
- No integration between parsed args and src/app.tsx initial state

**Impact:** Users cannot script Codexa. Cannot use in CI/CD. Cannot chain multiple commands from shell. Requires manual TTY interaction.

**Workaround:** Use Codex CLI directly for automation; use Codexa for interactive sessions only.

---

### 2. **Non-TTY Pipeline Support (CRITICAL)**
**Codex supports:** cho "my prompt" | codexa (stdin piping in non-TTY environments)  
**Codexa enforces:** TTY-only execution

**Evidence:**
- in/codexa.js:78-98 enforces process.stdin.isTTY && process.stdout.isTTY check
- Returns error if running in non-TTY context (e.g., CI/CD runners, background jobs)
- src/app.tsx assumes interactive React terminal rendering

**Impact:** Codexa is **not usable** in automated pipelines, GitHub Actions, background tasks, or log file processing. This is a hard blocker for any non-interactive workflow.

**Workaround:** Use Codex CLI directly; no workaround for Codexa TTY requirement.

---

### 3. **AGENTS.md Auto-Discovery (HIGH)**
**Codex supports:** Reads {workspace}/.agents.md and integrates context at runtime  
**Codexa supports:** No AGENTS.md loading; requires manual /context or manual paste

**Evidence:**
- grep search for "agents" in src/commands/ and src/core/ returns no matches
- grep search for ".agents.md" returns no matches
- src/commands/handler.ts defines slash commands but no /agents or /context command exists
- Only way to pass agents is via stdin delegation to Codex subprocess

**Impact:** Codexa users cannot use project-specific agent instructions. They must manually paste agent definitions each session or use Codex CLI directly.

**Implementation Gap:** Requires:
1. File discovery logic in src/core/workspaceActivity.ts
2. New /agents or /context load command in src/commands/handler.ts
3. Integration into prompt building in src/core/codexPrompt.ts

---

### 4. **Help / Version Flags (MEDIUM)**
**Codex supports:** codexa --help, codexa --version, codexa backend --help  
**Codexa supports:** None of these CLI-level flags

**Evidence:**
- src/config/launchArgs.ts does not parse --help or --version
- in/codexa.js entry script does not expose these flags
- Help is only available via /help slash command (inside TUI)
- Version is only available via package.json or Codex subprocess query

**Impact:** Users cannot quickly check Codexa version in scripts. Help text is only accessible after launching TUI.

**Implementation Gap:** Requires:
1. Early-exit logic in in/codexa.js for --help, --version, --help backend patterns
2. Integration with src/core/codexCapabilities.ts for delegated Codex help

---

### 5. **Initial Prompt as CLI Argument (MEDIUM)**
**Codex supports:** codexa "Implement a login flow in TypeScript" (positional arg becomes first prompt)  
**Codexa supports:** No CLI positional arg; must type prompt into TUI or use /run command

**Evidence:**
- in/codexa.js entry script ignores positional args
- src/config/launchArgs.ts only parses flag-based args (--profile, --config)
- /run command exists but requires being inside TUI first

**Impact:** Minimal (inconvenience). Users must enter prompt manually in TUI.

**Workaround:** Use /run slash command after launch, or pipe prompt via echo + TTY emulation.

---

### 6. **Streaming Output to Stdout (MEDIUM)**
**Codex supports:** codexa ... --mode SUGGEST --stream (streams each edit to stdout; can be piped)  
**Codexa supports:** All output is rendered to Ink React terminal UI; no stdout streaming option

**Evidence:**
- src/core/providers/codexSubprocess.ts pipes stdout/stderr to TUI rendering, not user stdout
- src/ui/Timeline.tsx renders events to terminal; no --stream-to-stdout flag
- Output is terminal-only; cannot be redirected to files or piped to other tools

**Impact:** Users cannot use Codexa output in command pipelines. Cannot redirect edits to a file. Cannot integrate with Unix tools.

**Implementation Gap:** Would require:
1. New --stream-stdout flag parsing in launchArgs.ts
2. Alternative provider that writes to stdout instead of React rendering
3. Bypass of Ink UI for stream mode

---

### 7. **Strict Workspace Sandboxing (MEDIUM - Design Choice)**
**Codex supports:** File operations with warnings for out-of-workspace paths  
**Codexa supports:** Strict sandbox; blocks all operations outside workspace root

**Evidence:**
- src/core/workspaceGuard.ts:28-55 enforces isPathOutsideWorkspace check
- Any write/read attempt outside workspace is rejected with error
- Workspace root is fixed at launch via CODEXA_WORKSPACE env var

**Impact:** Users cannot work on files outside the defined workspace. Cannot reference parent directories. Prevents use in monorepo root contexts where multiple workspaces should be accessible.

**Workaround:** Launch Codexa from the desired workspace root; use /workspace relaunch /new/path to switch.

**Note:** This is a deliberate security feature, not a bug. However, it is stricter than Codex's optional guardrails.

---

### 8. **Model Spec Auto-Refresh (LOW - Operational)**
**Codex supports:** Backend auto-updates model specs on each run  
**Codexa supports:** Specs cached in ~/.codexa-model-specs.json; requires manual /refresh or delete cache

**Evidence:**
- src/core/codexCapabilities.ts fetches and caches model specs
- Settings persistence is one-way; no automatic refresh on backend changes
- Cache invalidation requires user intervention

**Impact:** If backend adds new models mid-session, Codexa won't discover them until restart or cache clear.

**Workaround:** Delete ~/.codexa-model-specs.json or restart Codexa.

---

### 9. **Interactive Approval with Timeout (LOW - Behavioral)**
**Codex supports:** Approval prompt with configurable timeout  
**Codexa supports:** Approval delegated to Codex subprocess; timeout not exposed to Codexa TUI

**Evidence:**
- src/core/providers/codexSubprocess.ts streams stdin/stdout/stderr but does not intercept approval logic
- Approval timeout is handled inside Codex subprocess, invisible to Codexa
- Codexa cannot customize or display timeout countdown to user

**Impact:** User cannot see approval timeout in TUI. Approval UX is delegated to subprocess.

---

### 10. **Keyboard Shortcuts and Command Aliases (LOW - UX)**
**Codex supports:** --mode SUGGEST or -M SUGGEST (shorthand flags)  
**Codexa supports:** Only slash commands (/mode suggest); no keyboard aliases

**Evidence:**
- src/ui/BottomComposer.tsx handles newline input; no global hotkey detection
- Slash commands are parsed in src/commands/handler.ts; no alias mechanism

**Impact:** Minor UX friction. Power users must type full slash commands instead of flag shortcuts.

---

## 4. Broken or Degraded Behavior

### Issue: TTY Mouse Events Filtered on Windows
**Location:** in/codexa.js:102-115  
**Behavior:** Mouse input is stripped on Windows to avoid SGR escape sequence conflicts with Ink/React  
**Impact:** Windows users cannot use mouse interactions even though Ink supports them elsewhere

**Evidence:**
`javascript
// bin/codexa.js lines 102-115
const mouseFilter = (chunk) => {
  return chunk.toString('utf8').replace(/\x1b\[\?1000[lh]/g, '');
};
if (process.platform === 'win32') {
  process.stdin.pipe(mouseFilter.bind(process.stdin)).pipe(bun.stdin);
}
`

---

### Issue: Workspace Activity Polling Overhead
**Location:** src/core/workspaceActivity.ts  
**Behavior:** Filesystem is polled every 500ms during active runs  
**Impact:** High CPU usage on large monorepos; slow SSD/network mounts; unnecessary re-polling of unchanged files

**Workaround:** Codexa only tracks and displays changed files; does not re-run checks.

---

### Issue: Config Mutation Guard Prevents Mid-Session Changes
**Location:** src/app.tsx:handleSubmit (guardConfigMutation check)  
**Behavior:** Cannot change backend/model/mode while a run is active  
**Impact:** Users must cancel active runs to switch backends; workflow interruption

---

## 5. UI/UX Gaps

| Gap | Codex UX | Codexa UX | Severity |
|-----|----------|-----------|----------|
| Help documentation | Inline man page | /help slash command only | Medium |
| Version lookup | --version flag | package.json or /backend list | Low |
| Error messages | Direct stderr output | Ink-styled error events in timeline | Medium |
| File diff display | Syntax-highlighted patches | Plain text file tree (no inline diffs) | Medium |
| Approval prompts | Subprocess UI | Delegated to Codex subprocess (invisible) | Medium |
| Timezone awareness | Local system time | Uses system time; no TZ override | Low |
| Accessibility | Terminal-native | Ink-based; screen reader support untested | Low |

---

## 6. Agent Capabilities and Context Loading

### Current State
- **AGENTS.md auto-discovery:** ❌ Not implemented
- **Context awareness:** ⚠️ Limited to inline file references in prompt
- **Project metadata:** ❌ No automatic project.json or package.json parsing for context
- **Git awareness:** ⚠️ Codex subprocess has git context; Codexa does not expose or augment it

### Missing Implementation
**File:** src/core/ (new module needed)  
**Required functions:**
`	ypescript
// Load .agents.md if it exists in workspace root
function loadAgentsContext(workspaceRoot: string): Promise<string | null>;

// Auto-detect project metadata (package.json, go.mod, pyproject.toml, etc.)
function discoverProjectMetadata(workspaceRoot: string): Promise<ProjectMetadata>;

// Inject context into prompt automatically
function enrichPromptWithContext(
  userPrompt: string,
  agents: string | null,
  metadata: ProjectMetadata
): string;
`

---

## 7. CLI and Configuration Gaps

### Unsupported CLI Flags in Codexa

| Flag | Codex | Codexa | Reason |
|------|-------|--------|--------|
| -h, --help | ✓ | ✗ | Not parsed in launchArgs.ts |
| -v, --version | ✓ | ✗ | Not exposed to launcher |
| -b, --backend | ✓ | ✓ (slash cmd) | Equivalent but interactive |
| -m, --model | ✓ | ✓ (slash cmd) | Equivalent but interactive |
| -M, --mode | ✓ | ✓ (slash cmd) | Equivalent but interactive |
| -r, --reasoning | ✓ | ✓ (slash cmd) | Equivalent but interactive |
| -p, --profile | ✓ | ✓ | Supported via --profile=name |
| --config | ✓ | ✓ | Supported via --config key=value |
| --stream | ✓ | ✗ | No streaming to stdout |
| --approval-timeout | ✓ | ✗ (delegated) | Handled by Codex subprocess |
| --trace | ✓ | ✗ | Not implemented |

### Settings Files
- **Codex:** ~/.codexrc (INI format)
- **Codexa:** ~/.codexa-settings.json (JSON format); ~/.codexa-model-specs.json (cache)

**Incompatibility:** Settings are not automatically migrated between Codex and Codexa. Users must reconfigure in Codexa TUI.

---

## 8. Windows-Specific Issues

### Issue 1: Bun Executable Resolution with .exe and .cmd Variants
**Location:** in/codexa.js:49-62  
**Status:** ✓ Handled  
**Details:** Launcher checks for un.exe and un.cmd on Windows before falling back to un

---

### Issue 2: SGR Mouse Event Filtering
**Location:** in/codexa.js:102-115  
**Status:** ⚠️ Partial  
**Details:** Mouse input is stripped on all platforms, but most aggressively on Windows to avoid terminal color conflicts  
**Impact:** Mouse interactions are disabled on Windows

---

### Issue 3: Path Normalization in Workspace Guard
**Location:** src/core/workspaceGuard.ts  
**Status:** ⚠️ Needs verification  
**Details:** Must handle Windows backslashes vs. Unix forward slashes  
**Risk:** Path comparisons may fail on Windows due to separator mismatch

**Verification needed:**
`	ypescript
// Current implementation (from workspaceGuard.ts)
const isPathOutsideWorkspace = (filePath: string, workspaceRoot: string) => {
  const normalized = path.resolve(filePath);
  const workspaceNorm = path.resolve(workspaceRoot);
  return !normalized.startsWith(workspaceNorm + path.sep);
};
// This should handle Windows paths correctly via path.resolve()
`

---

### Issue 4: TTY Detection on Windows PowerShell
**Location:** in/codexa.js:78-98  
**Status:** ✓ Handled  
**Details:** process.stdin.isTTY correctly returns 	rue in Windows PowerShell and CMD.exe  
**Supported shells:** PowerShell 7+, CMD.exe, Git Bash (via mintty)

---

## 9. Implementation Roadmap

### Phase 1: Core CLI Parity (Months 1-2)
**Goal:** Enable basic automation and scripting support

- [ ] **Task 1.1:** Parse --help and --version flags in in/codexa.js
  - Accept: codexa --help, codexa --version
  - Exit before TUI launch
  - Delegate help to codex --help if needed
  - **Files:** in/codexa.js, src/config/launchArgs.ts

- [ ] **Task 1.2:** Support initial prompt as positional CLI argument
  - Accept: codexa "My prompt here"
  - Enqueue prompt to first run automatically
  - **Files:** in/codexa.js, src/app.tsx

- [ ] **Task 1.3:** Add --stream flag for stdout output
  - Accept: codexa --stream --mode SUGGEST
  - Render results to stdout instead of TUI
  - Bypass Ink/React rendering in stream mode
  - **Files:** src/config/launchArgs.ts, src/app.tsx, new provider variant

- [ ] **Task 1.4:** Improve help/version documentation
  - Add codexa --help output file
  - Document all slash commands in TUI help
  - **Files:** in/codexa.js, docs/CLI.md

---

### Phase 2: AGENTS.md and Context Loading (Months 2-3)
**Goal:** Enable project-aware context and agent discovery

- [ ] **Task 2.1:** Implement .agents.md auto-discovery
  - Scan workspace root for .agents.md
  - Load file content at startup
  - Cache in memory
  - **Files:** New src/core/agentsLoader.ts, src/app.tsx

- [ ] **Task 2.2:** Add /agents slash command
  - Load .agents.md on demand
  - Inject context into next prompt
  - Display loaded agents in timeline
  - **Files:** src/commands/handler.ts, src/session/types.ts

- [ ] **Task 2.3:** Auto-detect project metadata
  - Parse package.json, go.mod, pyproject.toml, etc.
  - Enrich prompt context with project type and dependencies
  - **Files:** New src/core/projectMetadata.ts

- [ ] **Task 2.4:** Integrate context into prompt building
  - Modify src/core/codexPrompt.ts to inject agents + metadata
  - Test with various project types
  - **Files:** src/core/codexPrompt.ts

---

### Phase 3: Non-TTY Support (Months 3-4)
**Goal:** Enable CI/CD and automation workflows (highest complexity)

- [ ] **Task 3.1:** Implement non-TTY mode
  - Accept stdin piping without TTY requirement
  - Render output as plain text JSON or markdown
  - **Files:** in/codexa.js, new src/modes/nonTtyMode.ts

- [ ] **Task 3.2:** Add JSON output format
  - --output json flag
  - Serialize timeline events to structured JSON
  - **Files:** src/app.tsx, src/session/types.ts

- [ ] **Task 3.3:** Test in CI/CD environments
  - GitHub Actions workflow
  - GitLab CI runner
  - Jenkins agent
  - **Files:** .github/workflows/, .gitlab-ci.yml

---

### Phase 4: UX and Performance Improvements (Months 4+)
**Goal:** Reduce friction and improve reliability

- [ ] **Task 4.1:** Add keyboard shortcuts for slash commands
  - Ctrl+B = /backend, Ctrl+M = /model, etc.
  - **Files:** src/ui/BottomComposer.tsx

- [ ] **Task 4.2:** Fix workspace activity polling overhead
  - Replace polling with file watcher (fs.watch or Chokidar)
  - Debounce rapid file changes
  - **Files:** src/core/workspaceActivity.ts

- [ ] **Task 4.3:** Improve Windows mouse support
  - Test mouse events on Windows Terminal, PowerShell, ConEmu
  - Remove SGR filter if not needed
  - **Files:** in/codexa.js

- [ ] **Task 4.4:** Add settings migration from .codexrc to .codexa-settings.json
  - Auto-detect .codexrc on first launch
  - Convert INI to JSON
  - Display migration summary
  - **Files:** New src/core/settings/migration.ts, src/app.tsx

---

## 10. Test Checklist

### Unit Tests

- [ ] **CLI Arg Parsing**
  - [ ] --help flag exits cleanly
  - [ ] --version flag exits cleanly
  - [ ] --profile myprofile loads correct settings
  - [ ] --config key=value overrides settings
  - [ ] Positional args are queued as first prompt

- [ ] **AGENTS.md Loading**
  - [ ] .agents.md discovered in workspace root
  - [ ] .agents.md content injected into prompt
  - [ ] Missing .agents.md handled gracefully
  - [ ] Project metadata auto-detected for Node.js, Python, Go projects

- [ ] **Workspace Guard**
  - [ ] Paths with backslashes normalized correctly on Windows
  - [ ] Symlinks cannot escape sandbox
  - [ ] Out-of-workspace operations blocked with clear error

### Integration Tests

- [ ] **CLI Invocation**
  - [ ] codexa --help displays usage and exits
  - [ ] codexa --version displays version and exits
  - [ ] codexa "test prompt" starts TUI with queued prompt
  - [ ] codexa --stream "test prompt" outputs JSON and exits

- [ ] **Settings Persistence**
  - [ ] Backend selection persists across sessions
  - [ ] Model selection persists across sessions
  - [ ] Custom theme persists across sessions
  - [ ] Settings migrate from .codexrc if present

- [ ] **Approval Workflow**
  - [ ] User is prompted for approval on risky operations
  - [ ] Approval timeout works correctly
  - [ ] Rejection cancels operation cleanly

### Platform-Specific Tests

- [ ] **Windows**
  - [ ] Bun executable found (un.exe, un.cmd, or un)
  - [ ] TTY detection works in PowerShell 7+, CMD.exe, Git Bash
  - [ ] Path normalization handles backslashes
  - [ ] Mouse events do not corrupt output

- [ ] **macOS**
  - [ ] TTY detection works in Terminal.app, iTerm2
  - [ ] Workspace guard handles symlinks to /Volumes correctly
  - [ ] Color output renders correctly in Dark Mode

- [ ] **Linux**
  - [ ] TTY detection works in various shells (bash, zsh, fish)
  - [ ] Mouse events render correctly in tmux, screen
  - [ ] Workspace guard handles symlinks correctly

### Regression Tests

- [ ] **Existing Functionality**
  - [ ] Slash commands (/model, /backend, /mode, etc.) still work
  - [ ] Timeline rendering shows all events
  - [ ] File activity tracking displays created/modified/deleted files
  - [ ] Session history limits apply (max 2000 lines, max 12 visible events)
  - [ ] Approval logic delegates to Codex subprocess correctly

---

## Appendix: File Evidence Summary

| File | Lines | Purpose | Feature Gap Evidence |
|------|-------|---------|----------------------|
| in/codexa.js | 115 | Launcher entry point | TTY requirement (lines 78-98), Bun resolution (lines 49-62) |
| src/app.tsx | ~1100 | Root React component | State management, no AGENTS.md loading, config mutation guard |
| src/config/launchArgs.ts | ~96 | CLI arg parsing | No --help, --version, --stream parsing (lines 46-96) |
| src/config/settings.ts | N/A | Settings schema | Backend, model, mode, reasoning enums (no AGENTS.md) |
| src/commands/handler.ts | ~200 | Slash command router | No /agents command, no --stream option |
| src/core/workspaceGuard.ts | ~55 | Sandbox enforcement | Strict sandbox (lines 28-55), no optional guards |
| src/core/codexPrompt.ts | N/A | Prompt builder | No agents/context injection |
| src/core/providers/codexSubprocess.ts | N/A | Subprocess provider | Delegated approval (no timeout exposure) |
| src/core/workspaceActivity.ts | N/A | File polling | Polling overhead, no watcher |
| src/session/types.ts | N/A | Event types | TimelineEvent union; no AGENTS.md event type |
| src/ui/BottomComposer.tsx | N/A | Input field | No keyboard shortcuts, no aliases |

---

## Conclusion

Codexa is **not a drop-in replacement for Codex CLI**. It is a **specialized interactive wrapper** that trades automation flexibility for a better interactive UX. The 10 gaps identified above are intentional design decisions (e.g., TTY requirement, strict sandbox) or unimplemented features (e.g., AGENTS.md, --help).

**For interactive workflows:** Codexa is superior (better timeline UI, session history, theme support).  
**For automation / CI-CD:** Codex CLI is required.  
**Recommendation:** Use both tools in your workflow—Codexa for development, Codex for automation.

---

**Report Generated:** 2026-04-25 23:38:46  
**Codexa Version:** 1.0.1  
**Repository:** golba98/Codexa  
**Scope:** Feature parity analysis, gap identification, implementation roadmap, test checklist
