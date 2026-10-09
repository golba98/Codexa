# Terminal response rendering overhaul

Implemented in the detached worktree `/home/k9-vortex/Development/2-TypeScript/8-Ubume CLI-rendering-20261009`, based on `22628c9ff59289c1cc7d2b6ade518b17cd5801a1`. Changes have not been applied to the shared checkout.

## Root cause and design

Ubume uses React and Ink 7. Its regex Markdown parser understood headings 1–3, flat lists and a small inline subset; tables therefore remained raw text. React and measured timeline layouts implemented different rendering rules. Assistant preprocessing also rewrote paths and whitespace, guessed filenames as code titles, and truncated response sections. These presentation transformations could lose information.

The implementation retains TranscriptShell, native scrollback, viewport anchors, session update batching, existing composer/status layout and theme tokens. A shared parser and canonical measured-row renderer now serve both presentation paths. Normalized assistant content is formatted independently of provider identity. Tool, reasoning, error and system output retain their separate presentation paths. No provider or transport changes were made.

## Behavior

Tables use aligned headers, subtle separators, Unicode display widths, responsive column allocation and wrapped cells. Narrow layouts deliberately switch to stacked header/value rows. Missing, empty and surplus cells remain represented; escaped pipes and pipes inside code spans parse correctly. Alignment directives are honored. During streaming, widths remain header-driven until completion to reduce jitter.

Headings 1–6, nested ordered/unordered/task lists, hanging wraps, quotes, rules, bold, italic, inline code, links and strikethrough share one layout. Literal paths remain exact; only file-link labels shorten, and full targets remain visible. Terminal control sequences are sanitized before presentation. Failed rich layout falls back to sanitized raw text.

Code retains filename-like first lines, indentation, tabs, blank lines and source whitespace. Language labels and restrained gutters distinguish code; diff additions/deletions retain their source characters and semantic colors. Long lines use marked visual continuations. Original response text remains unchanged for existing copy/export workflows.

Incremental parsing reuses stable blocks and reparses the trailing block. Bounded caches avoid repeated layout and Unicode measurement. Cached text owns its storage so small substrings do not retain entire response buffers. Lifecycle resets release caches.

## Changed files

All paths below are relative to the isolated worktree.

| File | Purpose |
| --- | --- |
| `src/ui/render/markdownParser.ts` | Safe block/inline parser and incremental parsing |
| `src/ui/render/markdownCache.ts` | Bounded LRU caches, owned strings and reset lifecycle |
| `src/ui/render/Markdown.tsx` | Shared canonical rows for React rendering; compatibility exports |
| `src/ui/timeline/measure/markdownRows.ts` | Responsive tables, code and unified Markdown layout |
| `src/ui/timeline/measure/rows.ts` | Inline styles, word boundaries, grapheme progress and cached row reuse |
| `src/ui/timeline/measure/types.ts` | Style metadata |
| `src/ui/timeline/measure/caches.ts` | Markdown cache lifecycle reset |
| `src/ui/timeline/TimelineRows.tsx` | Ink italic, underline and strikethrough styles |
| `src/ui/timeline/measure/streamRows.ts` | Raw assistant presentation boundary; streaming cache identity; remove truncation |
| `src/ui/timeline/AgentBlock.tsx` | Shared parser without destructive preprocessing |
| `src/ui/timeline/TurnGroup.tsx` | Shared parser and complete response rendering |
| `src/ui/render/Markdown.test.ts` | Path/link behavior and exact raw copy/export preservation |
| `src/ui/render/markdownParser.test.ts` | Parser, malformed input, streaming and cache tests |
| `src/ui/timeline/measure/markdownRows.test.ts` | Table/code/Unicode/layout snapshots and width tests |
| `src/ui/timeline/Timeline.test.ts` | Updated path and link expectations |
| `src/ui/timeline/TurnGroup.test.tsx` | React/measured parity across eight themes and six widths |
| `src/ui/timeline/TranscriptShell.test.tsx` | Actual Ink resize, composer/status and completion checks; repair frame helper |
| `src/ui/timeline/timelineMeasureCache.test.ts` | Provider presentation parity, full responses and frozen browsing |
| `scripts/audit-ubume-capabilities.mjs` | Recognize shared Markdown-to-diff integration in the capability audit |
| `scripts/benchmark-terminal-markdown.ts` | Reproducible provider-free latency, CPU and memory benchmark |
| `docs/recordings/markdown-overhaul.txt` | Actual before/after Ink frames at all requested widths |
| `docs/recordings/markdown-overhaul.cast` | Truecolor terminal recording |
| `docs/recordings/markdown-overhaul.svg` | Styled vector preview |
| `docs/recordings/markdown-overhaul.png` | Inspected preview screenshot |
| `docs/recordings/markdown-performance.json` | Measured benchmark results |
| `docs/TERMINAL_RENDERING_REPORT.md` | This delivery report |

## Visual examples

Colors and emphasis are visible in [the screenshot](recordings/markdown-overhaul.png) and [terminal recording](recordings/markdown-overhaul.cast). [Captured frames](recordings/markdown-overhaul.txt) contain the actual old renderer and new widths 40, 60, 80, 100, 120 and 160, plus purple and monochrome themes. Preview recording clears separate fixtures intentionally; the live integration test verifies updates do not erase scrollback.

Representative source/before:

```text
## Release notes
| Section | What it explains |
|---------|------------------|
| Overview | What Ubume is |
| Installation | How to install Ubume |
- Prepare
  - [x] Inspect repository
```

After (heading/header emphasis uses the active theme):

```text
Release notes

Section       What it explains
────────────  ────────────────────
Overview      What Ubume is
Installation  How to install Ubume

• Prepare
  ☑ Inspect repository
```

Narrow table fallback:

```text
Section: Overview
What it explains: What Ubume is

Section: Installation
What it explains: How to install Ubume
```

Previously, a fenced first line resembling `config.ts` could be consumed as a title, and code was enclosed in a heavy box. Now all source lines remain:

```text
typescript
│ config.ts
│ const greeting = "Hello";
│
│ console.log(greeting);
```

Long source lines receive a dim `↳` continuation marker; source storage and exported text remain exact.

## Verification

Final commands, executed only in the isolated worktree:

```sh
bun install --frozen-lockfile
bun test --max-concurrency=1 src/ui/render src/ui/timeline src/ui/input src/ui/layout.test.ts src/ui/theme.test.ts src/ui/themeFlow.test.ts src/core/shared/text.test.ts src/core/terminal/terminalSanitize.test.ts src/session/liveRenderScheduler.test.ts
bun run typecheck
bun run check
git diff --check
bun scripts/benchmark-terminal-markdown.ts > docs/recordings/markdown-performance.json
```

The final focused suite passed **400 tests across 33 files**, with **0 failures**, in **17.64 seconds**. Type checking and Biome passed. Only changed source files were formatted. Dependencies were installed from the existing frozen lockfile; no dependencies or lockfiles changed.

Tests cover two/five-column tables, long/empty/aligned/escaped/code-pipe/Unicode cells; headings, nested lists, tasks, links, nested inline styles, quotes, fences, malformed/deep input; character-by-character and arbitrary chunks; incomplete fences/tables, interruption and completion; stable block identities; all requested widths; eight themes; exact code and raw transcript export; actual Ink composer/status placement; browse anchoring during growth/resize; and normalized content parity for supported provider identities without contacting providers.

Intermediate failures exposed delimiter nesting, stable source-line identity, legacy path expectations and an unused broken frame-capture helper; these were corrected. No failures remain in the final suite. Full backend/provider tests, live provider calls and build-info-generating `bun run build` were intentionally skipped to preserve task scope and isolation. No physical terminal/manual keyboard session was exercised: existing input tests and live Ink fixtures provide automated coverage.

## Performance assessment

Bun 1.3.14, 80-column fixtures; shared JIT, cold presentation caches. Warm statistics exclude the first two of twelve calls. Append statistics exclude the first five of forty calls. Results are workload measurements, not end-to-end terminal latency guarantees.

| Fixture | Earlier renderer median | New cold | New warm median | Append p95 |
| --- | ---: | ---: | ---: | ---: |
| 200 × 5 table, 17,523 bytes | 73.35 ms | 28.056 ms | 0.871 ms | 8.796 ms |
| 1,000 code lines, 57,797 bytes | 68.24 ms | 6.099 ms | 0.391 ms | 3.278 ms |
| 20 KB prose | 1.83 ms | 5.396 ms | 0.353 ms | 5.049 ms |

Rich cold prose parsing adds overhead, while cached/repeated rendering improves substantially. The paced shared response-row benchmark (200 × 5 table, 40 updates at 33 ms) measured **5.832 ms median, 9.465 ms p95**, **540.359 ms process CPU** over **1,332.513 ms wall time**. It includes parsing/layout/row building and process overhead, but excludes Ink painting and provider transport. It is a deliberately large response workload; CPU is not zero.

After event-loop yields and full GC, live heap rose from 39.26 MB to 45.51 MB while caches filled, then stayed near 45.74/45.93/46.13 MB at 300/450/600 distinct tables. Clearing caches returned it to 39.34 MB. Reserved heap and process counters differ from live reachable memory. This measures presentation caches, not full application conversation retention. A review discovered substring-backed cache retention; owned text fixed that growth. Row caching also removed repeated Unicode padding measurements on unchanged streaming rows.

## Limits

There is no general syntax-highlighting engine in the existing stack. Diff blocks have semantic highlighting; other code uses theme styling and language labels. This is a pragmatic Markdown subset, not complete CommonMark: reference links, raw HTML, math and elaborate nested block containers can remain literal. URLs are visible rather than using newly introduced OSC hyperlinks. Terminal text selection can include visual gutters; existing copy/export uses raw responses. One-column viewports cannot physically fit wide graphemes, but terminate safely; requested widths 40–160 are verified. Native scrollback remains terminal-managed, and the live viewport intentionally shows its current window before complete content is committed.

## Multi-agent safety

The shared checkout was inspected before implementation and monitored during work. The other agent advanced its branch while these changes stayed in a detached worktree. No overlapping rendering edits were detected. Final shared status contained only the other agent's untracked `docs/PROVIDER_RELIABILITY_REPORT.md`. No shared files were edited, no existing modifications were overwritten, no staging/commit/push/PR/reset/revert/stash/clean operations were performed, and provider/model/authentication/transport/execution files remain unchanged. The code-quality-review skill was used for the final surgical review.

The accompanying patch was delivered without applying it to the shared checkout. The user subsequently requested a pull request, authorizing a dedicated branch, commit and push from this isolated worktree. The PR branch incorporates the latest main without overlapping rendering changes; the shared checkout remains untouched.

## PR validation against current main

After the user requested publication, `origin/main` at `25054c0` was merged into the isolated branch without conflicts. Frozen dependencies were refreshed to match that base; the PR diff introduces no dependency or provider changes.

`bun test --max-concurrency=1` completed with 1,954 passing tests and two failures across 174 files in 125.04 seconds. One failure was the capability audit expecting the old direct diff import in Markdown.tsx; its check was updated to recognize the canonical row renderer, and the audit test then passed. The other is an unrelated existing path scanner traversing node_modules and failing with ENOENT on its broken `.bin/openai` symlink. That scanner was left unchanged. Type checking and Biome pass against current main. The focused rendering suite was rerun after the audit correction; it passed 401 tests across 34 files, with zero failures, in 17.70 seconds. The full suite was not repeated solely for the known unrelated scanner failure.
