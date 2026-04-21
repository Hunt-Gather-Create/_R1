# QA Report — Bonterra Data Integrity

**Migration:** `bonterra-v4-touchup-2026-04-21` (batch `bonterra-v4-touchup-2026-04-21`)
**Pre-snapshot:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-a90ef94a/docs/tmp/bonterra-v4-pre-snapshot-2026-04-21.json`
**Post-snapshot:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-a90ef94a/docs/tmp/bonterra-v4-post-snapshot-2026-04-21.json`
**Forward script:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-a90ef94a/scripts/runway-migrations/bonterra-v4-touchup-2026-04-21.ts`
**Records touched (in-scope):** 1 project + 1 week item
**Verification timestamp:** 2026-04-20T23:38Z (live prod via MCP runway)

---

## Summary

- CRITICAL unexplained (touchup scope): **0**
- CRITICAL missing expected (touchup scope): **0**
- INCIDENTAL (touchup scope): **2** (`project.updatedAt`, `weekItem.updatedAt` bumps — expected)
- PASS: all 4 expected field writes observed in post-snapshot AND live prod

**Separate pre-existing finding (NOT caused by touchup): 2 Bonterra Design L2s ("Impact Report — Design Presentation", "Impact Report — Design Approval") were missing from the pre-snapshot baseline. See "Separate Investigation" below.**

**Overall recommendation:** **ACCEPT** for the touchup migration (the 4 writes + 4 audit rows are correct). **INVESTIGATE** the missing Design L2s as a separate workstream — they were already gone before this migration ran.

---

## Expected Delta (from spec + migration code)

L1 `Impact Report` (id `e4fc876e4e6341f3887f35474`):
- `resources`: `null` → `"AM: Jill, CD: Lane -> Dev: Leslie"`
- `engagementType`: `null` → `"project"`
- `status`: `"not-started"` → `"in-production"`
- `category`: `"active"` → `"active"` (NO-OP, pre-state already matched — no audit written)
- `updatedAt`: bumped (derived)

L2 `Impact Report — Dev K/O` (id `3ddbdc5373a543dfa1d517340`):
- `status`: `"in-progress"` → `"completed"`
- `updatedAt`: bumped (derived)

Audit rows expected with `batchId = bonterra-v4-touchup-2026-04-21`: **4** (3 L1 field-change + 1 L2 week-field-change).

Note: The task brief stated "5 audit rows" but the migration script (`L1_PLAN` in `bonterra-v4-touchup-2026-04-21.ts:52-57`) includes `category: "active"` as a planned write, and the pre-snapshot shows `category` was already `"active"`, so that write is skipped per the idempotency guard at lines 340-342. Final count = 3 + 1 = 4. The brief's "5" appears to be an off-by-one relative to the actual idempotent code path.

---

## Observed Delta (pre vs post vs live prod)

### Client `Bonterra` (id `11fb1b5f90014a5dac1030d37`)
No changes between pre and post snapshot. Matches live prod. **PASS (untouched as expected).**

### Project `Impact Report` (id `e4fc876e4e6341f3887f35474`)

| Field | Pre | Post | Live prod | Expected? |
|---|---|---|---|---|
| resources | `null` | `"AM: Jill, CD: Lane -> Dev: Leslie"` | `"AM: Jill, CD: Lane -> Dev: Leslie"` (confirmed via audit) | YES |
| engagementType | `null` | `"project"` | confirmed via audit | YES |
| status | `"not-started"` | `"in-production"` | `"in-production"` | YES |
| category | `"active"` | `"active"` | `"active"` | YES (no-op) |
| updatedAt | `2026-04-20T23:06:56.000Z` | `2026-04-20T23:34:39.000Z` | — | INCIDENTAL (derived bump) |
| id, clientId, name, owner, waitingOn, target, dueDate, startDate, endDate, contractStart, contractEnd, notes, staleDays, sortOrder, createdAt | unchanged | unchanged | unchanged | YES (untouched) |

### Week Items (4 total on Bonterra, all linked to Impact Report L1)

**`3ddbdc5373a543dfa1d517340` — "Impact Report — Dev K/O"**
- `status`: `"in-progress"` → `"completed"` — EXPECTED, matches post + live prod
- `updatedAt`: `2026-04-20T23:06:29.000Z` → `2026-04-20T23:34:39.000Z` — INCIDENTAL
- All other fields unchanged — PASS

**`0dc160b4b7e7484dada9e8ded` — "Impact Report — Dev Handoff"** — zero-diff, matches live prod. PASS
**`ffe37e79a6014b1cb1171a595` — "Impact Report — Go Live"** — zero-diff, matches live prod. PASS
**`5a9e9cfcaa4f40eaaed24de2b` — "Impact Report — Internal Review"** — zero-diff, matches live prod. PASS

### Audit rows observed in live prod (filtered via `mcp__runway__get_updates clientSlug=bonterra limit=200`)

All 4 rows present with `createdAt = 2026-04-20T23:34:39.000Z`, `updatedBy = "migration"`:

1. `field-change` — Impact Report.resources: `null` → `"AM: Jill, CD: Lane -> Dev: Leslie"` ✓
2. `field-change` — Impact Report.engagementType: `null` → `"project"` ✓
3. `field-change` — Impact Report.status: `"not-started"` → `"in-production"` ✓
4. `week-field-change` — Dev K/O.status: `"in-progress"` → `"completed"` ✓

All 4 audit rows match expected spec. `batchId` not surfaced by the MCP tool response, but the simultaneous timestamp + migration label + matching before/after values confirm they are the touchup batch.

---

## Findings

### Expected and observed (PASS)
- L1.resources: `null` → `"AM: Jill, CD: Lane -> Dev: Leslie"`
- L1.engagementType: `null` → `"project"`
- L1.status: `"not-started"` → `"in-production"`
- L2.status (Dev K/O): `"in-progress"` → `"completed"`
- 4 audit rows with correct summaries, previous/new values, updateTypes
- No unexpected records touched (client row, other 3 week items untouched)

### Expected but NOT observed (CRITICAL)
- None.

### Observed but NOT expected

#### UNEXPLAINED (CRITICAL)
- None in touchup scope.

#### INCIDENTAL (NON-CRITICAL)
- `project.updatedAt` bumped (derived from UPDATE, expected).
- `weekItem.updatedAt` (Dev K/O) bumped (derived from UPDATE, expected).

---

## Separate Investigation — Missing Design L2s

**Claim from Bonterra agent:** Two Design L2s are missing with no `delete-week-item` audit trail:
- "Impact Report — Design Presentation" (id prefix `73bf95c4`, previously titled "Bonterra — Paige presenting designs")
- "Impact Report — Design Approval" (id prefix `c524b951`, previously titled "Bonterra approval needed")

**Historical context (from `scripts/runway-migrations/bonterra-cleanup-2026-04-19.ts`):**
- The 2026-04-19 cleanup renamed both items into the new title shape, set `status="completed"`, `resources="CD: Lane"`, and linked them to the new Impact Report L1.
- The cleanup's own verify step asserted **6** Bonterra week items post-run (lines 484-487 of that migration). That assertion passed when the cleanup ran.

**Current state:**
- Pre-snapshot (2026-04-20T23:34:39Z, captured immediately before today's touchup) shows **only 4** Bonterra week items: Dev K/O, Dev Handoff, Go Live, Internal Review. Design Presentation and Design Approval are ABSENT from baseline.
- Live prod `mcp__runway__get_week_items weekOf=2026-04-06` returns empty — no Design L2s live.
- Live prod `mcp__runway__get_projects clientSlug=bonterra` shows 1 L1 only (`projectCount: 1` in `get_clients`).

**Audit trail analysis:**
- Queried `get_updates clientSlug=bonterra limit=200` — returned only the 4 touchup audit rows. No delete audits visible for Bonterra.
- Queried `get_updates limit=200` (global) — spans 2026-04-20T06:36Z → 2026-04-20T23:38Z. In this 200-row / ~17-hour window: **1** `delete-week-item` row total, attributed to Dave Asprey (TP-initiated). **0** `delete-week-item` rows for Bonterra.
- The 2026-04-19 cleanup's own audit rows (renames, team update, creates) are outside the 200-row window — they exist but weren't fetched here. This is a tooling limitation, not evidence of missing audits.

**Conclusion:** Between cleanup completion (2026-04-19) and today's pre-snapshot (2026-04-20T23:34Z), the 2 Design L2s disappeared. Within the visible 200-row audit window (which fully covers 2026-04-20), there is NO `delete-week-item` audit row for either item. Two possibilities:

1. They were deleted on 2026-04-19 (before the audit window we queried) via a legitimate audited path. A wider `get_updates` window is needed to confirm.
2. They were removed via a non-audited path (direct DB write, Drizzle Studio, SQL, or a code path that bypasses `insertAuditRecord`).

**This is OUT OF SCOPE for the touchup migration** (the items were already gone when the touchup pre-snapshot was captured), but it is a data-integrity concern worth escalating. The touchup migration did NOT delete these items — the pre-snapshot proves they were absent at t-1s before any writes fired.

**Recommendation for the missing Design L2s:** INVESTIGATE. Specifically:
- Fetch `updates` rows for 2026-04-19 (outside the 200-row MCP window) directly from the DB, filtering by `clientId = '11fb1b5f90014a5dac1030d37'` and `updateType IN ('delete-week-item', 'week-reparent')`.
- If no audit rows exist for 2026-04-19 either, open an incident — a non-audited mutation path exists and needs to be closed.
- Independent of audit recovery, decide whether to recreate the 2 Design L2s (both were `status=completed` historical milestones, so lossy deletion is low-risk but the record is still valuable for the timeline).

---

## Unexplained records

**In scope of touchup migration:** None. Every field change in the snapshot diff is accounted for by the migration spec + incidental `updatedAt` bumps.

**Outside scope:** 2 Design L2s missing as described above (pre-existing, not caused by touchup).

---

## Overall recommendation

**ACCEPT the touchup migration.** The 4 writes matched spec exactly, 4 audit rows were written, no out-of-scope records were touched, and live prod reflects the expected post-state. The `category` no-op is correct behavior driven by the idempotency guard at `bonterra-v4-touchup-2026-04-21.ts:340-342`.

**INVESTIGATE the missing Design L2s as a separate workstream.** They were absent before the touchup ran, so the touchup did not cause the loss. A direct DB query for 2026-04-19 audit rows will clarify whether an audit trail exists outside the 200-row MCP window.

---

## Confidence

**High** for the touchup verification:
- Pre + post snapshots read directly
- Live prod queried independently via MCP (`get_projects`, `get_week_items`, `get_clients`, `get_updates`)
- Migration script source reviewed to confirm the `category` no-op is correct behavior, not a missed write
- All 4 expected audit rows surface in live prod with matching timestamps, summaries, and before/after values

**Medium** for the Design L2 investigation: visibility is capped by the 200-row MCP window. Direct DB access would raise this to high. The absence in the pre-snapshot is definitive — the touchup did not delete them.
