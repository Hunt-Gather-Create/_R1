# QA Report — Chunk 3 Atomic Commits

**Branch:** feature/runway-pr86-chunk-3
**Base:** feature/runway-pr86-base
**Worktree:** /Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-a6734f62
**Commits evaluated:** 3

## Summary
- Critical findings: 0
- Non-critical findings: 3
- Pass commits: 3 (with caveats in commit 2's bundle coherence)

## Findings

### a9ad361 — feat(runway): L2 owner inheritance from parent L1 on create

- [NON-CRITICAL] Atomicity: Commit bundles two distinct logical changes:
  1. **L2 owner inheritance on `createWeekItem`** — the primary, titled change. Touches `operations-writes-week.ts` + co-located tests.
  2. **Adds `viewPreferences` table to `runway-schema.ts`** — unrelated to owner inheritance; prep for chunk 3 #6 (In Flight toggle).
  The commit message explicitly acknowledges this with an "Also adds..." paragraph. Per the atomic-commits skill ("one cohesive purpose"), this should be two commits. However, the schema addition is intentionally ordered-first as a dependency for commit 2 (`view-preferences.ts` imports `viewPreferences` from schema), so the bundling is pragmatic, not sloppy. Schema additions that add a new table with no code consumers in the same commit are safe for bisect (no behavior change, no import breakage). Downgraded to NON-CRITICAL because it does not break build/test isolation and the message is transparent about the bundling.
- [PASS] Message: `feat(runway):` conventional scope; body explains the WHY (runway-v4-convention.md §Owner inheritance rule) and the contract (null when no parent, matches pre-v4). Transparent about the secondary schema addition.
- [PASS] Self-contained: Commit builds independently. Schema addition is additive (new table, no FK into existing tables). `operations-writes-week.ts` change is a pure additive branch on existing logic. Co-located test file (`operations-writes-week.test.ts`, +87 lines) covers the new behavior.
- [PASS] Tests co-located: 87 lines of new tests land in the same commit as the 12-line production change.

### ed82e1d — feat(runway): soft flags, past-end note, blocked_by cue, view preferences

- [NON-CRITICAL] Atomicity: Commit bundles five related-but-distinct UI/data surfaces under the umbrella "v4 convention flags":
  1. `plate-summary.ts` helpers (past-end-note, retainer renewal, contract-expired) + PlateSummary component — chunk 3 #4, #5
  2. `DayItemCard` past-end inline note + blocked_by cue — chunk 3 #3, #7
  3. `queries.ts` / `types.ts` pass-through of id, startDate, endDate, updatedAtMs, resolved blockedBy refs — shared infra for the UI above
  4. `page.tsx` surfaces engagementType / contractEnd / start+end dates on `TriageItem` — required for retainer pills in (1)
  5. `view-preferences.ts` get/set module backed by the new table — chunk 3 #6 (In Flight toggle) — NOT consumed anywhere in this commit; pure prep for commit 3.
  Items 1–4 form a coherent bundle: shared data plumbing (queries + types + page) feeding two new UI surfaces (PlateSummary, DayItemCard additions) that together implement "soft flags for v4 convention violations." Keeping them together avoids a three-way split where each piece would be non-buildable until the others land. This is justifiable as a single commit.
  Item 5 (`view-preferences.ts` + test) is the outlier — it is a **standalone get/set module with zero call sites** at this SHA. It belongs logically with commit 3, where it gets wired in via `actions.ts`, `page.tsx`, and `runway-board.tsx`. Bundling it here increases the commit's scope without logical necessity. Flagging NON-CRITICAL rather than CRITICAL because: (a) the file adds no imports to existing code paths, (b) the view-preferences test is self-contained and passes, (c) no bisect risk since no existing behavior changes. But the body's sixth bullet ("view-preferences.ts: ... defaults inFlightToggle=true") reads as a grab-bag item and tells the reader it didn't belong.
- [PASS] Message: `feat(runway):` conventional scope. Body lists each surface clearly, references chunk items and v4 convention, and explains the purpose of each file's change. Tests-cover statement at the end is accurate.
- [PASS] Self-contained: Commit builds independently. New files (`plate-summary.ts`, `plate-summary.tsx`, `view-preferences.ts`) have no consumers in pre-existing code yet — they only ship their own exports + tests. Existing changes (`queries.ts`, `types.ts`, `page.tsx`, `day-item-card.tsx`) are strict supersets of prior shape — all additive fields. `page.test.tsx` is NOT yet mocking `view-preferences` here, but that's fine because `page.tsx` doesn't yet import `getViewPreferences` (that wire-up is in commit 3). No test asserts arity or call shape against the new modules, so no bisect-breaking mismatch exists.
- [PASS] Tests co-located: 72 lines day-item-card.test, 108 lines plate-summary.test (component), 62 lines queries.test, 256 lines plate-summary.test (helpers), 87 lines view-preferences.test — all new tests land with their subjects in this commit.

### 71326d5 — feat(runway): In Flight toggle, unified Project View, soft-flag plate

- [PASS] Atomicity: Single cohesive change — wires In Flight toggle end-to-end (schema already exists, server module exists, this commit connects action → board → page → section) AND introduces the unified Project View pivot (`unified-view.ts`) + its `account-section` rendering + a top-of-board PlateSummary slot. The three items (In Flight toggle, unified view, plate surface) all hit `page.tsx` + `runway-board.tsx` + render downstream, so splitting would require interleaved state in `runway-board.tsx` that isn't buildable in isolation. Commit message title reads as three items but body explains the shared wire-up point.
- [NON-CRITICAL] Message: Three-item title is acceptable per precedent (chunk 2 `e270924` was similarly bundled and marked NON-CRITICAL in that QA). The body's first bullet ("view-preferences: graceful fallback if table not yet pushed to prod") is useful context but arguably belongs in a dedicated defensive-hardening commit. Flagging for style only.
- [PASS] Self-contained: Commit builds independently. `page.test.tsx` is updated to mock `getViewPreferences` in the same commit that makes `page.tsx` import it — arity-safe. `runway-board.test.tsx` adds the `./actions` mock + three new toggle tests in the same commit as the toggle implementation — arity-safe. `in-flight-section.test.tsx` (106 lines) + `unified-view.test.ts` (98 lines) + `account-section.test.tsx` (39 lines) all land with their subjects. `plate-summary.test.ts` adds `filterInFlight` test coverage alongside the `filterInFlight` helper.
- [PASS] Tests co-located: Every new production line has co-located test coverage in the same commit. Existing tests updated for the new prop/mock surface land here, not deferred.

## Bundle coherence evaluation (commit 2 specifically)

The operator asked: "Evaluate whether that bundle is coherent as a single logical change or should be split further."

**Verdict:** The bundle is **mostly coherent** but has one outlier.

Coherent core (keep together):
- `plate-summary.ts/tsx` (helpers + component)
- `day-item-card.tsx` past-end + blocked_by
- `queries.ts` / `types.ts` pass-through
- `page.tsx` TriageItem metadata
These all feed the v4 "soft flags visible on the board" feature and share data plumbing. Splitting would produce non-buildable intermediate commits.

Outlier (should have been in commit 3):
- `view-preferences.ts` + `view-preferences.test.ts` — standalone, no call sites in commit 2, only consumed by commit 3's wire-up (`actions.ts`, `page.tsx`, `runway-board.tsx`). Moving these to commit 3 would make commit 3's title-promised "In Flight toggle" change fully self-contained at that SHA (module + wire-up + tests together), while shrinking commit 2 to its actual theme.

## Overall recommendation

**MERGE** — with the caveats above. All three commits pass the critical bars: each builds in isolation, each has co-located tests that pass at its SHA, each uses correct conventional-commit type (`feat`), and messages describe the WHY adequately. The bundling concerns are NON-CRITICAL style drift, not bisect-breakers. There is a meaningful improvement available (move `view-preferences.ts` from commit 2 to commit 3; split commit 1's schema addition into its own commit or into commit 2), but neither blocks merge.

## Proposed restructure (OPTIONAL, not required for merge)

If the operator wants to tighten bundle coherence:

1. `feat(runway): L2 owner inheritance from parent L1 on create`
   — `operations-writes-week.{ts,test.ts}` only (drop schema addition)

2. `feat(runway): add view_preferences schema + server module`
   — `runway-schema.ts` (viewPreferences table)
   — `src/lib/runway/view-preferences.{ts,test.ts}`

3. `feat(runway): soft flags, past-end note, blocked_by cue` (renamed)
   — All current commit 2 contents EXCEPT `view-preferences.{ts,test.ts}`

4. `feat(runway): In Flight toggle, unified Project View, soft-flag plate`
   — Current commit 3 contents (now fully self-contained: view-preferences module already landed in step 2)

This would produce 4 commits instead of 3, but each would carry exactly one logical change and the commit messages would stop needing "Also adds..." hedges.

## Unresolved

None. All three commits were readable and individually analyzable. Per the QA template constraint (no rebase/amend/reset), no restructuring was performed — the proposal above is advisory only.
