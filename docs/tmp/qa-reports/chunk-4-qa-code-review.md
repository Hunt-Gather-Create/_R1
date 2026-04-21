# QA Report — Chunk 4 Code Review

**Branch:** `feature/runway-pr86-chunk-4`
**Base:** `feature/runway-pr86-base`
**Diff commit range:** `cac9df9..ceb723a` (4 commits)
**Files reviewed:** 14

## Summary
- Critical findings: **1**
- Non-critical findings: **9**
- Pass-through files / checks: many (noted inline)
- **Overall recommendation: REWORK** (1 critical blocker on snapshot/SQL drift; remaining items are non-critical but worth addressing before cascade chunks build on top)

---

## Top 3 findings

1. **CRITICAL — Drizzle snapshot and SQL migration are out of sync.** `0001_melted_weapon_omega.sql` intentionally omits `ALTER TABLE` statements for columns that already exist in prod (`clients.nicknames`, `clients.updated_at`, `team_members.full_name`, `team_members.nicknames`, `team_members.updated_at`, `updates.batch_id`, etc.), but `meta/0001_snapshot.json` declares those columns as part of the current declared state. Any future `drizzle-kit generate` will diff against this incorrect baseline, and any fresh-DB replay of migrations (local clone, staging rebuild, future CI integration) will silently skip those columns — the snapshot says they exist, so no migration is emitted.

2. **NON-CRITICAL — `recomputeProjectDates` runs outside the write transaction in all 4 call sites.** `updateWeekItemField`, `createWeekItem`, `deleteWeekItem`, and `linkWeekItemToProject` commit the child write first, then call `recomputeProjectDates`. A crash between the two leaves the project's derived dates stale. Not data-loss, but weakens the derivation invariant.

3. **NON-CRITICAL — Reconstructed apply-mode snapshot at `docs/tmp/schema-backfill-v4-2026-04-21-snapshot.json` is not a real pre-state capture.** Commit `ceb723a` is honest about this: the original was deleted by the test's afterEach, then reconstructed from current prod state under the assumption "all pre-values were null." If any `update_project_field` hit a `start_date` / `end_date` between apply and reconstruction, REVERT would overwrite live data with null. Operator needs to be aware that REVERT is only safe if nothing has touched those columns since apply.

---

## Findings by file

### `src/lib/db/runway-schema.ts`
- **PASS** DRY: new v4 columns are idiomatic Drizzle, no repetition.
- **PASS** Prop drilling: N/A.
- **PASS** Hooks/context: N/A.
- **PASS** Test coverage: `runway-schema.test.ts` asserts all 9 new columns are present on the 3 tables.
- **PASS** Security: nullable columns with no FK constraints; comments call out the design decision (read-layer overrides, no self-reference FK).

### `src/lib/db/runway-schema.test.ts`
- **PASS** Test coverage: adds 3 new `it` blocks covering projects/weekItems/updates v4 columns. Minimal but appropriate for a shape-only test.

### `src/lib/runway/operations-utils.ts`
- **PASS** DRY: extending the whitelist in one place propagates everywhere.
- **NON-CRITICAL** Test coverage: the `WEEK_ITEM_FIELD_TO_COLUMN` object is a 1:1 identity map for all 12 fields. Could be derived (`Object.fromEntries(WEEK_ITEM_FIELDS.map((f) => [f, f]))`) but preserving explicit literal keeps `keyof typeof weekItems.$inferInsert` type inference sharp. Acceptable as-is; flagging for awareness.

### `src/lib/runway/operations-writes-week.ts`
- **PASS** DRY: `recomputeProjectDates` is the canonical derivation helper, called from all 4 write sites. Good consolidation.
- **NON-CRITICAL** Hooks/context: `recomputeProjectDates` runs OUTSIDE the transaction in all 4 call sites (lines 194, 294, 366, 451–454). A process crash between child write commit and recompute leaves project derived dates stale. For `updateWeekItemField` in particular, the reverse cascade to `project.dueDate` IS wrapped in a transaction (lines 251–265) — so the code already has the pattern and was deliberately not extended here. Recommendation: move the recompute inside the `db.transaction` block in each write path.
- **NON-CRITICAL** Edge case: string comparison `start < minStart` / `end > maxEnd` (lines 125–127) assumes strict ISO-8601 `YYYY-MM-DD`. Works given the column contract, but a stray legacy value (`"04/21/2026"`, `"2026-04-21T00:00:00Z"`) would produce silent ordering bugs. Low risk because schema comments say "ISO date", but no runtime guard.
- **NON-CRITICAL** Efficiency: `recomputeProjectDates` unconditionally issues `UPDATE projects SET start_date=?, end_date=?, updated_at=now()` even when nothing changed. This bumps `updated_at` on every child write. The backfill script avoids this by diffing first (lines 130–138); the runtime helper does not. Consider a pre-read to skip no-op updates.
- **NON-CRITICAL** Test coverage gap: `linkWeekItemToProject`'s dual recompute (previous + new project) is NOT covered by either `operations-writes-week.test.ts` or `operations-writes-week-recompute.test.ts`. Happy-path gap on a multi-write fan-out.
- **NON-CRITICAL** Test coverage gap: `createWeekItem` and `deleteWeekItem` recompute calls are NOT unit-tested in `operations-writes-week.test.ts`. Only `updateWeekItemField` had its call-count assertions adjusted. Integration test covers `recomputeProjectDates` in isolation but doesn't exercise the wire-up from create/delete.
- **PASS** Security: `recomputeProjectDates` reads children by `projectId` only — no user-controlled SQL. `recomputeProjectDates(null | undefined | "")` early-returns before touching the DB.

### `src/lib/runway/operations-writes-week.test.ts`
- **NON-CRITICAL** Convention: the test mocks `WEEK_ITEM_FIELDS` inline (lines 34–40). When a future chunk adds another v4 field to the real constant, this mock must be updated manually. Drift-prone; acceptable but note.
- **PASS** The adjusted call-count assertions (3 instead of 2, 2 instead of 1) correctly reflect the new recompute write. Good update.

### `src/lib/runway/operations-writes-week-recompute.test.ts`
- **PASS** Test coverage: 7 scenarios — empty children, single-day fallback, MIN/MAX across staggered children, legacy-`date` fallback, null/undefined/empty projectId, reset-to-null after all children deleted, contract_* columns ignored. Strong coverage of the derivation rule in isolation.
- **PASS** Test quality: uses real libsql in-memory, proper seed teardown, meaningful assertions. No implementation-detail testing.
- **NON-CRITICAL** Missing scenario: does NOT test the cascade from `createWeekItem` / `updateWeekItemField` / `deleteWeekItem` / `linkWeekItemToProject` — i.e., the wire-up from write to recompute. Combined with the gap in `operations-writes-week.test.ts`, the create/delete/link paths have no end-to-end coverage that the recompute actually fires.

### `src/lib/runway/test-db.ts`
- **PASS** DDL correctly adds all 9 new columns matching the schema.

### `drizzle-runway/0001_melted_weapon_omega.sql`
- **CRITICAL** Convention break: the SQL file explicitly trims `ALTER TABLE` statements for columns that already exist in prod from earlier `runway:push` runs (comment on lines 2–5). This is understandable FOR THE APPLY AGAINST PROD, but the comment and scope-trim are not reflected in the matching `meta/0001_snapshot.json`. A Drizzle migration file should be either (a) the complete diff from the previous snapshot, or (b) annotated with a `-- Not to be replayed against fresh DB` warning AND paired with a separate bootstrap file. Currently the SQL lies about what it does relative to the snapshot. See snapshot finding below for the dependent impact.

### `drizzle-runway/meta/0001_snapshot.json`
- **CRITICAL** Snapshot/SQL drift. The snapshot declares `clients.nicknames`, `clients.updated_at`, `team_members.full_name`, `team_members.nicknames`, `team_members.updated_at`, `updates.batch_id` (verified via grep: `0000_snapshot.json` has 0 matches for these columns; `0001_snapshot.json` has matches for each). The SQL migration does NOT create them. Consequences:
  1. A fresh DB seeded by replaying migrations in order will end up with a schema that does NOT match the snapshot, but `drizzle-kit` will think it does.
  2. The next `drizzle-kit generate` will diff the runtime schema against this incorrect baseline. If someone renames or drops `clients.nicknames`, the generator will emit a no-op (the snapshot says the column exists; the codegen sees it should exist).
  3. Any CI job that asserts "snapshot matches SQL output" will fail or be misleading.
- **Recommendation:** either (a) add the missing `ALTER TABLE ... ADD COLUMN` statements guarded with Drizzle's breakpoint comments (the comment note "already exist in prod" doesn't prevent `IF NOT EXISTS` semantics from being safe — though SQLite doesn't support `IF NOT EXISTS ADD COLUMN`, so the equivalent is a bootstrap 0000-addendum), or (b) explicitly regenerate 0000 to include everything prod actually has, then make 0001 a clean Chunk-4-only diff. Option (b) is the cleanest.

### `drizzle-runway/meta/_journal.json`
- **PASS** Journal entry is well-formed and matches the new migration tag.

### `scripts/runway-migrations/schema-backfill-v4-2026-04-21.ts`
- **PASS** DRY: derivation logic inside the script is self-contained and not duplicated from `recomputeProjectDates` — it operates on a fully-loaded in-memory dataset rather than per-project, which is a legitimate reason not to share.
- **NON-CRITICAL** Drift risk: the backfill's derivation loop (lines 121–127) and the runtime `recomputeProjectDates` loop (lines 74–89 of `operations-writes-week.ts`) implement the SAME rule. If the v4 derivation rule changes, both must be updated. Consider exporting a shared pure function `deriveProjectDatesFromChildren(children: {startDate, endDate}[]): {min, max}` used by both sites.
- **PASS** Snapshot capture: writes dry-run and apply snapshots correctly. Env-var override is clean.
- **PASS** Logging: ctx.log output is informative, samples are truncated at 3.
- **PASS** Idempotency: `isNull(weekItems.startDate) AND isNotNull(weekItems.date)` filter means second run finds no candidates. Verified by the test.

### `scripts/runway-migrations/schema-backfill-v4-2026-04-21-REVERT.ts`
- **PASS** Defensive: aborts if snapshot missing, validates shape, warns on dry-run mode snapshot.
- **NON-CRITICAL** Operator risk: see top-3 finding #3. The REVERT script blindly writes `previousStartDate`/`previousEndDate` from the snapshot. If the snapshot was reconstructed (as it was), and any row was touched between apply and reconstruction, REVERT will overwrite that edit with null. The script has no guard for "column value has changed since apply" — it can't, because it doesn't capture a `currentAtApply` value for comparison. Document this limitation in the script header or the REVERT runbook.

### `scripts/runway-migrations/schema-backfill-v4-2026-04-21.test.ts`
- **PASS** Per-test isolation via `randomUUID` suffix under `/tmp/` is the correct fix for the clobbering problem. `afterEach` cleans up both apply and dry-run variants.
- **PASS** Test scenarios: dry-run no-write + snapshot, apply + derivation + snapshot, idempotent second apply, REVERT missing-snapshot abort, REVERT round-trip, dry-run snapshot warning. Good coverage.
- **NON-CRITICAL** Happy-path gap: no test exercises the case where a row has BOTH `start_date` already populated AND `date` populated (pre-existing v4 row). The filter `isNull(startDate) AND isNotNull(date)` should exclude it from Step 1, but a test asserting the filter works (not just "second run is no-op") would be more thorough.

### `docs/tmp/schema-backfill-v4-2026-04-21-snapshot.json`
- **NON-CRITICAL** Acceptable-with-caveat: this is the reconstructed apply-mode snapshot (485 lines). Its existence IS the rollback artifact. Whether it's trustworthy depends on the claim that nothing touched `start_date` / `end_date` between apply and reconstruction. That claim is plausible because the columns were net-new in this chunk, but there is no programmatic proof. See top-3 finding #3.

---

## Cross-cutting observations

1. **v4 convention annotations are consistent** — every new column and new code path has a `// v4 convention (2026-04-21)` comment. Good discipline; future archaeologists will thank you.
2. **`engagement_type`, `contract_start`, `contract_end`, `blocked_by` are added but not written anywhere** — that's correct for this chunk per the plan ("populated per-client during Wave 1 data work"). No test coverage needed yet; flagging so the gap isn't mistaken for an oversight.
3. **`triggered_by_update_id` is added to `updates` but not written** — same as above. Slot-allocation, to be wired by the cascade audit chunk.
4. **Backfill logic and runtime logic diverge subtly:** backfill's in-memory derivation (lines 121–127 of the backfill) uses `child.startDate` directly (the fallback is applied earlier via `step1Patch`), while the runtime helper uses `child.startDate ?? child.date`. Both arrive at the same result for the backfill's input, but the semantics differ. Consolidating to a shared helper (see NON-CRITICAL on the backfill file) removes this concern.

---

## Ambiguities the QA agent could not resolve

1. **Was the snapshot/SQL drift intentional or incidental?** The SQL comment explicitly states it was trimmed to keep the migration "scoped to Chunk 4." If intentional, the project has accepted a long-term footgun; if incidental (e.g., drizzle-kit automatically regenerated the snapshot from schema.ts and the SQL was hand-trimmed), it's fixable by regenerating. Operator should confirm which of 0000 or 0001 is supposed to be the source of truth for those "excluded" columns.
2. **Is there a policy on whether the pre-cascade TP-documented "ambiguity items" (migration SQL scope, linkWeekItemToProject wiring, test snapshot path isolation, legacy-date fallback, date mirror on create) were resolved correctly?** Based on the diff, 4 of 5 are resolved (snapshot isolation via env var, linkWeekItemToProject dual-recompute, legacy fallback in runtime helper, date→startDate mirror on create). The 5th — migration SQL scope — is the CRITICAL finding; resolved in a way that ships but is risky long-term.
3. **Is the operator aware that `docs/tmp/schema-backfill-v4-2026-04-21-snapshot.json` is a reconstruction, not a capture?** The commit message says so, but if this PR is reviewed without reading that specific commit, a reviewer might assume it's a genuine pre-state dump.

---

## Overall recommendation

**REWORK** on the critical snapshot/SQL drift (blocker that persists in the repo regardless of prod state). Non-critical items are worth addressing but do not block Chunk 4 merging if the snapshot issue is resolved. Specifically:

- **Must fix before merge:** regenerate `meta/0001_snapshot.json` so it matches the SQL, OR expand the SQL to match the snapshot (preferred). The mismatch is a long-term liability for any dev who clones the repo.
- **Should fix before cascade chunks land:** move `recomputeProjectDates` inside the transaction in all 4 write sites; extract shared derivation helper used by backfill and runtime.
- **Nice to fix:** add skip-no-op guard in `recomputeProjectDates`; add integration tests for the 4 write-path cascades; document REVERT-reconstruction limitation in the script header.
