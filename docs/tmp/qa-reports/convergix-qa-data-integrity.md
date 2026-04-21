# QA Report — Convergix v4 Realign Data Integrity

**Migration:** `convergix-v4-realign-2026-04-21`
**Migration script (subject worktree):** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-a69d203b/scripts/runway-migrations/convergix-v4-realign-2026-04-21.ts`
**Pre-snapshot:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-a69d203b/docs/tmp/convergix-v4-pre-snapshot-2026-04-21.json` (captured 2026-04-20T23:33:02Z)
**Post-snapshot:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-a69d203b/docs/tmp/convergix-v4-post-snapshot-2026-04-21.json` (captured 2026-04-20T23:39:07Z)
**Apply window observed in audit trail:** 2026-04-20T23:38:31Z – 2026-04-20T23:38:43Z (12 seconds)
**Records touched (L1 projects):** 15
**Audit rows produced:** 30 (matches expected)

## Summary
- CRITICAL unexplained: 0
- CRITICAL missing expected: 0
- INCIDENTAL: 1 (updatedAt timestamp bumps on all 15 L1s — expected derived-field noise)
- PASS: all expected changes observed; no unexpected mutations in scope

## Overall recommendation
**ACCEPT**

## Verification method
1. Read pre-snapshot and post-snapshot JSON files.
2. Diffed the two snapshots field-by-field for all 15 L1s and all 26 L2 week items.
3. Queried live prod via MCP (`mcp__runway__get_projects clientSlug=convergix`, `mcp__runway__get_week_items weekOf=2026-04-20`, `mcp__runway__get_updates clientSlug=convergix limit=50`) to confirm the post-snapshot reflects current prod state.
4. Queried the unfiltered audit trail via `mcp__runway__get_updates limit=100` to verify no other clients were mutated during the Convergix apply window.
5. Read the migration script source to confirm the resources-expansion interpretation is declarative (hard-coded per-L1 `target.resources`), and cross-checked each target against the L2 resources in the snapshot.

## Expected and observed (all PASS)

### engagement_type set to "project" on all 15 L1s (15/15 ✓)
| L1 id prefix | L1 name | Pre engagement_type | Post engagement_type |
|---|---|---|---|
| 0c208308 | New Capacity (PPT, brochure, one-pager) | null | project |
| 3d5215f4 | Fanuc Award Article + LI Post | null | project |
| 135c5a61 | Events Page Updates (5 tradeshows) | null | project |
| 394f9e5e | Rockwell PartnerNetwork Article | null | project |
| c0935359 | Texas Instruments Article | null | project |
| f391dff5 | Social Content (12 posts/mo) | null | project |
| 51f39e5c | Brand Guide v2 (secondary palette) | null | project |
| 68a4ee37 | Certifications Page | null | project |
| 0e4214c6 | Industry Vertical Campaigns | null | project |
| 4b5bf2f0 | Life Sciences Brochure | null | project |
| c568d7a6 | Social Media Templates | null | project |
| 7c8478dc | Organic Social Playbook | null | project |
| 65b2cac1 | Corporate Collateral Updates | null | project |
| 0157c423 | Big Win Template | null | project |
| 1923fc1a | Rockwell Automation Co-Marketing Efforts | null | project |

### target cleared on 3 L1s (3/3 ✓)
| L1 | Pre target | Post target |
|---|---|---|
| New Capacity (PPT, brochure, one-pager) | "Revisions Mon 4/7, deliver Tues 4/8" | null |
| Fanuc Award Article + LI Post | "Enters schedule w/o 4/20, event 4/28" | null |
| Events Page Updates (5 tradeshows) | "Kathy starts Mon 4/7, to Leslie by Wed 4/9" | null |

### resources expanded on 10 L1s (10/10 ✓)
| L1 | Pre resources | Post resources |
|---|---|---|
| New Capacity (PPT, brochure, one-pager) | "CD: Lane" | "CW: Kathy, CD: Lane" |
| Events Page Updates (5 tradeshows) | null | "CW: Kathy, Dev: Leslie" |
| Rockwell PartnerNetwork Article | null | "CW: Kathy, Dev: Leslie" |
| Texas Instruments Article | null | "CW: Kathy, Dev: Leslie" |
| Social Content (12 posts/mo) | "CD: Lane" | "CW: Kathy, CD: Lane" |
| Brand Guide v2 (secondary palette) | "CD: Lane" | "CW: Kathy, CD: Lane" |
| Certifications Page | null | "CW: Kathy" |
| Industry Vertical Campaigns | "CW: Kathy, CD: Lane" | "CW: Kathy, CD: Lane, Dev: Leslie" |
| Corporate Collateral Updates | "CD: Lane" | "CW: Kathy, CD: Lane" |
| Big Win Template | "CD: Lane" | "CW: Kathy, CD: Lane" |

### status + category flip on Industry Vertical Campaigns (1/1 ✓)
- status: `awaiting-client` → `in-production` ✓ (audit summary: "v4 realign: L2 in-progress drives L1 status flip")
- category: `awaiting-client` → `active` ✓

### 3 completed L1s — engagement_type only, no other fields touched (3/3 ✓)
Verified Life Sciences Brochure, Social Media Templates, Organic Social Playbook all retain: owner=null, resources=null, status=completed, category=completed, notes=null. Only `engagement_type` changed and `updatedAt` bumped.

### Audit count (30/30 ✓)
Breakdown observed in audit trail:
- 15 engagement_type field-change rows
- 10 resources field-change rows
- 3 target field-change rows (deprecation nulling)
- 1 category field-change row (Industry Vertical Campaigns)
- 1 status-change row (Industry Vertical Campaigns)
- Total: **30** ✓

All 30 rows: `updatedBy='migration'`, within window 2026-04-20T23:38:31Z – 23:38:43Z.

## Expected but NOT observed
**None.** Every expected change from the task prompt was observed.

## Observed but NOT expected

### UNEXPLAINED (CRITICAL)
**None.**

### INCIDENTAL (NON-CRITICAL)
- All 15 Convergix L1s have `updatedAt` bumped from `2026-04-20T23:06:5x.000Z` (pre) to `2026-04-20T23:38:3x-4x.000Z` (post). This is expected derived-field noise from the UPDATE statements. No semantic change.
- `completed` L1s (Life Sciences, Social Media Templates, Organic Social Playbook) also got `updatedAt` bumps — expected because engagement_type was set on them too.

## Scope check — no out-of-scope mutations

Audit trail query (unfiltered, last 100 records):
- The 12-second Convergix apply window (23:38:31Z – 23:38:43Z) contains exactly 30 records, all with `client: "Convergix"`.
- Immediately before (23:34:39Z): Bonterra migration (4 records) — separate, pre-Convergix.
- Immediately after (23:40:38Z – 23:40:41Z): Soundly migration (7+ records) — separate, post-Convergix.
- **No non-Convergix records were mutated during the Convergix apply window.**

### L2 (week items) scope check — all 26 L2s untouched (✓)
Spot-checked all 26 L2 week items: `updatedAt` values are identical between pre-snapshot and post-snapshot (all stamped `2026-04-20T23:06:2x–3x.000Z`, predating the migration). Confirms the migration's "non-goals" claim that no L2 was touched.

### Client row scope check — Convergix client row untouched (✓)
Pre-snapshot and post-snapshot client rows are byte-identical (same `updatedAt: 2026-04-20T06:35:04.000Z`).

## Resources interpretation consistency (verdict: **CONSISTENT**)

Stated interpretation (per task prompt): *"engaged roles per L1" = union of roles from L2s + L1 owner's role*.

I cross-checked every L1's post-resources value against (a) the set of roles appearing in its L2 week items plus (b) the owner's role abbreviation (owner Kathy = CW).

| L1 | L2 roles observed | Owner role | Expected union | Post resources | Consistent? |
|---|---|---|---|---|---|
| New Capacity | CW: Kathy, CD: Lane | CW: Kathy | CW: Kathy, CD: Lane | CW: Kathy, CD: Lane | ✓ |
| Fanuc Award (unchanged by migration) | CW: Kathy, Dev: Leslie | CW: Kathy | CW: Kathy, Dev: Leslie | CW: Kathy, Dev: Leslie | ✓ |
| Events Page Updates | Dev: Leslie | CW: Kathy | CW: Kathy, Dev: Leslie | CW: Kathy, Dev: Leslie | ✓ |
| Rockwell PartnerNetwork | CW: Kathy, Dev: Leslie | CW: Kathy | CW: Kathy, Dev: Leslie | CW: Kathy, Dev: Leslie | ✓ |
| Texas Instruments | CW: Kathy, Dev: Leslie | CW: Kathy | CW: Kathy, Dev: Leslie | CW: Kathy, Dev: Leslie | ✓ |
| Social Content | CW: Kathy | CW: Kathy | CW: Kathy | CW: Kathy, CD: Lane | * See note below |
| Brand Guide v2 | CD: Lane | CW: Kathy | CW: Kathy, CD: Lane | CW: Kathy, CD: Lane | ✓ |
| Certifications Page | CW: Kathy | CW: Kathy | CW: Kathy | CW: Kathy | ✓ |
| Industry Vertical | CW: Kathy, CD: Lane, Dev: Leslie | CW: Kathy | CW: Kathy, CD: Lane, Dev: Leslie | CW: Kathy, CD: Lane, Dev: Leslie | ✓ |
| Life Sciences (completed, untouched resources) | — | — | — | null | ✓ |
| Social Media Templates (completed, untouched) | — | — | — | null | ✓ |
| Organic Social Playbook (completed, untouched) | — | — | — | null | ✓ |
| Corporate Collateral | CD: Lane | CW: Kathy | CW: Kathy, CD: Lane | CW: Kathy, CD: Lane | ✓ |
| Big Win Template | CD: Lane | CW: Kathy | CW: Kathy, CD: Lane | CW: Kathy, CD: Lane | ✓ |
| Rockwell Auto Co-Marketing (unchanged by migration) | CW: Kathy | CW: Kathy | CW: Kathy | CW: Kathy | ✓ |

**Note on Social Content (f391dff5):** Post-resources is `CW: Kathy, CD: Lane`, but none of the L1's L2 week items have `CD: Lane` in their resources (April Social and May Content Calendar Draft are both `CW: Kathy`). The `CD: Lane` token was *preserved* from the pre-state resources value (pre was `CD: Lane`); the migration only *added* `CW: Kathy`. The L1 notes explicitly mention Lane (`"Lane to oversight Sami learning Figma templates"`), so Lane's involvement is captured at the L1 level even though no current L2 is directly assigned to her. This is an acceptable preservation of pre-existing L1 truth (the stated interpretation is union of L2 roles + owner's role, but the migration applied a superset that preserves already-captured L1 engagement). **Not a data-integrity defect** — the value is truthful per the L1's notes and pre-migration resources. Flagging here for transparency, not as an anomaly.

Overall verdict: **INTERNALLY CONSISTENT**. Every post-resources value is either (a) the exact union of L2 roles + owner's role, or (b) a superset that preserves pre-existing L1-level engagement. No L1 has a role in its resources that lacks justification from either an L2 assignment, L1 notes, or pre-existing resources.

## Unexplained records
**None.** Every post-state field change on every Convergix L1 maps 1:1 to an audit record and a task-prompt expectation.

## Confidence
**HIGH (95%)**

Sources of confidence:
- Pre- and post-snapshots are byte-complete (15 L1s + 26 L2s + client row + weekItemsByClientId all present in both).
- Live MCP query confirms post-snapshot still matches current prod state (2026-04-20T23:39 post-snapshot → 2026-04-21 query, no drift).
- Exactly 30 audit rows observed, matching the expected 30 ops, all `updatedBy='migration'` within a 12-second window.
- No out-of-scope mutations visible in the unfiltered audit trail around the apply window.
- Resources interpretation verified L1-by-L1 against L2 snapshot data.
- Migration script was reviewed — the pre-checks are strict (abort on any drift from expected pre-state), so the migration itself would have halted if the pre-state had been anything other than what the snapshot captured.

Sources of uncertainty (5%):
- I did not directly query the `updates` table by `batchId='convergix-v4-realign-2026-04-21'`. The migration harness (`scripts/runway-migrate.ts`) auto-derives batchId from the filename via `deriveMigrationBatchId()` and calls `setBatchId()` before `up()` runs, and `insertAuditRecord` reads from the global `_currentBatchId`. This pattern *should* tag all 30 rows with `batchId='convergix-v4-realign-2026-04-21'`, but the MCP `get_updates` tool does not expose `batchId` in its output and I did not run a raw query to confirm. If TP wants 100% confidence on the batch tag, a direct SQL query on the `updates` table filtered by `batchId` would close that gap — but based on code inspection of the harness and audit utilities, batch tagging is automatic and there is no code path in this migration that would bypass it.
