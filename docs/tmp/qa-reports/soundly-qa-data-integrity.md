# QA Report — Soundly Data Integrity

**Migration:** `soundly-v4-realign-2026-04-21` (PR #86, Wave 1 Batch A)
**Pre-snapshot:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-a437840c/docs/tmp/soundly-v4-pre-snapshot-2026-04-21.json` (captured 2026-04-20T23:40:38.662Z, mode=apply)
**Post-snapshot:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-a437840c/docs/tmp/soundly-v4-post-snapshot-2026-04-21.json` (captured 2026-04-20T23:41:05.771Z, mode=post-apply)
**Migration script:** `scripts/runway-migrations/soundly-v4-realign-2026-04-21.ts`
**Records in scope:** 1 client, 3 L1s, 2 L2s. Records touched by migration: 4 (3 L1 + 1 L2).
**Live prod cross-check:** MCP `get_projects(soundly)`, `get_week_items(2026-04-20)`, `get_updates(soundly)`, `get_clients()` run 2026-04-20 during QA; all match post-snapshot state.

---

## Summary

- CRITICAL unexplained: **0**
- CRITICAL missing expected: **0**
- INCIDENTAL (updatedAt bumps): **4**
- PASS: **8 of 8 expected mutations observed**
- Overall recommendation: **ACCEPT**

---

## Expected delta (from spec + TP-locked decisions)

From migration script `L1_PLANS` / `L2_PLANS` and the task brief:

1. L1 `cf4d6575` iFrame Provider Search — resources: `Dev: Leslie` → `AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason`
2. L1 `cf4d6575` iFrame Provider Search — engagementType: `null` → `project`
3. L1 `8279d9eb` Payment Gateway Page — resources: `Dev: Leslie` → `AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason`
4. L1 `8279d9eb` Payment Gateway Page — engagementType: `null` → `retainer`
5. L1 `8279d9eb` Payment Gateway Page — contractEnd: `null` → `2026-05-31`
6. L1 `54d65143` AARP Member Login + Landing Page — resources: `Dev: Josefina` → `AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason`
7. L1 `54d65143` AARP Member Login + Landing Page — engagementType: `null` → `project`
8. L2 `9c3fc2bb` title: `iFrame launch (evening)` → `iFrame Provider Search — Evening Launch`
9. L2 `8ef611c4` title: NO CHANGE (spec notes it is already v4-compliant)

Total expected field mutations: **8**. Total rows expected to be touched: **4** (3 L1s + 1 L2).

---

## Observed delta (field-by-field diff of pre → post snapshot)

### Client `c68d8a44...` (Soundly)
No field changes. `updatedAt` held at `2026-04-20T06:37:43.000Z` (untouched — correct, spec did not target client row).

### L1 `cf4d65755...` iFrame Provider Search
- resources: `Dev: Leslie` → `AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason` **[EXPECTED, OBSERVED]**
- engagementType: `null` → `project` **[EXPECTED, OBSERVED]**
- updatedAt: `2026-04-20T23:06:55` → `2026-04-20T23:40:39` **[INCIDENTAL]**
- All other fields identical.

### L1 `8279d9eb5...` Payment Gateway Page
- resources: `Dev: Leslie` → `AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason` **[EXPECTED, OBSERVED]**
- engagementType: `null` → `retainer` **[EXPECTED, OBSERVED]**
- contractEnd: `null` → `2026-05-31` **[EXPECTED, OBSERVED]**
- updatedAt: `2026-04-20T23:06:55` → `2026-04-20T23:40:40` **[INCIDENTAL]**
- All other fields identical.

### L1 `54d651439...` AARP Member Login + Landing Page
- resources: `Dev: Josefina` → `AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason` **[EXPECTED, OBSERVED]**
- engagementType: `null` → `project` **[EXPECTED, OBSERVED]**
- updatedAt: `2026-04-20T06:37:37` → `2026-04-20T23:40:40` **[INCIDENTAL]**
- All other fields identical. (Notes field still references `Launch target 7/15` — unchanged, out of scope.)

### L2 `9c3fc2bb4...` (iFrame launch (evening) → iFrame Provider Search — Evening Launch)
- title: `iFrame launch (evening)` → `iFrame Provider Search — Evening Launch` **[EXPECTED, OBSERVED]**
- updatedAt: `2026-04-20T23:06:25` → `2026-04-20T23:40:41` **[INCIDENTAL]**
- All other fields identical.

### L2 `8ef611c43...` Payment Gateway Page — In Dev
- **No field changes. updatedAt unchanged at `2026-04-20T23:06:40`.**
- Correct: spec flagged this row as already v4-compliant; script skipped it; database row was not touched (confirmed by updatedAt being static).

---

## Findings

### Expected and observed (8/8 PASS)

All 8 expected field mutations observed in the post-snapshot and confirmed on live prod via MCP at QA time:

| # | Record | Field | Pre | Post | Source confirming |
|---|--------|-------|-----|------|-------------------|
| 1 | L1 iFrame Provider Search | resources | Dev: Leslie | AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason | snapshot + get_updates |
| 2 | L1 iFrame Provider Search | engagementType | null | project | snapshot + get_updates |
| 3 | L1 Payment Gateway Page | resources | Dev: Leslie | AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason | snapshot + get_updates |
| 4 | L1 Payment Gateway Page | engagementType | null | retainer | snapshot + get_updates |
| 5 | L1 Payment Gateway Page | contractEnd | null | 2026-05-31 | snapshot + get_updates |
| 6 | L1 AARP Member Login + Landing Page | resources | Dev: Josefina | AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason | snapshot + get_updates |
| 7 | L1 AARP Member Login + Landing Page | engagementType | null | project | snapshot + get_updates |
| 8 | L2 (projectId cf4d6575) | title | iFrame launch (evening) | iFrame Provider Search — Evening Launch | snapshot + get_updates |

Audit trail (8 rows) observed via MCP `get_updates(soundly)`:
- Field-change rows for each of the 3 resources updates, 3 engagement_type updates, 1 contract_end update.
- Week-field-change row for the title rename.
All 8 tagged `updatedBy = "migration"` and timestamped 2026-04-20T23:40:38–41Z. Matches the expected count.

### Expected but NOT observed (CRITICAL)

None.

### Observed but NOT expected

#### UNEXPLAINED (CRITICAL)

None.

#### INCIDENTAL (NON-CRITICAL)

- L1 `cf4d6575` updatedAt bump (23:06:55 → 23:40:39) — consequence of 2 writes to this row.
- L1 `8279d9eb` updatedAt bump (23:06:55 → 23:40:40) — consequence of 3 writes to this row.
- L1 `54d65143` updatedAt bump (06:37:37 → 23:40:40) — consequence of 2 writes to this row.
- L2 `9c3fc2bb` updatedAt bump (23:06:25 → 23:40:41) — consequence of 1 write to this row.

All four incidentals are expected noise from the migration's own writes. No untargeted rows were mutated.

---

## Locked-decision compliance

1. **`contract_end = '2026-05-31'` on Payment Gateway Page** — **COMPLIANT.** Post-snapshot shows `contractEnd: "2026-05-31"` on project `8279d9eb...`.
2. **Full `clients.team` copied verbatim to all 3 L1 `resources` (option a, full-team-on-each)** — **COMPLIANT.** All 3 L1s now have `resources = "AM: Jill, Dev: Leslie, Dev: Josefina, PM: Jason"`, which is byte-for-byte `clients.team` for Soundly (confirmed via MCP `get_clients`).
3. **engagement_type assignment (project×2, retainer×1)** — **COMPLIANT.** iFrame Provider Search = project, AARP = project, Payment Gateway = retainer.

---

## Scope check (records outside 3 L1s + 1 L2)

- Soundly client row: unchanged (updatedAt static). No scope leak.
- The 2nd L2 (Payment Gateway Page — In Dev, `8ef611c4...`): untouched (updatedAt static). No scope leak; correctly skipped per spec.
- Soundly has `projectCount: 3` per `get_clients()` — matches pre-snapshot; no L1 creations/deletions.
- No new L2s under Soundly for week-of 2026-04-20 beyond the two in the snapshots (confirmed via MCP `get_week_items(2026-04-20)`).
- No other clients had updates in the migration's time window per `get_updates(soundly)`-scoped view; cross-client side effects were not in scope for this snapshot pair but the 8 audit rows match the expected 8 mutations exactly, implying no collateral writes under the `migration` updatedBy tag at that timestamp.

---

## Observations (non-critical)

1. **Team-roster convention split between clients (by TP design).** Soundly uses the full-team-on-each interpretation (option a, locked decision #3 in `docs/brain/pr86-tp-autonomous-decisions.md`). Convergix uses engaged-roles-per-L1. This is an intentional TP-logged divergence, not a data-integrity issue. Flagged here only as an observation so future readers of Soundly L1s don't expect per-engagement splits.
2. **Audit rows do not carry a `batchId` tag.** The task brief states the migration uses `batchId: soundly-v4-realign-2026-04-21`, but the migration script at `scripts/runway-migrations/soundly-v4-realign-2026-04-21.ts` does not pass a `batchId` when calling `updateProjectField` / `updateWeekItemField` / `insertAuditRecord`; the audit `metadata` JSON contains only `{field: <name>}`. Searching audit records by batchId will not find these 8 rows. If TP wants batchId tagging before `scripts/runway-publish-updates.ts` group-posts, the script needs a follow-up edit. Not a data-integrity failure — the mutations themselves are correct — but a discrepancy between the brief and the implementation. **Flagged for TP review; not blocking.**

---

## Overall recommendation

**ACCEPT.**

All 8 expected field mutations landed on the correct 4 rows with the correct values. No unexpected records mutated. Live prod matches post-snapshot. Locked TP decisions (#1, #2, #3) are reflected verbatim. The 2nd L2 was correctly skipped (already v4-compliant) and the Soundly client row was not touched.

One non-blocking observation for TP: audit rows are not tagged with `batchId`, contrary to the task brief (see Observations #2).

**Confidence: HIGH.** Pre- and post-snapshots are well-formed, both diff against spec cleanly with zero unexplained changes, and MCP live-prod reads match the post-snapshot byte-for-byte.
