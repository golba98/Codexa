# Ubume 0.1.16 local release verification

Verified on 2026-10-09 on `fix/restore-antigravity-as-google`. Both the existing Google/Antigravity restoration and Mistral discovery/routing work are included. Existing staged and unstaged changes were preserved. Local verification completed before commit and PR publication; no npm publication or release tag was created.

## Issues corrected in this pass

- Configured Mistral models were reclassified as custom when API metadata was absent. Configured native, local and third-party routes now remain usable after an API discovery failure. API-discovered routes, including API aliases attached to native rows, still require a verified catalogue.
- API metadata was matched against the configured selector alias, allowing unrelated API IDs to supply capabilities. Matching now uses the configured request name and API-declared aliases; the selector alias and configured record are preserved.
- A mocked request reproduced an API selection forwarding a different configured model name. Configured selectors now execute their configured request name, while API IDs and aliases execute the exact selected ID. The picker also reads aliases through the capability wrapper and preserves the selected API ID through refresh and confirmation. Reasoning variants remain specific to models declaring variant transport.
- Injecting a model reconstructed only a subset of its settings. The full configured model record is retained before applying the supported routing/reasoning fields, preserving temperature, pricing, compaction, image/context settings and provider configuration.
- The current/default row disappeared when a native model was pinned. It is now consistently available as "Vibe current/default," retaining the internal `Vibe default` route ID. It follows the saved active/default selection and inherited environment overrides; it does not unpin Vibe's native selection.

Source changes in this pass: `src/core/providerRuntime/mistralVibe.ts`, `registry.ts` and their colocated tests; `providerRequests.test.ts`; `src/ui/panels/ModelPickerScreen.tsx` and `ModelPickerState.test.tsx`. Release files: `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, generated `src/config/buildInfo.ts`, CHANGELOG, VERSIONS and README. The existing Google changes remain documented in [PROVIDER_RELIABILITY_REPORT.md](PROVIDER_RELIABILITY_REPORT.md).

## Verification results

| Check | Result |
| --- | --- |
| Focused Mistral/runtime/picker tests | 93 passed, 0 failed across 6 files |
| `bun test --max-concurrency=1` | 1,986 passed, 0 failed across 177 files; 138.44 seconds |
| `bun run format` | Passed |
| `bun run build` | Passed; generates metadata, then runs TypeScript and Biome |
| `bun run audit:ubume-gap` | 17/17 passed |
| `git diff HEAD --check` | Passed |
| Manifest/lock/build version consistency | All report 0.1.16; both npm lockfiles are identical and match manifest dependencies |
| `node bin/ubume.js --version` | 0.1.16 |
| `npm pack --dry-run --ignore-scripts --json` | 228 files; 601,516 packed bytes; 2,538,655 unpacked bytes |
| Package content inspection | Required Mistral, Antigravity, executable/identity and build files present; tests, fixtures, `.env`, node_modules and removed Gemini runtimes absent |
| Installed Vibe 2.26.0 offline parsing | Actual adapter-generated Large 4 none/high and local-model lists accepted |

Regression coverage includes failed refreshes, configured names differing from aliases, colliding selector IDs, exact API ID forwarding, complete configured settings, local/third-party provider preservation, current/default environment inheritance, and picker refresh/confirmation at 60 and 120 columns.

The offline parser check used Vibe's installed `normalize_model_configs` and `ModelConfig`, plus its actual reasoning mapping: Low becomes `none`, High becomes `high`. The local payload retained its llama.cpp provider, temperature, image support and compaction threshold. A mocked command runner captured these payloads; no Vibe inference process was launched.

Sanitized synthetic Ink captures are in [recordings/mistral-vibe-picker.txt](recordings/mistral-vibe-picker.txt). Both widths display native, local, current/default and API custom rows. The custom request-verification suffix is truncated to fit the narrow terminal and fully visible at 120 columns.

Full test log: `/tmp/ubume-0.1.16-tests.log`. Audit log: `/tmp/ubume-0.1.16-audit.log`. Package manifest: `/tmp/ubume-0.1.16-pack.json`. Offline payload fixture: `/tmp/ubume-0.1.16-vibe-payloads.json`.

## Release state and limitations

The public npm registry reports 0.1.15 as published and returned E404 for 0.1.16 before preparation. All version-bearing release files now report 0.1.16. The dependency graph is unchanged; the Bun lockfile has no root version field requiring an update. Build metadata records the verification baseline HEAD `672a19d8980d210484b1c0037f38918655f8243f`; the PR contains the verified changes prepared against that baseline.

No live Mistral completion was sent. Successful Mistral Large 4 inference and the model reported by a completed Vibe request remain unverified. The live terminal-bench command was omitted because it launches a provider request. Earlier authenticated Google verification is historical evidence from the existing provider report, not a new live check in this pass.

Ubume 0.1.16 is prepared for PR review. It has not been published to npm or tagged as a release.
