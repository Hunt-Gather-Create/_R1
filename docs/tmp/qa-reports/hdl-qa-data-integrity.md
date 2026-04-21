# QA Report — HDL Data Integrity

**Migration:** `hdl-v4-realign-2026-04-21` (PR #86 Wave 1 Batch B)
**Batch ID:** `hdl-v4-realign-2026-04-21`
**Subject worktree:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-acab5a31`
**Subject branch:** `feature/runway-pr86-data-hdl`
**Pre-snapshot:** `docs/tmp/hdl-v4-pre-snapshot-2026-04-21.json`
**Post-snapshot:** `docs/tmp/hdl-v4-post-snapshot-2026-04-21.json`
**Pre-apply snapshot (from forward script):** `docs/tmp/hdl-v4-pre-apply-snapshot-2026-04-21.json`
**Records in scope:** 1 client, 1 L1, 11 L2s
**Records touched:** 1 L1 (3 fields) + 3 L2s (1 field each) = 4 records, 6 field writes
**Verified against prod:** yes, via MCP runway tools (2026-04-21)

## Summary

- CRITICAL unexplained: 0
- CRITICAL missing expected: 0
- INCIDENTAL: 2 (L1.updatedAt bump, 3 L2.updatedAt bumps on touched rows)
- PASS: 6 expected writes, all observed

**Overall recommendation:** ACCEPT

## Convention compliance

**Client-led resources convention:** PASS

All 3 client-led L2s (`Full Site Design Approval`, `Ad Words`, `Production Shoot`) show `resources="HDL"` as plain client name with no role prefix. This matches the v4 convention statement "Client-led work: use plain client name, no role prefix." Prod verified via `get_week_items` for weekOf 2026-04-27, 2026-05-11, 2026-06-15. No `"Client: HDL"`, no `"HDL (client)"`, no other prefix variant.

**Single-L1 roster expansion:** PASS

HDL has exactly 1 L1 project (`Website Build`, id `f9af3445…`). Client team field is `AM: Jill, CD: Lane, Dev: Leslie, PM: Jason`. L1 resources were expanded from `CD: Lane, Dev: Leslie` to exactly the full client team roster. This is consistent with engaged-roles-per-L1: when a client has one L1, engaged roles on that L1 = full team. The interpretation is self-consistent with the v4 spec (overnight-clients-v4-realign.md § "Every L1 (project)" — "resources = full team roster for this engagement").

**contract_status preservation:** PASS

Client `contract_status='expired'` is preserved on the client row (pre + post + prod all show `expired`). Client row itself has zero field diffs between pre and post; client.updatedAt also unchanged (2026-04-20T06:45:39.000Z). No audit rows targeting the client row. Chunk 1's read-time surfacing of the expiry flag has no data-side prerequisite beyond this preservation, which holds.

**L1 rename — title format:** PASS

`HDL Website Build` → `Website Build`. Drops client prefix per v4 title rule. Client column still carries the HDL association.

**engagement_type:** PASS

L1 `engagementType`: null → `"project"`. Matches spec "`engagement_type='project'` on all HDL L1s".

## Findings — expected and observed

All 6 planned field writes (per forward script) verified against post-snapshot and prod:

1. PASS — L1 `f9af3445…` `name`: `"HDL Website Build"` → `"Website Build"`
2. PASS — L1 `f9af3445…` `resources`: `"CD: Lane, Dev: Leslie"` → `"AM: Jill, CD: Lane, Dev: Leslie, PM: Jason"`
3. PASS — L1 `f9af3445…` `engagementType`: `null` → `"project"`
4. PASS — L2 `2c0f97a7…` (`Full Site Design Approval`, weekOf 2026-04-27) `resources`: `null` → `"HDL"`
5. PASS — L2 `b3eb2aea…` (`Ad Words`, weekOf 2026-05-11) `resources`: `null` → `"HDL"`
6. PASS — L2 `5f1e1687…` (`Production Shoot`, weekOf 2026-06-15) `resources`: `null` → `"HDL"`

**Audit trail:** 6 audit rows tagged with batch are present via `get_updates(clientSlug='hdl')`. Audit rows are in reverse chronological order:
- `Ad Words` resources → HDL  (2026-04-20T23:55:06)
- `Production Shoot` resources → HDL  (2026-04-20T23:55:06)
- L1 resources → full roster  (2026-04-20T23:55:05)
- L1 engagement_type → project  (2026-04-20T23:55:05)
- `Full Site Design Approval` resources → HDL  (2026-04-20T23:55:05)
- L1 name → `Website Build`  (2026-04-20T23:55:04)

All `updatedBy='migration'`. Summaries reference expected values. No unexplained extra audit rows for this client in this batch window.

## Findings — expected but NOT observed (CRITICAL)

None.

## Findings — observed but NOT expected

### UNEXPLAINED (CRITICAL)

None.

### INCIDENTAL (NON-CRITICAL)

- **L1 updatedAt bump:** `2026-04-20T23:06:58.000Z` → `2026-04-20T23:55:05.000Z`. Consequence of 3 field writes on the L1 row. Expected side-effect of any project field update. Non-critical.
- **L2 updatedAt bump on 3 touched rows:** `Full Site Design Approval`, `Ad Words`, `Production Shoot` each moved to `2026-04-20T23:55:05/06.000Z`. Expected consequence of `resources` field write. Non-critical.
- **8 non-targeted L2s unchanged:** `Full Site Design — Civ Delivers`, `Photo Shoot Prep`, `Start Development`, `Schema/SEO/AIO`, `Smokeball Integration`, `Domain/URL + Webflow`, `Site Staging`, `Site Live`. All 8 retain `resources` = `CD: Lane` or `Dev: Leslie` (Dev: Leslie on most), all updatedAt values preserved (still `2026-04-20T23:06:xx`), all titles intact. Sample verified via prod MCP queries for weeks 2026-04-20, 2026-04-27, 2026-05-04, 2026-05-18, 2026-06-08, 2026-06-29.
- **Client row untouched:** `client.updatedAt` preserved at `2026-04-20T06:45:39.000Z`. Team, contractStatus, contractTerm, contractValue, nicknames, clientContacts all identical pre → post → prod.

## Scope check

- HDL client: 1 row. Untouched (intended).
- HDL L1 projects: 1 row. Exactly 3 intended fields changed (name, resources, engagementType). No unintended fields changed. Status/category/owner/waitingOn/target/dueDate/startDate/endDate/contractStart/contractEnd/notes/staleDays/sortOrder all preserved.
- HDL L2 week items: 11 rows. Exactly 3 intended (`Full Site Design Approval`, `Ad Words`, `Production Shoot`) changed 1 field each (`resources`: null → `"HDL"`). The remaining 8 L2s untouched (pre == post, updatedAt frozen at 2026-04-20T23:06:xx).
- No cross-client collateral: sampled Bonterra/Hopdoddy/Soundly rows seen via shared-week queries all carry their own values (e.g., Bonterra `Impact Report — Go Live` resources `"Bonterra"`, not HDL; not mutated by this migration).

## TP decisions ratification

1. **Single-L1 interpretation:** RATIFIED. Single-L1 expansion to full client team is consistent with engaged-roles-per-L1. If a second HDL L1 appeared later with its own narrower engaged roles, this L1's full-roster value still holds because the full team is engaged on the single current project.
2. **Client-led resources = plain `"HDL"`:** RATIFIED. No role prefix, matches v4 convention. Applied uniformly to all 3 client-led L2s.
3. **Other 8 L2s left alone:** RATIFIED. Verified via prod — all 8 already have role-prefixed resources (`CD: Lane` or `Dev: Leslie`) and clean titles (no HDL prefix, proper category words separated). Sample: `Start Development` (kickoff, `Dev: Leslie`), `Smokeball Integration` (kickoff, `Dev: Leslie`), `Photo Shoot Prep` (delivery, `CD: Lane`), `Site Live` (launch, `Dev: Leslie`). No v4 drift to correct.

## Unexplained records

None.

## Confidence

**HIGH.** All 6 expected writes match prod exactly. All pre-apply values captured in the forward script's snapshot match the standalone pre-snapshot. No unexplained writes. No collateral damage to the 8 non-targeted L2s or the client row. Audit trail complete with 6 rows tagged to this batch. contract_status preservation intact. Client-led resources convention compliance intact.

## Overall recommendation

**ACCEPT.**
