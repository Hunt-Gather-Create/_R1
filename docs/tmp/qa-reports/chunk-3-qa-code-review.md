# QA Report — Chunk 3 Code Review

**Branch:** `feature/runway-pr86-chunk-3`
**Base:** `feature/runway-pr86-base`
**Diff commit range:** `a9ad361..71326d5` (3 commits)
**Files reviewed:** 28 (source + test; doc diffs in `docs/tmp/*` not treated as code)

## Commits
- `a9ad361` feat(runway): L2 owner inheritance from parent L1 on create
- `ed82e1d` feat(runway): soft flags, past-end note, blocked_by cue, view preferences
- `71326d5` feat(runway): In Flight toggle, unified Project View, soft-flag plate

## Summary
- Critical findings: **0**
- Non-critical findings: **5**
- Pass-through files: 20

---

## Step 1 — DRY

### PASS-level observations

- `toISOString().slice(0,10)` is repeated in `plate-summary.ts`, `in-flight-section.tsx`, `plate-summary.tsx`, `day-item-card.tsx` (via `nowHelpers()`). Each repetition is ≤1 line. `plate-summary.ts` already exports `toISODate(d: Date)` but nothing consumes it. **NON-CRITICAL DRY:** components should use `toISODate(new Date())` from `@/lib/runway/plate-summary` instead of inlining `.toISOString().slice(0,10)` in 3 places.

- Default-preferences clone (`{ ...DEFAULT_PREFERENCES }`) is returned in 4 branches of `view-preferences.ts`. Fine — keeps the contract explicit. PASS.

- `buildUnifiedAccounts` grouping pattern mirrors `groupBy` from `@/lib/runway/operations`. PASS — slightly different shape (iterates on a flattened list, skips null projectId) so the inline Map is justified.

### `src/lib/runway/plate-summary.ts`
- [PASS] DRY: pure helpers, no repeated blocks.
- [NON-CRITICAL] `toISODate()` exported but not consumed in callers — see above.

### `src/app/runway/unified-view.ts`
- [PASS] 50 LoC, single grouping function. No DRY issue.

---

## Step 2 — Prop Drilling

### `runway-board.tsx`
- [PASS] `initialInFlightEnabled` is a scalar consumed one level down (RunwayBoard only). Not prop drilling.
- [PASS] `accounts` passed directly to `AccountSection` (one level). `allWeekItems` passed to `InFlightSection` (one level).

### `account-section.tsx`
- [PASS] `account` prop consumed locally; `ProjectCard` is defined in the same file and reads `item.milestones` directly. No drilling.

### `day-item-card.tsx`
- [PASS] Self-contained, flag helpers imported directly from `@/lib/runway/plate-summary`.

---

## Step 3 — Hooks & Context

### `runway-board.tsx`
- [PASS] `useState` for `view` and `inFlightEnabled`, `useTransition` for background persistence, `useEffect` for polling interval. All standard.
- [PASS] `handleToggleInFlight` correctly uses optimistic-then-persist pattern. `startTransition` wraps only the async action, not the setState — which is the correct React 19 pattern.
- [NON-CRITICAL] `allWeekItems` is memoized (`useMemo([...thisWeek, ...upcoming])`) but `InFlightSection` then calls `.flatMap((day) => day.items)` on every render inside its own `useMemo`. A single `useMemo([...thisWeek.flatMap, ...upcoming.flatMap], ...)` at the board level would avoid one level of work — but this is minor and `useMemo` inside `InFlightSection` already keys on `[enabled, weekItems, today]` so the computation is correctly memoized. Marginal.

### `in-flight-section.tsx`
- [NON-CRITICAL] `const today = nowISO ?? new Date().toISOString().slice(0, 10)` is recomputed every render. Doesn't affect the `useMemo` identity in most cases because it changes only at midnight, but `new Date()` mutates the memo key every render when `nowISO` is absent — meaning `useMemo` will recompute every render. Fix: compute `today` inside the memo, or wrap with `useMemo` keyed on a mount-time day bucket. Low impact (cheap filter), still worth noting.

### `view-preferences.ts`
- [PASS] Pure server action, no hooks.

### `account-section.tsx`
- [PASS] `useMemo` for `activeItems` and `holdItems`. Correct.

---

## Step 4 — Test Coverage

Every new source file has an adjacent test file. Coverage is strong.

| Source | Test | Notes |
|---|---|---|
| `src/lib/runway/plate-summary.ts` | `plate-summary.test.ts` | 295 LoC, covers pastEndRedNote (including null endDate fallback), retainerRenewalPills (inclusive 30-day edge, non-retainer skip, past-end skip), contractExpiredPills (blocked + not-started counted as active), filterInFlight (window edges, null start_date). Strong. |
| `src/lib/runway/view-preferences.ts` | `view-preferences.test.ts` | 87 LoC. Covers defaults, parsed JSON, malformed JSON, partial merge. **MISSING:** no test for the `no such table` graceful-fallback branch in `getViewPreferences` (lines 65-72). Same branch in `setViewPreferences` also untested. |
| `src/lib/runway/operations-writes-week.ts` (owner inheritance) | `operations-writes-week.test.ts` | 4 tests cover all L2 owner inheritance branches. Strong. |
| `src/app/runway/unified-view.ts` | `unified-view.test.ts` | 4 tests: grouping, empty milestones, drops null projectId, preserves account fields. PASS. |
| `src/app/runway/queries.ts` | `queries.test.ts` | 2 new tests for blockedBy resolution. **GAP:** no test that unresolved (out-of-view) blocker ids are silently dropped — actual behavior is tested implicitly via `"wi-missing"` in one test, but the assertion could be more explicit. NON-CRITICAL. |
| `src/app/runway/components/day-item-card.tsx` | `day-item-card.test.tsx` | Past-end note + blocked_by cue covered. PASS. |
| `src/app/runway/components/plate-summary.tsx` | `plate-summary.test.tsx` | Both pill types + null-state + outside-window covered. PASS. |
| `src/app/runway/components/in-flight-section.tsx` | `in-flight-section.test.tsx` | Enabled/disabled, filter + count. **MISSING:** no test for fallback `nowISO` default path (the `new Date().toISOString().slice(0,10)` branch). NON-CRITICAL. |
| `src/app/runway/components/account-section.tsx` | `account-section.test.tsx` | Milestones rendered inline + absent case covered. PASS. |
| `src/app/runway/runway-board.tsx` | `runway-board.test.tsx` | Default-on, off, flip + server-action invocation covered. PASS. |
| `src/app/runway/page.tsx` | `page.test.tsx` | `view_preferences` mocked; no test asserting that `unifiedAccounts` is passed to RunwayBoard. NON-CRITICAL: the unification helper has its own test and the contract is exercised indirectly. |
| `src/app/runway/actions.ts` | — | **MISSING test file.** `toggleInFlightAction` is a 4-line wrapper but its behavior (revalidatePath + return prefs) is untested. NON-CRITICAL (trivial wrapper) but the pattern elsewhere in `src/lib/actions/*` ships with tests. |
| `src/lib/db/runway-schema.ts` | — | Schema file, not test-targeted. PASS. |

---

## Step 5 — Security & Edge Cases

### `src/lib/runway/view-preferences.ts`
- [PASS] `"use server"` — Runway is single-tenant behind WorkOS middleware (proxy.ts); no workspace scoping exists in the Runway DB. Using `requireWorkspaceAccess` (as the CC prompt suggested) would be a no-op here because no `workspaceId` exists in the Runway schema. Aligns with existing Runway pattern (see `operations-writes-*.ts` — also no `requireWorkspaceAccess`).
- [PASS] Malformed JSON does not crash the page — silent fallback to defaults.
- [NON-CRITICAL] Graceful-fallback branch (`/no such table|SQLITE_ERROR/i.test(message)`) is string-matching; LibSQL error messages could change and silently start re-throwing. Better guard: check for a specific error code if available. Given this code is designed to be deleted after `runway:push`, acceptable risk.

### `src/app/runway/actions.ts`
- [PASS] `revalidatePath("/runway")` is appropriate; no other writes.
- [PASS] No user input passed through without validation (`next: boolean` is a primitive).

### Cross-week blocker resolution (ambiguity flagged)
- [PASS, with caveat] Current board call is `getWeekItems()` with no `weekOf` argument (page.tsx line 18), so all week items are fetched. The blocker map (line 93 in `queries.ts`) covers all items, so cross-week resolution works. The silent-drop behavior only fires when a blocker id is genuinely missing from the DB (orphan ref).
- [NON-CRITICAL] Latent footgun: if a caller ever passes a `weekOf` argument, the `weekItemById` map is scoped to that week, so cross-week blockers would silently disappear from the UI without logging. Recommendation: when a blocker id is non-null but unresolved, either (a) log a dev-warn, or (b) render a placeholder like `blocked by: (not visible in current view)`. Document the invariant now or it will regress.

### `view_preferences` table design
- **Agent designed `view_preferences` as a singleton table** instead of a column on `workspaces` (the CC prompt's suggestion). This is the right call because:
  - The Runway DB has NO `workspaces` table — it is single-tenant.
  - The agent's schema doc-comment explicitly acknowledges this ("Runway is currently single-tenant; `scope` keys the row; future per-user keys can coexist without a migration").
  - The `scope` primary key is extensible — future per-user toggles key off `slack_user_id` or equivalent with no migration.
  - The graceful-fallback branch means the UI doesn't break before `pnpm runway:push` is coordinated by TP.
- **PASS** — this design matches Runway's real data model, not the CC prompt's assumed model. Prompt was slightly wrong about the storage target.

### `operations-writes-week.ts` L2 owner inheritance
- [PASS] `resolvedOwner = owner ?? resolvedProjectOwner ?? null` is the exact pattern the v4 convention spec (line 96) requires: "on L2 create, auto-populate owner from parent L1.owner. Stored as an explicit value (not computed)."
- [PASS] Stored explicitly (not dynamic); subsequent L1 owner changes don't silently mutate existing L2 owners. Matches spec.
- [PASS] Atomically safe: no transaction boundary change needed because the read (`findProjectByFuzzyName`) happens before the insert. Chunk 5 TODO (`recomputeProjectDates` in-transaction) is tracked separately.

---

## Findings by severity

### CRITICAL (0)
None.

### NON-CRITICAL (5)

1. **`toISODate` defined but unused.** Three components inline `new Date().toISOString().slice(0,10)` instead of using the exported helper. Low priority, DRY hygiene. Files: `day-item-card.tsx:59-63`, `in-flight-section.tsx:24`, `plate-summary.tsx:27`.

2. **`today` computed outside `useMemo` in `InFlightSection`.** `new Date()` produces a new string identity only across midnight, but the expression runs every render. Move inside the memo block: `useMemo(() => { const today = nowISO ?? ...; ... }, [enabled, weekItems, nowISO])`. File: `in-flight-section.tsx:24-30`.

3. **Missing test for `view-preferences` "table absent" branch.** The graceful-fallback error-swallow logic in `getViewPreferences` and `setViewPreferences` is the whole reason the file is merge-safe before `runway:push`. Test it. File: `view-preferences.test.ts`.

4. **Missing test file for `actions.ts`.** `toggleInFlightAction` has no test for `revalidatePath` invocation or return shape. Trivial wrapper, but should be tested for the contract.

5. **Silent drop of unresolved `blocked_by` refs in `queries.ts:resolveBlockedByRefs`.** Not a bug today (board fetches all weeks), but a latent footgun if `getWeekItems(weekOf)` is ever called from a caller that expects visible blockers. Either log a dev-warn, render a placeholder, or document the invariant in `queries.ts` with a comment.

### PASS (20+ files)
All other diff files — runway-schema additions, plate-summary pure helpers, unified-view helper, AccountSection milestones, DayItemCard past-end/blocked_by cues, RunwayBoard toggle wiring, page.tsx parallel fetches, operations-writes-week owner inheritance, plus all tests — apply the 5-step review cleanly with no findings.

---

## Ambiguity Verdicts (explicit per operator ask)

### 1. `view_preferences` as singleton table
**Verdict: CORRECT design choice.** The Runway DB has no `workspaces` table (it's single-tenant, per `.claude/MEMORY.md`). The CC prompt assumed a `workspaces.view_preferences` column but that table doesn't exist. A singleton `view_preferences` table with a `scope` primary key is:
- The right data model for a single-tenant DB
- Forward-compatible with future per-user scopes (just pass a different scope string)
- Documented clearly in the schema comment

No rework needed. TP should coordinate `pnpm runway:push` at integration (flagged in commit message `71326d5`). The graceful-fallback branch ensures the UI doesn't break in the window before the push.

### 2. Is unified Project View genuine or duplicate plumbing?
**Verdict: GENUINE unification.** Evidence:
- `page.tsx:93` builds `unifiedAccounts = buildUnifiedAccounts(accounts, [...thisWeek, ...upcoming])` from the **same** week-items fetch already used by the triage view (not a second DB call).
- `AccountSection` consumes `Account | UnifiedAccount` via a type union; when `milestones` are absent (legacy shape) it renders as before. When present (unified shape), milestones render inline.
- There is no pre-existing `ProjectView.tsx` — the CC prompt said "or closest equivalent" — so `AccountSection` (the "By Account" tab) is the right surface.
- Single source of truth confirmed.

### 3. Graceful table-missing fallback safety
**Verdict: SAFE for deploy.** The fallback:
- Catches only `no such table` / `SQLITE_ERROR` (regex-matched on message).
- Re-throws everything else.
- Returns default preferences (toggle ON) during the window between PR merge and `pnpm runway:push`.

Risk is that LibSQL's error message text could change in a future version and the regex silently starts re-throwing. Acceptable for a branch designed to be removed post-push. Recommend TP remove the fallback after `runway:push` is confirmed on prod.

### 4. Silent-drop of out-of-view blockers
**Verdict: ACCEPTABLE in current usage, latent footgun.** See Non-Critical #5 above. The board's current `getWeekItems()` call is unbounded (all weeks), so silent drops only occur for orphan ids. Document the invariant in a comment before it becomes a regression after the next refactor.

---

## Overall recommendation

**MERGE** — with optional non-critical fixups deferred to Chunk 5 polish.

All findings are non-critical. The commits are coherent, tests are strong, the `view_preferences` design correction is the right call, and the L2 owner inheritance exactly matches the v4 convention spec. No security, data-loss, or contract-break issues found.

---

## Unresolved

None. All four operator-flagged ambiguities resolved above.
