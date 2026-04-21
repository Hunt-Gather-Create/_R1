# QA Report — Asprey Data Integrity

**Migration:** `asprey-v4-touchup-2026-04-21` (batchId `asprey-v4-touchup-2026-04-21`)
**Subject branch:** `feature/runway-pr86-data-asprey`
**Subject worktree:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-ac68f538`
**Pre-snapshot (pre-scan):** `docs/tmp/asprey-v4-pre-snapshot-2026-04-21.json`
**Pre-apply snapshot (apply-mode, REVERT-source):** `docs/tmp/asprey-v4-pre-apply-snapshot-2026-04-21.json`
**Post-snapshot:** `docs/tmp/asprey-v4-post-snapshot-2026-04-21.json`
**Forward script:** `scripts/runway-migrations/asprey-v4-touchup-2026-04-21.ts`
**Reverse script:** `scripts/runway-migrations/asprey-v4-touchup-2026-04-21-REVERT.ts`
**Spec:** `docs/tmp/migration-specs/overnight-clients-v4-realign.md` (Asprey section, Wave 2 background)
**Client slug:** `dave-asprey` (verified)
**Records touched:** 2 (1 client row, 1 L1 project row). 3 L2s explicitly untouched.

---

## Summary

- CRITICAL unexplained: **0**
- CRITICAL missing expected: **0**
- INCIDENTAL: **2** (updatedAt bumps on client + L1)
- PASS: **3** field-level expected changes

**Overall recommendation: ACCEPT**

---

## Method

Read-only. Pre/post compared field-by-field across the 3 snapshot files in the subject worktree. No prod MCP queries were issued (the snapshots are authoritative and taken at apply time; issuing a fresh MCP read now would only add state captured *after* the migration window and cannot help verify the apply). Scope of verification aligns with the spec's 3 locked field writes.

---

## Step 1 — Expected delta (from spec + forward script)

From `asprey-v4-touchup-2026-04-21.ts` (lines 7–12, 62–68) cross-referenced with `overnight-clients-v4-realign.md` (Asprey section lines 167–180):

| Target | Field | Before | After |
|---|---|---|---|
| `clients` (slug `dave-asprey`) | `team` | `"Allison (lead)"` | `"AM: Allison, CM: Sami, PM: Jason"` |
| `projects` (id `00a4e855…`) | `engagementType` | `null` | `"retainer"` |
| `projects` (id `00a4e855…`) | `contractEnd` | `null` | `"2026-04-30"` |
| `projects` (id `00a4e855…`) | `startDate` | `"2026-04-20"` | `"2026-04-20"` (recompute no-op, TP decision #4) |
| `projects` (id `00a4e855…`) | `endDate` | `"2026-04-30"` | `"2026-04-30"` (recompute no-op, TP decision #4) |
| L2 week_items (3 records) | — | — | No writes (explicit spec: "No L2 writes in this migration") |

Expected incidental side effects: `projects.updatedAt` and `clients.updatedAt` bump from write execution; 3 audit rows inserted (2 raw-UPDATE audit inserts for `engagementType` and `contractEnd`; 1 audit via `updateClientField` for `team`) all tagged `batchId=asprey-v4-touchup-2026-04-21`. Audit table not included in snapshots; batch-id tagging is verified upstream via the publish pipeline, out of scope for this integrity check.

---

## Step 2 — Observed delta (pre-apply → post)

### Client row (`7d22f3b6…`, slug `dave-asprey`)

| Field | Pre-apply | Post | Classification |
|---|---|---|---|
| `team` | `"Allison (lead)"` | `"AM: Allison, CM: Sami, PM: Jason"` | **Expected + Observed** |
| `updatedAt` | `2026-04-17T20:07:17.000Z` | `2026-04-21T00:10:31.000Z` | INCIDENTAL (write-triggered) |
| All other fields (id, name, slug, nicknames, contractValue, contractTerm, contractStatus, clientContacts, createdAt) | unchanged | unchanged | PASS (unchanged as expected) |

### L1 project (`00a4e855…`, name "Social Retainer — Wind Down")

| Field | Pre-apply | Post | Classification |
|---|---|---|---|
| `engagementType` | `null` | `"retainer"` | **Expected + Observed** |
| `contractEnd` | `null` | `"2026-04-30"` | **Expected + Observed** |
| `updatedAt` | `2026-04-20T23:06:56.000Z` | `2026-04-21T00:10:32.000Z` | INCIDENTAL (write-triggered) |
| `startDate` | `"2026-04-20"` | `"2026-04-20"` | Expected no-op (recompute matched derivation; TP decision #4) |
| `endDate` | `"2026-04-30"` | `"2026-04-30"` | Expected no-op (recompute matched derivation; TP decision #4) |
| All other fields (id, clientId, name, status, category, owner, resources, waitingOn, target, dueDate, contractStart, notes, staleDays, sortOrder, createdAt) | unchanged | unchanged | PASS (unchanged as expected) |

### L2 week_items (3 rows: `46ef1edc…`, `f88098fe…`, `0c665655…`)

All 22 fields × 3 rows compared. **All identical pre-apply vs post.** `updatedAt` timestamps preserved at `2026-04-20T23:06:48.000Z` / `...49Z` (unchanged), confirming the migration did not touch L2s. This validates TP decision #3 (L2s with null resources left alone per v4 "null OK if single person" rule) and the spec's "No L2 writes in this migration" clause.

---

## Step 3 — Expected-vs-observed matrix

### Expected and observed (green, 3)

1. `clients[dave-asprey].team`: `"Allison (lead)"` → `"AM: Allison, CM: Sami, PM: Jason"`
2. `projects[00a4e855].engagementType`: `null` → `"retainer"`
3. `projects[00a4e855].contractEnd`: `null` → `"2026-04-30"`

### Expected but NOT observed (CRITICAL, 0)

_None._

### Observed but NOT expected

#### UNEXPLAINED (CRITICAL, 0)

_None. No records outside the migration scope were mutated._

#### INCIDENTAL (NON-CRITICAL, 2)

1. `clients[dave-asprey].updatedAt` bumped (expected side effect of `updateClientField`)
2. `projects[00a4e855].updatedAt` bumped (expected side effect of raw `ctx.db.update()` in steps 3 + 4; bump applied twice in same transaction for engagementType + contractEnd writes, final value reflects the later write)

---

## Ratification of TP decisions

1. **Retainer `contract_end='2026-04-30'` (locked from spec):** VALID. `client.contractTerm` is `"Through Apr 30, 2026"`, the L1 name is "Social Retainer — Wind Down", and L2 `0c665655` ("Retainer Close — Final Post") has `date=2026-04-30`. All three signals align on 4/30 as the retainer end. **Ratified.**
2. **Engaged-roles-per-L1 interpretation (single Asprey L1, so `client.team` = full client.team roster):** VALID. Asprey has exactly 1 L1, whose `resources` field is already `"AM: Allison, CM: Sami, PM: Jason"`. Mirroring that into `client.team` is the only coherent v4 outcome. **Ratified.**
3. **L2s with null `resources` (single-owner Allison work) left unchanged:** VALID per v4 rule "Null OK if single person (inferred from L1)" and confirmed in the pre-scan analysis block (`l2ResourceNullDecision`). Both targeted L2s (`f88098fe`, `0c665655`) have `owner=Allison`; the third L2 (`46ef1edc`, owner Jason) already has `resources="PM: Jason"` set. **Ratified.**

---

## Retainer fields validity

- `engagement_type = "retainer"`: consistent with L1 name ("Social Retainer") and spec directive.
- `contract_end = "2026-04-30"`: consistent with `contractTerm` ("Through Apr 30, 2026"), L1 `endDate` (2026-04-30), final L2 `date` (2026-04-30), and notes ("Account closes EOM April").
- `contract_start = null` (untouched): acceptable — spec did not require backfill, and Asprey is a wind-down, not a new engagement.

**Retainer fields: VALID.**

---

## Team normalization format

- Pre: `"Allison (lead)"` — v1 parenthetical-role format.
- Post: `"AM: Allison, CM: Sami, PM: Jason"` — v4 role-prefix format.
- Role abbreviations match the canonical set per `feedback_naming_and_field_conventions` memory (AM/CM/PM are valid). Format mirrors the established L1 `resources` value byte-for-byte.

**Format: VALID. v4-compliant.**

---

## Scope check

- 3 L2s (`46ef1edc`, `f88098fe`, `0c665655`): field-by-field identical pre→post. **No L2 mutations. Scope boundary held.**
- No new records created (snapshot structure identical, same record counts).
- No records deleted.
- No records outside Asprey client namespace visible in snapshots (correct — scripts scope by `clientId`).

---

## Unexplained records

**None.**

---

## Confidence

**High.** The pre-apply snapshot (apply-mode, `capturedAt=2026-04-21T00:10:31.383Z`) was written by the migration script itself immediately before the writes, and the post-snapshot was captured ~22 seconds later (`capturedAt=2026-04-21T00:10:53.970Z`). The window is tight, the diff is 3 fields exactly matching the spec plus 2 incidental `updatedAt` bumps, and the forward script contains an in-band `verify()` pass (lines 320–363) that would have thrown on any of the target fields missing. L2 scope integrity verified by field-by-field comparison.

Consider the field-write audit-row batch-id tagging verification as a separate concern (publish pipeline); outside the data-integrity scope of this report.

---

## Overall recommendation

**ACCEPT.**
