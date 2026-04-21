# QA Report — PR #86 Chunk 4 Data Integrity

**Migration:** `schema-backfill-v4-2026-04-21` (applied to Turso prod)
**Schema push:** `pnpm runway:push` — 9 new columns added
**Backfill applied:** 2026-04-20 ~23:06:23 UTC (per `updatedAt` on affected rows)
**Pre-snapshot:** `docs/tmp/schema-backfill-v4-2026-04-21-snapshot.json` (reconstructed; note: test teardown deleted original)
**Post-snapshot:** `data/runway-snapshot.json` (fresh pull at 2026-04-20T23:18:20Z, prod target)
**Records touched:** 86 (63 week_items + 23 projects)

## Summary
- CRITICAL unexplained: **0**
- CRITICAL missing expected: **0**
- INCIDENTAL: 86 `updatedAt` timestamps (expected — backfill writes bump them)
- PASS: all 86 expected changes observed

**Confidence in schema push + backfill: HIGH.**

## Method

1. Read backfill snapshot (63 week_items + 23 projects planned ops).
2. Ran `pnpm runway:pull --target prod` to capture current prod state.
3. For every op in snapshot, verified prod row matches expected post-state.
4. Re-derived MIN(start) / MAX(end) independently across all 44 projects from live week_items and compared to prod — zero mismatches.
5. Verified 21 childless projects have NULL start/end.
6. Verified all 9 new schema columns are present and untouched-scope columns are fully NULL.
7. Scanned all 6 tables for `updatedAt >= 2026-04-20T23:00` outside the expected scope — zero unexpected touches.

## Findings

### Expected and observed (PASS)

**week_items backfill (Step 1):**
- All 63 planned week_items now have `start_date = date` (== planned `newStartDate`). Matches 63/63.
- Sanity scan: all 63 prod week_items satisfy `start_date == date`; zero NULL, zero mismatch.

**projects derivation (Step 2):**
- All 23 planned projects have `start_date`, `end_date` matching planned derived values. Matches 23/23.
- Independent re-derivation from live children across all 44 projects: 44/44 match (no drift).
- 21 projects not in backfill scope are childless and correctly NULL (per v4 rule).

**Schema push (9 new columns):**
- `projects.start_date`: PRESENT — populated for 23, NULL for 21 childless
- `projects.end_date`: PRESENT — populated for 23, NULL for 21 childless
- `projects.contract_start`: PRESENT — 0 non-null (expected; Wave 1 client data work)
- `projects.contract_end`: PRESENT — 0 non-null (expected)
- `projects.engagement_type`: PRESENT — 0 non-null (expected)
- `week_items.start_date`: PRESENT — 63/63 populated
- `week_items.end_date`: PRESENT — 0 non-null (expected; single-date week_items)
- `week_items.blocked_by`: PRESENT — 0 non-null (expected; Wave 1)
- `updates.triggered_by_update_id`: PRESENT — 0 non-null (expected; new trigger feature)

### Expected but NOT observed (CRITICAL)

*None.*

### Observed but NOT expected

#### UNEXPLAINED (CRITICAL)

*None.*

#### INCIDENTAL (NON-CRITICAL)

- **`updatedAt` bumped on 63 week_items + 23 projects.** Expected noise — migration script sets `updatedAt: new Date()` in the UPDATE. Timestamps cluster tightly: week_items 23:06:23–23:06:49, projects 23:06:50–23:06:58, confirming single-run, no stragglers, no retries.

## Scope discipline check

No records outside backfill scope have `updatedAt` ≥ 2026-04-20T23:00 in any of the 6 tables (clients, projects, weekItems, pipelineItems, updates, teamMembers). Backfill was scope-perfect.

## Snapshot note

The pre-snapshot file carries this header:
> "Reconstructed from prod state after test teardown deleted original snapshot. All pre-values were null pre-backfill (columns added in same PR)."

This is structurally sound — the columns were added in the same PR as the backfill, so pre-backfill values are definitionally NULL for every target row. The reconstructed snapshot's `previousStartDate: null` / `previousEndDate: null` entries are provably correct by construction.

**Minor caveat:** because the original snapshot was destroyed, the REVERT script cannot be used to un-do the backfill unless the reconstructed snapshot is trusted. Since all pre-values were NULL, the REVERT is effectively "set these columns back to NULL for these IDs" — which is safe and correct. No action needed; noted for awareness.

## Overall recommendation

**ACCEPT.**

- All 86 expected writes observed exactly as planned.
- All 21 untouched childless projects correctly NULL.
- All 9 schema columns present, with untouched-scope columns cleanly NULL.
- Zero records modified outside scope.
- Single-batch timestamp footprint (35-second window) rules out retries or partial state.
- Independent MIN/MAX re-derivation across all 44 projects matches prod with zero drift.

Chunk 4 schema push + backfill are production-clean. Safe to proceed to next chunk.
