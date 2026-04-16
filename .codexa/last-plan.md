> **Status:** Planned a **Rank 1 + Rank 2 closure-and-hardening** slice based on the current repo state; this was an inspection-only turn with no file edits.

**Files**
- **docs/planning/parity-implementation-checklist.md**
- **src/app.tsx**
- **src/commands/handler.ts**
- **src/commands/handler.test.ts**
- **src/config/runtimeConfig.ts**
- **src/config/runtimeConfig.test.ts**
- **src/config/layeredConfig.ts**
- **src/config/layeredConfig.test.ts**
- **src/core/codexExecArgs.ts**
- **src/core/codexExecArgs.test.ts**
- **src/config/launchArgs.test.ts**
- **src/ui/PermissionsPanel.tsx**
- **src/ui/PermissionsPanel.test.tsx** *(new, if picker-flow coverage is added)*
- **src/session/types.ts** *(only if screen/panel routing needs a small extension)*
- **src/ui/focus.ts** *(only if screen/panel routing needs a small extension)*
- **No deletions expected**

**Steps**
1. **Chosen slice:** finish and verify **Rank 1 + Rank 2** using the substantial groundwork already present, and touch **Rank 3** only where it directly proves config layering and CLI override behavior. This is the best slice because the repo already has first-class runtime policy types, **`/permissions`**, layered **`config.toml`** loading, and Codex argv forwarding; the highest-value work is closing remaining user-facing seams and updating the tracker honestly.
2. Start on the required branch: check out **`parity-implementation-foundation`** if it exists, otherwise create it with **`git switch -c parity-implementation-foundation`**.
3. Reconcile the actual implementation in **src/config/runtimeConfig.ts**, **src/commands/handler.ts**, **src/app.tsx**, **src/config/layeredConfig.ts**, and **src/core/codexExecArgs.ts** against the closure criteria in **docs/planning/parity-implementation-checklist.md** to identify the real remaining gaps for **Rank 1** and **Rank 2**.
4. Keep the existing control plane and finish only the missing surface:
   - preserve **mode** as a user-facing workflow toggle,
   - keep **approval policy**, **sandbox mode**, **network access**, and **writable roots** independently editable,
   - extend the existing **Permissions** picker flow only if a required control is still missing from the current TUI.
5. Verify the runtime path end-to-end:
   - layered config and CLI overrides resolve into **`RuntimeConfig`**,
   - in-session overrides stay separate from persisted UI settings,
   - resolved policy reaches **Codex exec args** and provider launch unchanged,
   - writable-root resolution stays Windows-safe.
6. Add or tighten tests around the actual closure points:
   - command handling for **`/permissions`** and related runtime controls,
   - picker-flow coverage if **PermissionsPanel** changes,
   - layered config precedence and **`-c/--config`** overrides for approval, sandbox, network, and writable roots,
   - exec-arg tests proving the effective runtime policy is what gets forwarded.
7. Update **docs/planning/parity-implementation-checklist.md** only after tests prove the feature is user-visible and forwarded:
   - mark **Rank 1** and **Rank 2** `done` only if the status policy is fully satisfied,
   - leave **Rank 3** honest if any layering or override gaps remain,
   - add evidence and missing-work notes without rewriting backlog wording.
8. If the audit shows **Rank 1/2** are already fully closed after verification, use the same branch for the next unlocked slice: **Rank 4 session persistence and core session commands**, not more speculative policy work.

**Assumptions**
- **Rank 1** is mostly implemented already: runtime policy types, resolution, layered TOML loading, and execution forwarding exist in the repo.
- **Rank 2** is also mostly implemented already: **`/permissions`**, writable-root management, and permissions pickers are present, but the tracker appears stale.
- Runtime policy changes should remain **session/runtime state** unless the implementation adds an explicit config-writing flow.
- The current **Codexa** UI structure in **src/app.tsx** should be extended incrementally, not reworked.

**Risks**
- The biggest risk is **false closure**: the checklist should not move to `done` unless the flow is genuinely user-visible, forwarded into execution, and test-covered.
- Changes around **mode inheritance** vs explicit policy overrides can silently break existing **`suggest`**, **`auto-edit`**, and **`full-auto`** behavior.
- **Writable-root** and relative-path handling in layered config are easy to regress on Windows.
- Branch state could not be verified in this read-only, policy-constrained turn, so branch setup should be the first execution step.