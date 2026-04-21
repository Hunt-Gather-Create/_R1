# QA Report — Chunk 1 Atomic Commits

**Branch:** `feature/runway-pr86-chunk-1`
**Base:** `feature/runway-pr86-base`
**Worktree:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-acce433e`
**Commits evaluated:** 5

## Summary

- Critical findings: 1
- Non-critical findings: 2
- Pass commits: 4 (fully passing) / 1 (with one critical, one non-critical)

## Commit order (oldest -> newest)

1. `4c72318` fix(runway): skip completed items in getStaleWeekItems
2. `86edf0b` fix(runway): skip completed and on-hold items in detectStaleItems
3. `8d8839b` fix(runway): exclude completed L2 items from detectResourceConflicts
4. `23d56eb` fix(runway): exclude non-active statuses from detectBottlenecks
5. `c5d35fc` feat(runway): rewrite getPersonWorkload to v4 contract

## Findings

### 4c72318 — fix(runway): skip completed items in getStaleWeekItems

- **[PASS] Atomicity:** Single logical change — adds `ne(weekItems.status, 'completed')` filter in `src/app/runway/queries.ts::getStaleWeekItems`. 2 files, 20 insertions, 2 deletions.
- **[PASS] Message:** `fix:` type correct. Body explains WHY ("Past-due week items with status='completed' were surfacing as stale. v4 convention: status-aware query filters exclude completed work from active views.").
- **[PASS] Self-contained:** New test is additive; query change matches test expectation. Would build and pass at this SHA in isolation.
- **[PASS] Tests co-located:** Adds test in `src/app/runway/queries.test.ts` in the same commit.

### 86edf0b — fix(runway): skip completed and on-hold items in detectStaleItems

- **[PASS] Atomicity:** Single logical change in `flags-detectors.ts::detectStaleItems`. 2 files, 28 insertions, 0 deletions.
- **[PASS] Message:** `fix:` type correct. Body explains WHY ("terminal statuses should not trigger active flags").
- **[PASS] Self-contained:** Additive only; no existing tests rely on the prior behavior (stale items with completed/on-hold status were previously not asserted against). Builds cleanly in isolation.
- **[PASS] Tests co-located:** Adds 2 new test cases in `flags-detectors.test.ts`.

### 8d8839b — fix(runway): exclude completed L2 items from detectResourceConflicts

- **[PASS] Atomicity:** Single logical change — plumbs L2 `status` through `DayItemEntry` and excludes `status='completed'` in `detectResourceConflicts`. 4 files, 21 insertions, 0 deletions. The type addition in `src/app/runway/types.ts` and the `queries.ts` projection are tightly coupled to the detector change (data has to flow through for the filter to see it), so grouping them is correct per the atomic-commits rule "Import changes follow their usage" / "Types before implementation" when the consumer is in the same commit.
- **[PASS] Message:** `fix:` type correct. Body explains WHY and names the specific mechanism ("Pipes L2 status through DayItemEntry and skips status=completed items when tallying resource conflicts").
- **[PASS] Self-contained:** Type addition, data projection, and detector filter ship together; existing tests unaffected. Builds in isolation.
- **[PASS] Tests co-located:** Adds new test case in `flags-detectors.test.ts`.

### 23d56eb — fix(runway): exclude non-active statuses from detectBottlenecks

- **[PASS] Atomicity:** Single logical change in `detectBottlenecks`. Adds `BOTTLENECK_EXCLUDED_STATUSES` set and early-continue. 2 files, 55 insertions, 1 deletion.
- **[PASS] Message:** `fix:` type correct. Body explains WHY ("terminal or already-flagged stubs ... should not contribute to the bottleneck signal").
- **[CRITICAL] Self-contained:** Commit does NOT build/pass-tests in isolation. The behavior change breaks two pre-existing assertions in `src/lib/runway/flags.test.ts` (the `"flags person as waitingOn on 3+ items"` and the subsequent describe block at lines ~205 and ~235 on base) because those fixtures use `status: "awaiting-client"`, which this commit now excludes. Those fixtures are updated only later, in `c5d35fc`. `git bisect` landing at this SHA would see red tests in `flags.test.ts` even though the bug being diagnosed is unrelated. The commit message even acknowledges the missing update ("Updated existing bottleneck tests to use active statuses" — but that update is in c5d35fc, not here).
- **[PASS] Tests co-located:** Adds 2 new test cases in `flags-detectors.test.ts` that cover the new exclusion behavior. The issue is that the separate pre-existing test file (`flags.test.ts`) was missed here.

### c5d35fc — feat(runway): rewrite getPersonWorkload to v4 contract

- **[NON-CRITICAL] Atomicity:** Bundles three logically distinct pieces:
  1. v4 rewrite of `getPersonWorkload` in `operations-reads-week.ts` (+313 lines) with its new tests in `operations-reads-week.test.ts` (+379 lines) — the core feature.
  2. Rewrite of 3 tests in `operations-reads.test.ts` (+81/-49) against the new contract — correctly co-located with piece 1.
  3. Fixture update in `flags.test.ts` (+7/-7) swapping `awaiting-client` -> `in-production`/`not-started` to accommodate the earlier `23d56eb` bottleneck change. This piece belongs with `23d56eb`, not here.
  Pieces 1 and 2 together are the feature. Piece 3 is a delayed test fix that masks a broken-intermediate at commit 4.
- **[PASS] Message:** `feat:` type is correct for a contract rewrite. Body is thorough, explains WHY (Chunks 2/3 consumers) and enumerates behavioral details (bucketing, timezone, L1 owner-only, stub filter, soft flags, parallel fetch). Does note the flags.test.ts update, which is honest but underscores the bundling issue.
- **[PASS] Self-contained:** At this SHA the branch builds and tests pass. This commit is what makes `23d56eb` green again, which is the source of the critical finding above.
- **[PASS] Tests co-located:** New `getPersonWorkload` behavior is covered by extensive new cases in `operations-reads-week.test.ts` added in this same commit. The v4-contract test rewrites in `operations-reads.test.ts` are correctly bundled with the rewrite (per the skill rule "Related changes stay together — a new function and its tests go in the same commit").

## Overall recommendation

**RESTRUCTURE (minor)**

The chunk is mostly clean. Four of five commits are textbook atomic. One critical structural issue exists: commit `23d56eb` breaks `flags.test.ts` in isolation because the fixture update for its behavior change is deferred to `c5d35fc`. This would trip `git bisect` on any unrelated regression search across this range.

### Proposed restructure (do NOT execute — advisory)

Minimal fix: move the `flags.test.ts` hunk from `c5d35fc` into `23d56eb`.

Proposed new commit shape:

1. `4c72318` fix(runway): skip completed items in getStaleWeekItems — UNCHANGED
2. `86edf0b` fix(runway): skip completed and on-hold items in detectStaleItems — UNCHANGED
3. `8d8839b` fix(runway): exclude completed L2 items from detectResourceConflicts — UNCHANGED
4. `23d56eb'` fix(runway): exclude non-active statuses from detectBottlenecks
   - add the `flags.test.ts` fixture swap (awaiting-client -> in-production/not-started) to this commit so it is self-contained
5. `c5d35fc'` feat(runway): rewrite getPersonWorkload to v4 contract
   - drops `flags.test.ts` changes
   - drops the "Updated existing bottleneck tests..." paragraph from the message (no longer relevant here)
   - keeps the `operations-reads.test.ts` rewrites (these are genuinely part of the v4 contract rewrite)

Result: every commit builds and passes tests in isolation, bisect-safe, each commit's message is self-consistent with its diff.

### Alternative: accept as-is

If the cost of a rebase outweighs bisect integrity for this chunk (given it will merge as a squashed PR or into `feature/runway-pr86-base` as a group), the current structure is acceptable — the branch tip is green, the logical intent is clear, and no consumer will bisect between `23d56eb` and `c5d35fc`. Flagging here so TP can decide.

## Unresolved / notes

- `8d8839b` pipes a new `status` field through `DayItemEntry`. Grouping the type addition with the consumer inside the same commit is correct per the skill. If downstream consumers (not in this chunk) rely on that type shape, they will land cleanly.
- `c5d35fc`'s `operations-reads-week.test.ts` grew by +379 lines. All the new coverage targets the v4 rewrite directly (bucketing, tz, stub filter, soft flags). This is correctly bundled with the implementation and is not a candidate for a separate "test:" commit.
- No sign of debug logging, console statements, or incidental formatting drift in any of the 5 commits.
- Read-only evaluation: no rebase, amend, reset, or push performed.
