# QA Report — Chunk 4 Atomic Commits

**Branch:** `feature/runway-pr86-chunk-4` (subject worktree: `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-abdf34ab`)
**Base:** `feature/runway-pr86-base`
**Commits evaluated:** 4

## Summary

- Critical findings: 0
- Non-critical findings: 1
- Pass commits: 4

## Commit ordering (oldest → newest)

1. `cac9df9` — feat(runway): add v4 schema columns for timing, engagement, dependencies
2. `806f79b` — feat(runway): derive project start/end dates from children on L2 write
3. `c414f4a` — feat(runway): backfill v4 start/end dates from existing data
4. `ceb723a` — fix(runway): isolate backfill test from prod snapshot path

The order satisfies the atomic-commits skill dependency rules: **schema before code** (`cac9df9` → `806f79b`), **data migration after code that it depends on** (`c414f4a` after schema + writer), **fix after the buggy artifact** (`ceb723a` follows the backfill it fixes).

## Findings

### cac9df9 — feat(runway): add v4 schema columns for timing, engagement, dependencies

- **[PASS] Atomicity:** One logical change — adds v4 schema columns to three tables plus the paired Drizzle migration SQL and the test-db DDL mirror. Per atomic-commits rule "Schema + migration are one commit", the migration `.sql`, snapshot JSON, and `_journal.json` belong here. The test-db DDL update is required to keep the integration test environment compilable, so it belongs with the schema change.
- **[PASS] Message:** Correct `feat(runway):` conventional type. Body explains WHY the migration is trimmed (unrelated columns already applied via earlier `runway:push`) and flags that columns are nullable with no data migration — exactly the non-obvious context a reviewer needs.
- **[PASS] Self-contained:** Adds nullable columns only; no call sites reference them yet. Schema test (`runway-schema.test.ts`) asserts the new columns exist and is in the same commit. Builds in isolation.
- **[PASS] Tests co-located:** New `describe` blocks appended to existing `runway-schema.test.ts` co-located with the schema file.

### 806f79b — feat(runway): derive project start/end dates from children on L2 write

- **[PASS] Atomicity:** One cohesive purpose — the `recomputeProjectDates` helper and its four write-path call sites (create, update, delete, re-parent). Whitelist additions in `operations-utils.ts` (`startDate`/`endDate`/`blockedBy` in `WEEK_ITEM_FIELDS` + `WEEK_ITEM_FIELD_TO_COLUMN`) are required for `updateWeekItemField` to accept those fields and are tightly coupled to the wiring.
- **[PASS] Message:** `feat(runway):` type is correct; body states the rule, the four wiring points, legacy fallback semantics, and the contract_* exclusion. Conventions followed.
- **[PASS] Self-contained:** Depends on schema columns from `cac9df9` (correct ordering). New integration tests (`operations-writes-week-recompute.test.ts`) ship in this commit, and the counter-assertion updates in the existing `operations-writes-week.test.ts` match the added recompute update() calls (1→2 for the date path). No broken intermediate state.
- **[PASS] Tests co-located:** New test file lives alongside `operations-writes-week.ts` in `src/lib/runway/`. Updates to the sibling test file are in the same commit.

### c414f4a — feat(runway): backfill v4 start/end dates from existing data

- **[PASS] Atomicity:** One logical change — the 2026-04-21 forward migration, its REVERT, and the Vitest suite exercising both. Three files form a single backfill unit; splitting them would leave an un-revertable migration or an untested migration in an intermediate state.
- **[NON-CRITICAL] Message:** Type is `feat(runway):`, which is defensible for a new migration script pair and new tests. Some teams prefer `chore(runway):` or `migration:` for one-shot data migrations; the atomic-commits skill lists both `feat` and `chore` as valid types. Not wrong, but `chore:` would more tightly convey "one-shot operational script" vs. shipped product feature. Body is otherwise excellent: describes forward/reverse, snapshot semantics, test coverage, and records the prod apply result (63 week_items, 23 projects) — which is valuable audit context.
- **[PASS] Self-contained:** Depends on schema (`cac9df9`) and the writer (`806f79b`); ordering is correct. REVERT ships with the forward script, so there is never a commit where forward exists without reverse. Tests ship in the same commit. However — see the NOTE below — the test suite at this commit has a latent defect (shared snapshot path) that is fixed by `ceb723a`. The commit still builds and passes tests at this SHA in isolation (the issue only manifests when run against a populated `docs/tmp/` directory), so atomicity is not violated, but the pattern of "feature with bug in same chunk immediately fixed by next commit" is a yellow-flag for future chunks.
- **[PASS] Tests co-located:** Tests live under `scripts/runway-migrations/` alongside the migration scripts — the project's convention for migration tests.

### ceb723a — fix(runway): isolate backfill test from prod snapshot path

- **[PASS] Atomicity:** One bug fix — introduces `SCHEMA_BACKFILL_V4_SNAPSHOT_PATH` env override, points the test suite at a per-test `/tmp/` path, and commits the reconstructed apply-mode snapshot that was deleted by the buggy test teardown. Snapshot artifact is a consequence of the same incident, belongs with the fix.
- **[PASS] Message:** Correct `fix(runway):` type. Body clearly explains root cause (shared snapshot path between prod apply and Vitest cleanup), the fix (env override with unchanged prod default), and the provenance of the reconstructed snapshot (all pre-values null, reconstructed from current prod; REVERT dry-run verified 63+23 counts match). This is exactly the "why, not what" guidance the skill calls out.
- **[PASS] Self-contained:** Default path unchanged, so prod behavior preserved. Forward + REVERT scripts, test suite, and snapshot artifact are updated together. Builds in isolation.
- **[PASS] Tests co-located:** Test file updated in place; no deferred "tests later" split.

## Cross-commit observations

- **Dependency ordering is clean.** Schema → writer → data migration → test-isolation fix. Each commit's runtime dependencies are satisfied by an earlier commit in the series. `git bisect` between any pair should behave correctly.
- **No bundled unrelated changes.** Every file touched in every commit has a clear connection to that commit's stated purpose.
- **Claude co-author trailer:** None of the four commits include the `Co-Authored-By:` trailer the skill's commit template specifies. This is a NON-CRITICAL style deviation, consistent across all four commits (likely project convention on this branch), and does not affect atomicity or bisectability. Not flagged per-commit to avoid noise.
- **The `c414f4a` → `ceb723a` pattern** (land a feature, then immediately fix a test-isolation bug in it) is functional but suggests the backfill should have been tested with path isolation from the outset. Not a restructure blocker — `ceb723a` correctly lands as a follow-up `fix:` rather than an amend — but worth noting for future chunk authoring discipline.

## Overall recommendation

**MERGE**

All four commits pass the atomic-commits criteria. The single non-critical finding (`c414f4a` could arguably be typed `chore` instead of `feat`) is a style preference, not a defect. Commit ordering supports `git bisect`, each commit is self-contained and buildable in isolation, tests ship with their subject code, and messages explain the WHY. No restructure needed.
