# QA Report — Chunk 1 Code Review

**Branch:** feature/runway-pr86-chunk-1
**Base:** feature/runway-pr86-base
**Diff commit range:** feature/runway-pr86-base..HEAD (5 commits)
**Files reviewed:** 9 (4 source, 4 test, 1 type)
**Working dir:** /Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-acce433e

## Commit log
```
c5d35fc feat(runway): rewrite getPersonWorkload to v4 contract
23d56eb fix(runway): exclude non-active statuses from detectBottlenecks
8d8839b fix(runway): exclude completed L2 items from detectResourceConflicts
86edf0b fix(runway): skip completed and on-hold items in detectStaleItems
4c72318 fix(runway): skip completed items in getStaleWeekItems
```

## Summary
- Critical findings: 0
- Non-critical findings: 7
- Pass-through files: 3
- **Overall recommendation: MERGE** (with follow-ups listed under "Non-critical" for Chunk 2/3 pickup)

---

## Contract compliance — PersonWorkload

**Verdict: COMPLIANT with one interpretation divergence that should be explicitly ratified.**

Spec (pr86-orchestration-plan.md lines 247–272):
```
ownedProjects: {
  inProgress: Project[],     // L1s person owns with any active L2s
  awaitingClient: Project[],
  blocked: Project[],
  onHold: Project[],
  completed: Project[]       // opt-in only; default omit
}
```

Agent's `bucketProject()` (operations-reads-week.ts:96–109) buckets strictly by **L1 status**:
- `awaiting-client` → awaitingClient
- `blocked` → blocked
- `on-hold` → onHold
- `completed` → completed
- everything else (`in-production`, `not-started`, `null`) → inProgress

The spec comment for `inProgress` says *"L1s person owns with any active L2s"*, which could be read as a join predicate on L2 state rather than an L1 status predicate. The agent's interpretation is defensible because the other four buckets are explicit L1 status names — mixing "active-by-L2" into the `inProgress` slot alone would be inconsistent.

This resolution matches prompt ambiguity #1. Recommend Jason/TP explicitly ratify before Chunk 2 builds against it. Shape (keys, types, cardinality) is correct; only the `inProgress` semantics are debatable.

All other contract fields are compliant:
- `weekItems.{overdue,thisWeek,nextWeek,later}` — present, correctly typed
- `flags.contractExpired` / `flags.retainerRenewalDue` — present, logic matches spec
- `totalProjects` / `totalActiveWeekItems` — present, numeric
- `includeCompleted` opt-in flag — present and defaults to false

---

## Findings

### src/lib/runway/operations-reads-week.ts

- **[PASS]** DRY: No duplication within the file; helper functions (`mondayOf`, `addDaysISO`, `bucketWeekItem`, `sortWeekItems`, `bucketProject`) are appropriately extracted. `groupBy` import correctly removed since it is no longer used by `getPersonWorkload`.
- **[PASS]** Prop drilling: N/A (server module).
- **[PASS]** Hooks/context: N/A.
- **[NON-CRITICAL] Test coverage gap (bucket semantics):** `bucketWeekItem` (lines 174–201) does not filter `thisWeek/nextWeek/later` buckets by `status !== 'completed'`. A completed L2 with a future `startDate` lands in a forward bucket and increments `totalActiveWeekItems` despite the "Active" name. There is no test asserting that a future-dated `status=completed` item is excluded from `thisWeek`/`nextWeek`/`later`. If the intent is that `totalActiveWeekItems` excludes completed items everywhere (not just overdue), this is a behavioral gap. Spec is ambiguous; recommend adding an explicit filter or adding a test that asserts current (intentional) behavior.
- **[NON-CRITICAL] Edge case — bucketWeekItem multi-day fallthrough (line 198):** The fallback `if (startDate < thisMondayISO && endDate >= thisMondayISO) return "thisWeek"` runs AFTER the `startDate > nextSundayISO` branch. That means an item with `startDate < thisMondayISO` (so past-start) that is not `overdue` (endDate >= today) and has `endDate >= thisMondayISO` correctly becomes thisWeek. However, if `endDate >= nextMondayISO` (multi-week span crossing into next week) it still only lands in `thisWeek`. The spec doesn't define multi-week spans, so this is likely acceptable, but worth noting for Chunk 3 UI.
- **[NON-CRITICAL] Minor: `date` legacy column used as secondary sort key in Promise.all query (line 231).** After the backfill runs, `date` will be identical to `startDate`. Ordering by `weekItems.date` remains correct but is pre-v4 semantics. Non-blocking.

### src/lib/runway/operations-reads-week.test.ts

- **[PASS]** DRY: Good factory helpers (`createWeekItem`, `createProject`, `createClient`, `mockWorkloadDb`) keep test setup compact.
- **[PASS]** Prop drilling / hooks: N/A.
- **[PASS]** Test coverage for happy paths: buckets, stubs filter, owner-only, contract-expired flag, retainer-renewal flag, sort order, includeCompleted opt-in — all covered.
- **[NON-CRITICAL] Missing negative test for completed future L2s:** No assertion that a `status='completed'` L2 with `startDate` within thisWeek/nextWeek/later is excluded (or included — either way, the intent should be pinned). See finding above.

### src/lib/runway/operations-reads.test.ts

- **[PASS]** Hooks/context/DRY: N/A.
- **[NON-CRITICAL] Stale comment drift (lines 5–6):** Block comment still says `getPersonWorkload` lives in `operations-reads-clients.ts`. It actually lives in `operations-reads-week.ts`. Cosmetic.
- **[NON-CRITICAL] Test coverage — removed assertions:** The old test "returns projects and week items for a person" asserted `result.projects[0].client === 'Convergix'` (client-name resolution). The new test does not exercise `getClientNameMap` at all (clients returned from the third `Promise.all` slot are used only for `contractExpired` filtering). Since the new shape returns raw `ProjectRow[]` and `WeekItemRow[]` (no grouped-by-client projection), this is correct — but downstream consumers (Chunk 2/3) will need their own client-name resolution. Confirm in Chunk 2 prompt.

### src/lib/runway/flags-detectors.ts

- **[PASS]** DRY: `STALE_EXCLUDED_STATUSES` and `BOTTLENECK_EXCLUDED_STATUSES` correctly hoisted as module-level Sets for O(1) lookup. Matches project pattern.
- **[PASS]** Prop drilling / hooks: N/A.
- **[PASS]** Test coverage: new tests added in flags-detectors.test.ts for each added filter.
- **[NON-CRITICAL] Resolution validation — detectBottlenecks awaiting-client exclusion (lines 137–142):** The agent's interpretation of the "stub filter" for bottlenecks is to treat `awaiting-client` L1 items as non-bottleneck contributors. This is a reasonable extension of the v4 stub rule (convention §3) but the convention itself only addresses L2 stub-filter semantics. Please confirm with TP that excluding `awaiting-client` L1s from the waiting-on count is intended (prompt ambiguity #2). Tests were updated in `flags.test.ts` (changed pre-existing `status: "awaiting-client"` fixtures to `in-production`), confirming the new exclusion is deliberate.

### src/lib/runway/flags-detectors.test.ts

- **[PASS]** DRY / hooks: N/A.
- **[PASS]** Coverage: new tests added for completed, on-hold, and the four excluded-statuses bottleneck cases. Good coverage of the new behavior.

### src/lib/runway/flags.test.ts

- **[PASS]** Semantics correctly updated — pre-existing tests that relied on counting `awaiting-client` bottleneck items were rewritten to use `in-production` / `not-started`. Reflects the new spec.
- **[NON-CRITICAL] Possible regression surface:** Rewriting these tests (rather than keeping the original and adding new cases for active statuses) means there is no test asserting that the old broken behavior (counting awaiting-client) is explicitly NOT produced. The new tests cover the new behavior, but the symmetry with `flags-detectors.test.ts` (which has a dedicated "excludes completed, blocked, on-hold, and awaiting-client items" test) is missing at the integration layer.

### src/app/runway/queries.ts

- **[PASS]** Narrow change (two-line addition) — passes `item.status` through `mapWeekItemToEntry` and adds `status !== "completed"` to the past-day filter in `getStaleWeekItems`. Both edits are consistent with v4 contract.

### src/app/runway/queries.test.ts

- **[PASS]** Single test added for completed items — exercises the new filter.
- **[NON-CRITICAL] Missing edge case:** No test for an `in-progress` (non-null) past-due item. The added test only pins `status='completed'` exclusion. A sanity test that confirms `status='in-progress'` past-due items still surface (not silently filtered) would lock the filter to `=== 'completed'` only. Low priority.

### src/app/runway/types.ts

- **[PASS]** Narrow change — adds optional `status?: string | null` to `DayItemEntry`.
- **[NON-CRITICAL] Cross-cut scope concern (prompt ambiguity #4):** `DayItemEntry` is rendered by `src/app/runway/components/day-item-card.tsx`. The new `status` field is additive (optional) and the card component does not reference `status` in its render path — no UI regression. The field is used only by flag-detectors. Scope is acceptable, but because the type lives under `src/app/runway/types.ts` and not a back-end-scoped types file, downstream UI consumers (Chunk 3) will see it available in the props shape. Recommend Chunk 3 explicitly decides whether the L2 status badge should show in the card or stay hidden.

---

## Priority follow-ups (surface in Chunk 2/3 prompts)

1. **Ratify `ownedProjects.inProgress` semantics** — status-based bucket vs. "has active L2" join predicate. Chunk 2 bot tools depend on this.
2. **Decide status-filter behavior for `thisWeek/nextWeek/later` buckets** — whether `status='completed'` future-dated L2s count as "active." Add a test locking the chosen behavior.
3. **Confirm awaiting-client L1 exclusion from bottleneck count** — aligns with v4 convention §3 but extends beyond the L2-only wording.
4. **Fix stale block comment** in `operations-reads.test.ts` lines 4–7 (file-list comment is wrong).

## Unresolved / ambiguous
- Contract spec text "L1s person owns with any active L2s" is phrased inconsistently with the other four bucket names (which are L1 status names). Cannot resolve without TP sign-off.
- Spec does not define multi-week spans in `bucketWeekItem`; agent's fallthrough to `thisWeek` is a reasonable choice but not covered by a test or spec line.
