# Old-scheme board cards tagged to the Runway epic (2026-08-14)

Discovered read-only by a board audit. These 23 cards carry Epic "10 Runway" (id 7bfb1347) on fleet Project #1 but use an OLD milestone naming scheme that predates the current 4-value scheme (00 Cleanup Sprint / 01 Schedule Sync / 03 Meeting Routing / 99 Old Tickets). NONE live in the `_R1` repo — they are cross-repo cards (agency-os, agencyos-operational-efficiency, civ-account-manager).

**No cards were moved. Awaiting operator decision (a/b/c).**

Several overlap live roadmap work — flagged in the "roadmap fit" column.

| Issue | Repo | Title (short) | Dead milestone value | Roadmap fit |
|---|---|---|---|---|
| #210 | agency-os | Policy: dense client-data registries | 01 Data Integrity Tool port | **M2 (DI tool)** |
| #211 | agency-os | Safe Prod-DB-update tool + SOP | 01 Data Integrity Tool port | **M2 (DI tool) — core** |
| #43 | civ-account-manager | No-summary meetings, reprocess | 02 Data Integrity migration into a programmatic tool | **M2 (DI tool)** |
| #121 | agency-os | PARALLEL: Runway Phase 1b Sheet sync ship | 03 Google Sheets Schedules Integration | **M1 (Sheet sync)** |
| #18 | civ-account-manager | Investigate Sheets Timeline alternatives | 03 Google Sheets Schedules Integration | M1-adjacent |
| #37 | civ-account-manager | Schedule chain-integrity QA test | 03 Google Sheets Schedules Integration | M1-adjacent |
| #28 | civ-account-manager | Migrate Civ shared drive meeting summaries | 05 Runway Hardening Meeting Notes Pipeline | **M3 (meeting)** |
| #30 | civ-account-manager | AM pointer map: where meetings live | 05 Runway Hardening Meeting Notes Pipeline | **M3 (meeting)** |
| #44 | civ-account-manager | Local meeting-file deletion after QA | 05 Runway Hardening Meeting Notes Pipeline | M3-adjacent |
| #45 | civ-account-manager | Normalize old-shape meeting files | 05 Runway Hardening Meeting Notes Pipeline | M3-adjacent |
| #31 | civ-account-manager | BP drive cleanup + consolidation | 06 Runway Hardening Meeting Pipeline Integration | M3-adjacent |
| #36 | civ-account-manager | Universal-file backfill on 5 clients | 06 Runway Hardening Meeting Pipeline Integration | M3-adjacent |
| #39 | civ-account-manager | New-business call handling, Drive routing | 06 Runway Hardening Meeting Pipeline Integration | M3-adjacent |
| #40 | civ-account-manager | Convergix iubenda handoff, AM discovery | 06 Runway Hardening Meeting Pipeline Integration | AM lane? |
| #41 | civ-account-manager | New-biz meeting filing + prospect check | 06 Runway Hardening Meeting Pipeline Integration | M3-adjacent |
| #158 | agency-os | AM parallel lanes awareness | 04 Runway Hardening AM Process Integration | AM lane? |
| #8 | civ-account-manager | Audit existing tracked content for Drive IDs | 04 Runway Hardening AM Process Integration | AM lane? |
| #9 | civ-account-manager | Audit docs/ folder: git vs Drive | 04 Runway Hardening AM Process Integration | AM lane? |
| #10 | civ-account-manager | Tracker: files outside local-vs-Drive split | 04 Runway Hardening AM Process Integration | AM lane? |
| #12 | civ-account-manager | Tighten AM SKILL.md scope | 04 Runway Hardening AM Process Integration | AM lane? |
| #17 | civ-account-manager | Align client folder shape to clients/slug | 04 Runway Hardening AM Process Integration | AM lane? |
| #42 | civ-account-manager | Duplicate shared-drives cleanup | 04 Runway Hardening AM Process Integration | AM lane? |
| #166 | agencyos-operational-efficiency | _R1 repo un-gated, no pre-commit hooks | 03 Fleet Hardening | Ops/infra lane |

## Notes
- The "AM lane?" and "Ops/infra lane" rows may belong to those seats, NOT Runway — moving them risks stepping on cross-seat work. Confirm ownership before any remap.
- The M2/M3-fit rows are candidate INPUTS to those epics when shaped, not junk to shelve.
- Operator decision options: (a) leave put, fold relevant into roadmap, retire truly-dead later [recommended]; (b) move all to "99 Old Tickets" now; (c) operator reviews first.
