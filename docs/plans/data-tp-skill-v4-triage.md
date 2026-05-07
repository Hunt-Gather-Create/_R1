# Data-TP Skill v4 Triage

Consolidated tracker for `data-integrity-tp` / `data-evaluator-tp` skill v4 patch candidates. Replaces the per-cohort markdown drops in `docs/data-tp/skill-patches/`. Owner: Claude (assistant) — update this file as candidates move through landing.

**Started:** 2026-05-07 (consolidation of 2026-05-02 closed-cohort + 2026-05-03 AG1-postdrafter source files).

## Status legend

- 🔴 **OPEN** — not landed
- 🟡 **IN-FLIGHT** — landing in progress (commit / PR linked)
- 🟢 **LANDED** — text shipped in skill (or code patched), version bumped if applicable
- ⚪ **DROPPED** — operator decision: not landing

## Triage table

Sorted by recommended landing order.

| #     | Severity        | Title                                                              | Target file(s)                                              | Status   | Source         |
| ----- | --------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- | -------- | -------------- |
| 25    | **CRITICAL**    | Parent date override clobbered by child-triggered recompute       | `SKILL.md` + `data-conventions.md` + `holdout-panels.md`    | 🔴 OPEN | 2026-05-02 Cgx |
| 26    | **HIGH**        | Cascade-date-change should emit audit row                          | `recomputeProjectDatesWith` code + `data-conventions.md`    | 🔴 OPEN | 2026-05-03 AG1 |
| 24    | Process         | dayOfWeek/date calendar verification at spec-time                  | `drafter-prompt.md` + `rails-reference.md`                  | 🔴 OPEN | 2026-05-02 Cgx |
| SEC-1 | Process         | Mandatory cascade guard on every dueDate write                     | `drafter-prompt.md` + `rails-reference.md`                  | 🔴 OPEN | 2026-05-02 Cgx |
| SEC-2 | Process         | Single-day L2 needs paired endDate write                           | `drafter-prompt.md`                                         | 🔴 OPEN | 2026-05-02 Cgx |
| SEC-3 | Process         | Notes replace-vs-append discipline                                 | `drafter-prompt.md` + `data-conventions.md`                 | 🔴 OPEN | 2026-05-02 Cgx |
| 23    | Process         | Multi-day work-window vs single-day milestone decision pattern     | `drafter-prompt.md` + `data-conventions.md`                 | 🔴 OPEN | 2026-05-02 Cgx |
| 22    | Ergonomic       | Status flip out-of-`kickoff` should prompt category flip           | `drafter-prompt.md` + `data-conventions.md`                 | 🔴 OPEN | 2026-05-02 Cgx |
| 20    | Reference       | MCP `update_project_field` doesn't allow `category` (wrapper gap) | `data-conventions.md` + `SKILL.md`                          | 🔴 OPEN | 2026-05-02 Cgx (refined 2026-05-03) |
| H     | Reference       | Helper-name accuracy: `updateWeekItem` → `updateWeekItemField`     | `data-conventions.md` + `drafter-prompt.md`                 | 🔴 OPEN | 2026-05-03 AG1 |

## Recommended landing order

1. **#25 CRITICAL** — lands BEFORE next high-volume batch on any wrapper-having client. Without it, parent date overrides silently clobbered by child-triggered recompute.
2. **#26 HIGH** — lands BEFORE next L2-date-write batch on any client. Without it, audit trail undercounts cascade-date-change rows.
3. **Drafter-discipline cluster (#24, SEC-1, SEC-2, SEC-3)** — land together in `drafter-prompt.md`. ~36 lines combined.
4. **#23** — pre-spec decision matrix; complements drafter cluster.
5. **#20 + #22 + Helper-name accuracy (H)** — convenience cluster, low priority.

## Bump signal

- Default: 6-of-9-numbered candidates landed → bump v4.1; all landed → v4.2.
- Alternative: bump only when #25 lands (the version-defining patch); other 8 are non-version-bumping additions.
- Operator decides at landing time.

## Per-candidate one-paragraph summaries

Pointers back to the source files for full text, code snippets, and proposed skill-patch language.

### #25 — Parent date override clobbered by child-triggered recompute (CRITICAL)

When a batch includes a parent L1 date override AND child L2 writes on that same parent's children, the child writes trigger `recomputeProjectDatesWith` on the parent and clobber the override unless ops are reordered (override last). Validated 4× during Convergix arc; 4th instance was successful application of the proposed defense (op-order: parent override AFTER child writes within the same batch). Required a post-batch fix-override on `convergix-status-sweep-2026-05-02-fix` when defense wasn't applied. **Risk if not landed:** silent prod data loss. Caught today only because verify scripts had explicit assertions on Card 2 endDate.

**Full text:** `docs/data-tp/skill-patches/v4-candidates-2026-05-02.md` § #25.

### #26 — Cascade-date-change should emit audit row (HIGH)

`recomputeProjectDatesWith` raw-UPDATEs the `projects` table when L2 date writes shift the parent's derived `startDate`/`endDate`, but emits no audit row. Codebase has `cascade-status` and `cascade-duedate` audit types but no `cascade-date-change`. AG1 batch `ag1-batch-2026-05-03` Op 4 returned 5 audit rows when 6 were expected. Code-side patch on `src/lib/runway/operations-writes-week.ts:83`; skill-side documentation in `data-conventions.md` § Cascade behavior. **Risk if not landed:** audit-trail incompleteness; every prior cohort that touched L2 dates likely under-counted by 1 per parent boundary crossed.

**Full text:** `docs/data-tp/skill-patches/v4-candidates-2026-05-03-postdrafter.md` § #26.

### #24 — dayOfWeek/date calendar verification at spec-time

Drafter must verify `dayOfWeek` matches the actual calendar day for any `date` field BEFORE writing the triplet. Currently TP catches mismatches at review time. 3 distinct catches across 3 Cgx batches; one (Daniel Scope Ask "5/5 monday" → 5/5/2026 is Tuesday) caught pre-drafter-dispatch via halt rule. **Proposed:** add point 13 to `rails-reference.md` § 12-point pre-APPLY checklist; add calendar-verification block to `drafter-prompt.md`.

**Full text:** `docs/data-tp/skill-patches/v4-candidates-2026-05-02.md` § #24.

### SEC-1 — Mandatory cascade guard on every dueDate write

Every `update_project_field({field: "dueDate"})` call on a project that has deadline-category L2 children MUST ship with the cascade-safe recipe (flip category to `delivery` → write date → flip category back to `deadline`) — all three ops in the same `batch_apply`. Currently caught retroactively in `convergix-cards-2026-05-01` Round 4 after rails review. **Risk if not landed:** forward-cascade corruption on deadline L2s.

**Full text:** `docs/data-tp/skill-patches/v4-candidates-2026-05-02.md` § SECONDARY-1.

### SEC-2 — Single-day L2 needs paired endDate write

When specing a single-day L2 row, drafter must include both `date` AND `endDate` (with `endDate==date`). Currently easy to forget the `endDate` half — leaves rows in non-conforming "single-day with endDate=null" shape. CAT 4 sweep on Cgx fixed 5 stale rows that had been created without paired endDate writes. Drafter checklist: `date` ✓, `startDate` ✓, `endDate` ✓, `dayOfWeek` ✓, `weekOf` ✓ (LAST per row). HALT if any missing.

**Full text:** `docs/data-tp/skill-patches/v4-candidates-2026-05-02.md` § SECONDARY-2.

### SEC-3 — Notes replace-vs-append discipline

Every notes write in a spec must declare `replace` or `append` explicitly. MCP path defaults to replace; helper path can do either. Without explicit intent, drafter has guessed wrong → duplicate sentence drift (Cgx A8 R2-presentation duplicate, A12 Daniel-blocker duplicate). De-dupe rule: before any notes write, drafter scans the proposed new value for sentences that exist verbatim in current notes; flag duplicates to TP.

**Full text:** `docs/data-tp/skill-patches/v4-candidates-2026-05-02.md` § SECONDARY-3.

### #23 — Multi-day work-window vs single-day milestone decision pattern

Pre-spec decision matrix for any L2 row touching `date`/`startDate`/`endDate`. Multi-day work-window: `startDate=work begin, date==endDate, startDate < endDate`. Single-day milestone: `date=startDate=endDate`. TP states intent BEFORE drafter dispatch; drafter never flags "ambiguity" on shape — if shape looks wrong, REVERSE-flag to TP for re-spec.

**Full text:** `docs/data-tp/skill-patches/v4-candidates-2026-05-02.md` § #23.

### #22 — Status flip out-of-`kickoff` should prompt category flip

When an L1 status moves out of `kickoff` (to `in-progress`, `in-production`, `blocked`, `at-risk`, `scheduled`) AND current category is `kickoff`, drafter warns in spec output (does NOT auto-flip). TP decides per-row: flip to `delivery`/`active` (typical post-kickoff) OR keep `kickoff` (work still in setup phase). Add explicit `category` field to spec when flip; omit when keep.

**Full text:** `docs/data-tp/skill-patches/v4-candidates-2026-05-02.md` § #22.

### #20 — MCP `update_project_field` doesn't allow `category` (wrapper gap, not helper gap)

Original framing implied helper-level whitelist excludes `category`. Drafter-confirmed code reality (per 2026-05-03 AG1 read): `category` IS in `PROJECT_FIELDS` at `operations-utils.ts:323`. The gap is at the **MCP wrapper layer** (`update_project_field` MCP tool surface), not the helper. Triplet authors can write category freely via `updateProjectField`; only MCP-path operator sessions hit the gap. Narrows scope vs the original 2026-05-02 framing.

**Full text:** `docs/data-tp/skill-patches/v4-candidates-2026-05-02.md` § #20 + clarification in `v4-candidates-2026-05-03-postdrafter.md` § #20.

### H — Helper-name accuracy: `updateWeekItem` → `updateWeekItemField`

Drafter found pre-drafter spec referenced `updateWeekItem` but actual helper is `updateWeekItemField` (with `weekOf + weekItemTitle` resolution). Spot-check `data-conventions.md` § Helper signatures and `drafter-prompt.md` for any stale `updateWeekItem` references; correct to `updateWeekItemField` if found. Reference-only patch, no behavior change.

**Full text:** `docs/data-tp/skill-patches/v4-candidates-2026-05-03-postdrafter.md` § Corrections / Helper-name accuracy.

## Source files (slated for removal in docs hygiene audit)

This file consolidates and replaces the per-cohort drops below. Once landings begin landing through this triage tracker, the source files become redundant and are queued for removal in the docs hygiene audit (see `MEMORY.md` task #8).

- `docs/data-tp/skill-patches/v4-candidates-2026-05-02.md` (closed Hop/TAP/Sou/Cgx cohort, 8 candidates)
- `docs/data-tp/skill-patches/v4-candidates-2026-05-03-postdrafter.md` (AG1 mid-flight, 1 candidate + corrections)

Do **not** delete the source files until the first candidate has landed via this tracker — they remain the authoritative full-text reference until then.
