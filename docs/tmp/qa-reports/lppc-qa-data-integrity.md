# QA Report — LPPC Data Integrity

**Migration:** `lppc-v4-realign-2026-04-21` (PR #86 Wave 1 Batch B)
**Subject worktree:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-a580d737`
**Subject branch:** `feature/runway-pr86-data-lppc`
**Pre-snapshot:** `docs/tmp/lppc-v4-pre-snapshot-2026-04-21.json` (2026-04-20T23:52:09Z)
**Post-snapshot:** `docs/tmp/lppc-v4-post-snapshot-2026-04-21.json` (2026-04-20T23:54:18Z)
**Forward script:** `scripts/runway-migrations/lppc-v4-realign-2026-04-21.ts`
**Reverse script:** `scripts/runway-migrations/lppc-v4-realign-2026-04-21-REVERT.ts`
**Records in scope:** 1 client, 7 L1 projects, 11 L2 week items
**Apply window:** 2026-04-20T23:53:42Z – 23:53:46Z (~4 seconds)

---

## Summary

| Bucket | Count |
|---|---|
| CRITICAL unexplained | **0** |
| CRITICAL missing expected | **0** |
| INCIDENTAL (non-critical) | 14 (7 project `updatedAt` touches + 7 expected-but-no-op derivation calls) |
| PASS (expected and observed) | 10 (7 engagement_type sets + 2 resources expansions + 9 audit rows collapsed into migration block) |

**Recommendation: ACCEPT**

All expected changes observed. No unexplained modifications. No concurrent-write contamination detected in LPPC scope. Audit rows exactly match the spec plan and were all tagged with `batchId=lppc-v4-realign-2026-04-21`. L2 week items untouched (all `updatedAt` <= 2026-04-20T23:06:48Z, predating migration window by ~47 minutes).

---

## Findings

### Expected and observed (PASS)

#### A. `engagement_type: null -> "project"` on all 7 L1s

| Project | Pre | Post | Audit row | Result |
|---|---|---|---|---|
| Interactive Map (`d7d7cc2f2df14fbd8ff8836e7`) | null | "project" | `f16a2d70836c484988ba74af5` @ 23:53:42Z | PASS |
| 2025 Year End Report (`ba2fb938cca8437089308ad9c`) | null | "project" | `7faa2701a2f049fe9d7403e92` @ 23:53:43Z | PASS |
| Spring CEO Meeting Invite (`61cb41588fe048b29c89677d4`) | null | "project" | `01c7511393ca4103ab253945b` @ 23:53:43Z | PASS |
| Website Blog Posts (`35a75784236244cbbeb7bc170`) | null | "project" | `5da4e74241d24fa5b10412a87` @ 23:53:43Z | PASS |
| MyLPPC Training Video (`09ce8dd93ff44bf9b35dc7c94`) | null | "project" | `bfc3e3da64bc4f20a90ea9a13` @ 23:53:44Z | PASS |
| Mailchimp Invites (Spring + Fall) (`dfbf69a756cc48b5951f51ea8`) | null | "project" | `27afe0b1e3054e79a36eab017` @ 23:53:44Z | PASS |
| Website Revamp (`6422e5f4b0fa483ea88c7b94e`) | null | "project" | `04e4cce2f9ef427cb4a047864` @ 23:53:44Z | PASS |

#### B. `resources` expansion on 2 active L1s

| Project | Pre | Post | Audit row | Result |
|---|---|---|---|---|
| Interactive Map | `"CD: Lane, Dev: Leslie"` | `"CD: Lane, CW: Kathy, Dev: Leslie, PM: Jason"` | `5d4c3c4fb3c248c79448771ad` @ 23:53:43Z | PASS |
| Website Revamp | `"CD: Lane, Dev: Leslie"` | `"CD: Lane, CW: Kathy, Dev: Leslie, PM: Jason"` | `1ebb0e611d6147feb2d15fb7b` @ 23:53:44Z | PASS |

#### C. 5 dormant L1s: `resources` stays null

| Project | Pre | Post | Result |
|---|---|---|---|
| 2025 Year End Report | null | null | PASS |
| Spring CEO Meeting Invite | null | null | PASS |
| Website Blog Posts | null | null | PASS |
| MyLPPC Training Video | null | null | PASS |
| Mailchimp Invites (Spring + Fall) | null | null | PASS |

#### D. Audit batch tagging

- **9 audit rows** present in `auditRowsForBatch` (post-snapshot), **all** with `batchId=lppc-v4-realign-2026-04-21`
- Distribution: 7 engagement_type field-changes + 2 resources field-changes = **9**, matches spec exactly
- `updatedBy="migration"` on every row (no bot or user contamination)
- Timestamps tightly clustered 23:53:42Z – 23:53:44Z (2-second spread, consistent with sequential script execution)
- `triggeredByUpdateId` null on all rows (no cascade contamination)
- `slackMessageTs` null on all rows (batch mode suppressed Slack — expected per operator memory)

#### E. No L2 writes

All 11 L2 `weekItems` rows are byte-identical pre vs. post, including `updatedAt` timestamps. Max L2 `updatedAt` in post = `2026-04-20T23:06:48Z`, which **predates** the migration apply window (23:53:42Z+) by ~47 minutes. No L2 was touched by this migration or by any concurrent batch. PASS.

#### F. No FK changes, no creations, no deletions

- Pre L1 count = 7, Post L1 count = 7. No creations/deletions.
- Pre L2 count = 11, Post L2 count = 11. No creations/deletions.
- All `projectId` FKs on L2s unchanged (byte-identical L2 rows).
- Client row structurally identical pre vs. post (`updatedAt=2026-04-20T06:52:53Z` unchanged).

### Expected but NOT observed

**None.** Every planned change in the script's `PROJECT_PLANS` is reflected in the post-snapshot.

### Observed but NOT expected

#### INCIDENTAL — project `updatedAt` bumps (NON-CRITICAL)

Every L1 has a new `updatedAt` in the 23:53:45Z–23:53:46Z window. This is the expected side effect of:
- The raw `ctx.db.update(projects).set({ engagementType, updatedAt: new Date() })` call in `applyEngagementType` — applies to all 7.
- `updateProjectField(..."resources"...)` on the 2 active L1s — also bumps `updatedAt`.
- `recomputeProjectDates` (Step 4 of the migration) — this function writes to `projects.startDate/endDate` unconditionally and thus bumps `updatedAt` on all 7.

Classification: **INCIDENTAL**. `updatedAt` is an audit-side field, not a content field.

#### INCIDENTAL — `recomputeProjectDates` called but no visible date drift (NON-CRITICAL)

Spec: "recompute L1 start/end dates from children for all 7 L1s". Observed: **zero** L1 start/end date values changed pre -> post.

| Project | startDate pre | startDate post | endDate pre | endDate post |
|---|---|---|---|---|
| Interactive Map | 2026-04-21 | 2026-04-21 | 2026-04-27 | 2026-04-27 |
| 2025 Year End Report | null | null | null | null |
| Spring CEO Meeting Invite | null | null | null | null |
| Website Blog Posts | 2026-04-30 | 2026-04-30 | 2026-04-30 | 2026-04-30 |
| MyLPPC Training Video | 2026-04-30 | 2026-04-30 | 2026-04-30 | 2026-04-30 |
| Mailchimp Invites | null | null | null | null |
| Website Revamp | 2026-04-20 | 2026-04-20 | 2026-05-11 | 2026-05-11 |

**Interpretation:** The dates were already derivation-consistent with the child L2s before the migration ran. The explicit `recomputeProjectDates` call re-asserted state as a safety measure but did not produce a content delta. Matches the script's inline comment: *"No L2 writes happened in this migration, so derivation shouldn't shift anything — this is a safety call per TP locked decision so every LPPC L1 lands in a known-derived state post-migration."*

Classification: **INCIDENTAL / NO-OP**. Matches spec intent (derivation re-assertion), no unexpected change.

#### UNEXPLAINED (CRITICAL)

**None.**

---

## Concurrent-write contamination check

Spec: "other batches (TAP, HDL, Convergix, Soundly, Bonterra) may have written audit rows during same window. Verify no LPPC records were touched by non-LPPC batches."

- **LPPC scope records** = 1 client, 7 projects, 11 week items (all clientId=`d27916a0809747f99fe9a8157`).
- **Client `updatedAt`**: unchanged at 2026-04-20T06:52:53Z. If any non-LPPC batch had touched the client row, its `updatedAt` would have shifted. PASS.
- **Project `updatedAt`**: all 7 land within the LPPC migration's own 4-second window (23:53:42Z – 23:53:46Z). No stray timestamps indicating a foreign writer. The uniformity of the cluster (`23:53:45` or `23:53:46`) is itself evidence of a single script run.
- **WeekItems `updatedAt`**: all 11 pre-date the migration window. No foreign batch touched LPPC L2s during Wave 1 Batch B execution. PASS.
- **`auditRowsForBatch`**: filtered to `batchId=lppc-v4-realign-2026-04-21` by snapshot generator; returned count 9, exact match to plan. No over- or under-count.

**Conclusion:** No LPPC records were touched by non-LPPC batches during the apply window. Concurrent writes (if any) to Bonterra / Convergix / TAP / HDL / Soundly did not contaminate LPPC scope.

*Caveat:* This QA run cannot independently verify the inverse (that LPPC's migration didn't touch non-LPPC records), since the post-snapshot is LPPC-filtered. The script's queries are `WHERE clientId = lppc.id` throughout; trust is structural, not empirical, for cross-client isolation. Low concern — snapshot + code review of the forward script both show the writes strictly scoped by client ID.

---

## TP decision ratification — dormant L1 conservative call

**Question:** Agent left 5 dormant L1s' resources as null rather than setting them to the full team (`CD: Lane, CW: Kathy, Dev: Leslie, PM: Jason`). Ratify?

**RATIFY.** This is consistent with v4 convention intent:

1. **v4 spec language** (from `overnight-clients-v4-realign.md` generic rules): *"`resources` = full team roster **for this engagement** (not just primary helper)"*. Key phrase: "for this engagement." The engaged-roles-per-L1 interpretation applies per-project, not per-client.
2. **Dormant state**: The 5 L1s are `completed` (2), `on-hold` (2), or `not-started / on-hold category` (1). Their historical engagement rosters are not in the snapshot, and claiming the full current team worked on, e.g., the 2025 Year End Report (delivered 2/23) is fabrication.
3. **Reversibility**: Null is the safe default. If a future engagement reactivates a dormant L1, it can be populated then with evidence.
4. **Halt-vs-proceed**: Script author flagged this explicitly in the doc block: *"Dormant / completed L1s are left with null resources (historical team not reliably known; see post-run note + halt report if needed)."* No halt was warranted; the conservative call is in line with "sub-threshold drift = note in post-run log, proceed" per the spec's halt rules.

Recommend TP log this ratification in the pre-plan so future overnight agents apply the same heuristic.

---

## Unexplained records

**None.** All 7 LPPC L1 modifications and 0 LPPC L2 modifications are accounted for by the migration spec. The 9 audit rows match the 9 planned writes (7 engagementType + 2 resources). No orphan updates.

---

## Confidence

**HIGH.** Evidence basis:

- Pre- and post-snapshots captured ~2 minutes apart, bracketing a tight 4-second apply window
- Every spec-predicted field change appears with correct before/after values
- Audit trail is exactly the right shape (9 rows, right batchId, right updatedBy, right timestamps)
- No L2 `updatedAt` drift whatsoever (strong negative evidence against silent cascades)
- Forward script code review alignment with observed diff is 1:1

**Caveats:**
- Cross-client write isolation is structural (code-level, `WHERE clientId=...`) not empirical (snapshot-level), because snapshots are LPPC-scoped. Acceptable given the forward script is small, reviewed, and uses the established operations layer.
- `recomputeProjectDates` does not emit audit rows, so its execution is inferred from the script log and the `updatedAt` bump on all 7 projects. No direct evidence the function was called for, e.g., the null-dates dormant projects — but their `updatedAt` shifted, which is the expected signature.

---

## Overall recommendation

**ACCEPT.** Proceed with PR #86 Wave 1 Batch B. No reverse warranted. Log the dormant-L1-null-resources decision in the v4 convention doc as ratified precedent.
