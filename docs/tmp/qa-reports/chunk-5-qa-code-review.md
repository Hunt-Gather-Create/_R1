# QA Report — Chunk 5 Code Review

**Branch:** `feature/runway-pr86-chunk-5`
**Base:** `feature/runway-pr86-base`
**Diff commit range:** `cb62a68..2773dcf` (12 commits)
**Files reviewed:** 31 (21 code/schema, 4 docs, 6 test files)

## Summary

- Critical findings: **0**
- Non-critical findings: **4**
- Pass-through files: 27

## Scrutiny-point verdicts

### 1. `recomputeProjectDates` inside write transactions — PASS with one inconsistency

All four call sites are wrapped:

- `createWeekItem` — tx wraps `insert(weekItems)` + `recomputeProjectDatesWith(tx, projectId)`. Child is visible inside the tx (libSQL/SQLite reads own writes), so the aggregate sees it. ✓
- `updateWeekItemField` — tx wraps child update + optional reverse-cascade (`projects.dueDate`) + recompute. Recompute only runs on date fields (`date | startDate | endDate`). ✓
- `deleteWeekItem` — tx wraps delete + recompute. ✓
- `linkWeekItemToProject` — tx wraps reparent + recompute of previousProjectId + recompute of new projectId. ✓

`recomputeProjectDatesWith(executor, projectId)` narrows the type to `Pick<..., "select" | "update">`, accepting either `db` or `tx`. Good pattern.

Race-safety: each recompute does `SELECT children → SELECT current row → UPDATE row` inside the same tx. SQLite/libSQL serializes writes, so no lost update within a single tx boundary. The updated_at skip (no-op when derived values unchanged) is a nice-to-have and is covered by tests.

**Deadlock patterns:** None. libSQL is single-writer; nested transactions are not entered anywhere in the diff. The recompute helper only reads/writes `projects` and reads `week_items`, never reaching back into a parent write function.

**Non-critical consistency gap:** `updateProjectField` (Chunk 4, pre-existing) already opens a tx for the project update + forward cascade to deadline week_items. That tx does not call `recomputeProjectDatesWith` when the field is `startDate` or `endDate`. Out of scope for Chunk 5 (those fields aren't in the caller path — they are derived-only), but worth flagging: if a future caller starts writing `projects.startDate` via `updateProjectField`, it will bypass the parent-recompute transaction. Recommend adding an allow-list comment on PROJECT_FIELDS clarifying that `startDate`/`endDate` are intentionally omitted.

### 2. Drizzle 0001 expansion + 0002 addition — PASS

- `0001_melted_weapon_omega.sql` now contains the five prod-drift additions (`clients.nicknames`, `team_members.full_name`, `team_members.nicknames`, `team_members.updated_at`, `updates.batch_id`) alongside the originally-listed v4 columns.
- `0002_view_preferences_table.sql` + `meta/0002_snapshot.json` + `_journal.json` entry captures the `view_preferences` table that had been created by a prior ad-hoc `runway:push` with no `.sql` artifact.
- Snapshot JSON aligns with `runway-schema.ts` (verified field names/types against the schema definitions across all 7 tables).
- Comment in 0001 correctly explains drizzle-kit's tag-based applied-migrations tracking, so prod (which has `0001_melted_weapon_omega` with the trimmed form already recorded) will NOT re-run.
- Fresh DB replay via `drizzle-kit migrate` from empty should now produce the runtime schema exactly.

**Non-critical:** the header comment in 0001 claims "drizzle-kit tracks applied migrations by `tag` (filename), not file hash" — this is correct for most drivers but the journal does record `when` timestamps and drizzle-kit can warn on tag-but-different-content in some versions. Not a correctness issue; the operator confirmed prod already has 0001 applied.

### 3. view-preferences no-such-table fallback tests — PASS with one misleading comment

Two new tests cover the branch:

- `"falls back to defaults when view_preferences table does not exist"` — sets `mockSelectError = SQLITE_ERROR: no such table...`, expects `prefs.inFlightToggle === true` (default). Exercises the `catch` branch in `getViewPreferences` specifically. ✓
- `"re-throws unrelated DB errors instead of swallowing"` — uses `"some other sqlite error"`. The regex `/no such table|SQLITE_ERROR/i` contains a literal underscore between `SQLITE` and `ERROR`, so "some other sqlite error" does NOT match (the tokens `sqlite` and `error` are not contiguous with an underscore). Test correctly asserts the re-throw. ✓
- `"setViewPreferences — returns merged object when table does not exist"` — the test comment claims "First select (for the merge) succeeds with empty defaults; the subsequent select triggers the table-missing path in setViewPreferences." In practice `mockSelectError` is non-null from test start, so the first select (inside `getViewPreferences` called by `setViewPreferences`) already throws and hits the `getViewPreferences` catch. Then the second select (inside `setViewPreferences`'s own try) also throws and hits its catch. The test still asserts correct behavior (returns `{inFlightToggle: false}`), but the narrative in the comment is wrong. **Non-critical** — comment drift, not a correctness bug.

### 4. `normalizeResourcesString` write-path wiring — NON-CRITICAL GAP

Wired into:

- `createWeekItem` — `resources ? normalizeResourcesString(resources) : null` ✓
- `updateWeekItemField` — `typedField === "resources" ? normalizeResourcesString(newValue) : newValue` ✓
- `addProject` — `resources ? normalizeResourcesString(resources) : null` ✓
- `updateProjectField` — `typedField === "resources" ? normalizeResourcesString(newValue) : newValue` ✓
- `updateClientField` — `typedField === "team" ? normalizeResourcesString(newValue) : newValue` ✓

**Missed write path: `createClient(params.team)`** — `team` is stored in the same v4 role-prefix roster format as L1/L2 resources and is normalized on update, but NOT on create. A client created via MCP `create_client` with `"CD: Lane => Dev: Leslie"` would be persisted with an alt-arrow until an update pass runs. Behavior diverges from `updateClientField`, and the docstring on `normalizeResourcesString` explicitly lists wired call sites but omits `createClient`. Recommend a follow-up commit wiring the helper into `createClient` (single-line change). **Non-critical** — operator has 7 existing clients already normalized; no active exposure.

Minor edge-case observation on the helper itself: `normalizeResourcesString(null)` returns `""` (empty string), not `null`. Because `updateProjectField` / `updateClientField` type `newValue: string` (non-nullable), callers cannot pass `null` to those paths anyway — but the create-path pattern `resources ? normalize(resources) : null` correctly preserves null. No bug, just worth noting that the helper is not null-preserving by itself.

## Findings (per file)

### `src/lib/runway/operations-writes-week.ts`
- [PASS] DRY: `recomputeProjectDatesWith` consolidates the tx-aware variant. `recomputeProjectDates` now delegates.
- [PASS] Security/edge cases: all 4 write paths tx-wrapped; SQLite serialization keeps the parent recompute atomic with the child write.
- [PASS] Test coverage: new `operations-writes-week-recompute.test.ts` covers skip-when-unchanged + bump-when-changed + createWeekItem normalization round-trip.

### `src/lib/runway/operations-writes.ts`
- [PASS] DRY: cascade tuple pattern (`Array<{id, title}>`) captures needed fields inside tx; removes post-commit `getLinkedWeekItems` re-query. Good.
- [PASS] Security/edge cases: removes the race window where a concurrent write could change item ids/titles between tx commit and audit insertion.

### `src/lib/runway/operations-writes-project.ts`
- [PASS] Normalize wiring on `resources`. Cascade-forward audit trail preserved.

### `src/lib/runway/operations-writes-client.ts`
- [NON-CRITICAL] Normalize wiring on `updateClientField` for `team` — good. **Paired finding:** `createClient` accepts `team?: string` but does NOT normalize it on insert. See scrutiny point 4.

### `src/lib/runway/operations-add.ts`
- [PASS] `addProject` normalizes `resources` on insert. Null preserved.

### `src/lib/runway/operations-utils.ts`
- [PASS] PROJECT_FIELDS extended with `engagementType`, `contractStart`, `contractEnd`. PROJECT_FIELD_TO_COLUMN covers all three. Test `operations-utils.test.ts` asserts this explicitly.
- [NON-CRITICAL] `normalizeResourcesString` docstring lists "wired into" call sites but omits `createClient`. Update the comment once the helper is wired there (or remove `createClient` from scope with a rationale).

### `src/lib/runway/flags-detectors.ts`
- [PASS] `detectPastEndL2s` + `isPastEndInProgress` predicate. Dedupe by item id with title+account fallback. Severity threshold at 14 days.
- [PASS] Test coverage: 10 new tests covering boundary (end === today), single-day items, status=completed exclusion, critical/warning threshold, dedupe, owner surface, both-rails scan.
- [NON-CRITICAL] `toISODateString(now)` uses LOCAL time, not Chicago TZ. Other runway read paths (e.g. `getPersonWorkload`, `queries.ts`) use `chicagoISODate(now)` for the "today" boundary. Server timezone is UTC on Vercel, so "today" per this detector will be UTC-today, not Chicago-today. Between 00:00 UTC and 06:00 UTC (Central) a just-past-end L2 could flicker into the flag one day early, or (Central late evening) miss a day. Matches pre-existing behavior in other `flags-detectors` detectors (they all use `toISODateString(now)`), so this is a pattern the module already carries — not introduced here. Worth documenting but not a Chunk 5 regression.

### `src/lib/runway/flags.ts`
- [PASS] `FlagType` extended with `past-end-l2`; detector added to `analyzeFlags` pipeline.

### `src/lib/runway/operations-reads-project-status.ts`
- [PASS] Malformed `blocked_by` now logs a structured warning instead of silent `catch {}`. `rawLength` included (avoids leaking content to logs). Read still returns successfully.
- [PASS] Test covers the warning + continued read path.

### `src/lib/runway/operations-reads-week.ts`
- [PASS] `bucketWeekItem` gates completed L2s out of forward buckets. Overdue bucket already excluded completed pre-Chunk-5 (the `status !== COMPLETED_L2` check before the overdue arm).
- [PASS] Test: `"excludes completed L2s from forward buckets..."` covers thisWeek/nextWeek/later + totalActiveWeekItems.

### `src/app/runway/components/in-flight-section.tsx`
- [PASS] `today` derivation moved inside `useMemo`; dependency array changed from `[enabled, weekItems, today]` to `[enabled, weekItems, nowISO]`. Removes the per-render allocation and stabilizes the memo.

### `src/app/runway/queries.ts`
- [PASS] Cross-week blocker invariant documented on `resolveBlockedByRefs`. Guides future callers away from narrowing the map scope.

### Drizzle migration files
- `drizzle-runway/0001_melted_weapon_omega.sql` — PASS (see scrutiny point 2)
- `drizzle-runway/0002_view_preferences_table.sql` — PASS (new)
- `drizzle-runway/meta/0002_snapshot.json` — PASS (matches schema)
- `drizzle-runway/meta/_journal.json` — PASS (new tag appended)

### Test infrastructure
- `src/lib/runway/operations-writes-test-helpers.ts` — PASS. `mockTx.select` added so `recomputeProjectDatesWith(tx, ...)` sees test stubs. Exposes `mockSelect`, `mockSelectResult`.
- `src/lib/runway/operations-writes-week.test.ts` — PASS. Routes `mockDb.select` and `mockTx.select` through the same chain. `mockDeleteFn` flipped from `db.delete` to `tx.delete` since `deleteWeekItem` now runs its delete inside the tx.
- `src/lib/runway/view-preferences.test.ts` — PASS (see scrutiny point 3 re: misleading comment in setViewPreferences test).

### Docs
- `docs/tmp/batch-update-audit-2026-04-21.md` — new. Honest audit: filter+multi-field "not supported as primitive" (correct by design); dry-run partial (acceptable); batchId gap on Soundly noted; bulk L2-owner backfill pattern documented. No code changes prescribed.
- `docs/tmp/pr86-message-draft.md` — rewritten. Covers schema, server, UI, data, deployment notes, verification steps.
- `docs/tmp/cc-prompts/cc-prompt-remaining-6-postmerge.md` — trimmed/updated. No concerns.

## Overall recommendation

**MERGE** — with one optional follow-up.

All 14 Wave 1/2 debt items are addressed. No critical findings. The four non-critical findings are:

1. `createClient` missing `normalizeResourcesString` on `team` (paired with updateClientField wiring).
2. `setViewPreferences` test comment is misleading (test correctness is fine).
3. `toISODateString` vs `chicagoISODate` inconsistency in `detectPastEndL2s` — pre-existing module pattern, not introduced here.
4. Docstring for `normalizeResourcesString` listing wired call sites omits `createClient`.

None blocks merge. Recommend folding finding #1 into a follow-up single-line commit before opening the PR (createClient + docstring in one change), or deferring to a post-merge touchup with the other Wave-3 loose ends.

## Unresolved

- Whether the operator wants to also wire `normalizeResourcesString` into `createClient` for Chunk 5 or punt to a post-merge commit. Recommendation: do it now (two-line change + test), but not blocking.
- The `detectPastEndL2s` TZ question (local vs Chicago) — consistency with the rest of `flags-detectors.ts` argues for leaving it, but the "today" semantics drift is worth a known-debt entry if not fixed.
