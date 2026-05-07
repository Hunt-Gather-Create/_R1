# Dashboard cleanup — visual + behavioral fixes

## Summary

Closes 10 locked items from `docs/plans/dashboard-cleanup-pr.md` plus a stack of QA-discovered fixes layered during morning verification. The PR is structured as ~21 atomic commits so each finding can be reviewed in isolation. All visual decisions were operator-confirmed live during QA.

## What's in scope

### 10 locked plan items

| # | Description | Surface | Result |
|---|---|---|---|
| 3 | In Flight toggle into section header | This Week | ✓ shipped + extended to Needs Update during QA |
| 6 | Wrapper hide on Accounts View | Accounts | ✓ verify-only, regression test added |
| 7 | Empty client block hide on Accounts View | Accounts | ✓ verify-only, existing coverage confirmed |
| 1 | L2 cards show parent project | This Week | ✓ shipped + QA-fixed semantic (was wrapper, now L1) |
| 9 | READY TO CLOSE chip on L1s with no L2s past endDate | Accounts + Gantt | ✓ verified live in prod via test row under Hopdoddy (now removed) |
| 10 | Centralize Gantt color tokens | Gantt | ✓ refactor only, no visual change |
| 11 | Color scheme: completed muted, scheduled distinct | Gantt | ✓ shipped + QA-tweaked scheduled to violet (was teal — read as blue cousin of in-progress) |
| 12 | Project / Task visual hierarchy | Gantt | ✓ shipped, three-layer reinforcement (typography + marker bar + bar height) |
| 2 | Flags reorg into Delivery / Client / Resourcing | Flags panel | ✓ shipped + QA layered: per-section colors, top-level badge removed, today/tomorrow emoji predicate fix |
| 4 | Multi-day rows render once | This Week | ✓ shipped, all three placement zones verified live |

### QA-discovered fixes layered in

These were not in the original plan but were found and fixed during interactive QA per the operator's "fix in-PR, do not defer" rule:

- **Apparent header pinning** (pre-existing prod bug). `today-section.tsx` and `day-column.tsx` wrapped card grids in nested `overflow-y-auto` scrollports. macOS momentum scrolling triggered Chrome's scroll-anchoring, which visually "pinned" both Today and In Flight section headers as cards flowed past. Removed both nested scrollports — page now scrolls as one continuous container. (commit `b810da0`)
- **Today's deadline emoji never fired**. The `deliveryEmoji` predicate checked `flag.title` for "today", but `detectDeadlines` puts "today" in `flag.detail`. The unit-test fixture had cherry-picked a title containing "today" and masked the bug. Switched the predicate to `flag.severity === "warning"` (today=warning, tomorrow=info, already a reliable detector signal) and rewrote the fixture to mirror real production shape. (commit `852780f`)
- **`L1` user-facing text leak**. The standalone Gantt HTML output rendered `(L1)` in chart headers and an `L1` kind tag on each section. Operator-locked: end users say "Project" / "Task". Both fixed. (commit `d86c31b`)
- **Needs Update toggle parity**. The locked Item 3 named only "In Flight" but the toggle pattern was meant to cover multiple sections. Added a Needs Update toggle mirroring In Flight (component + server action + view-preferences field). Toggled-off state keeps heading + count badge visible so users see what's hidden. (commits `45b1def`, `2e1277c`)
- **Item 1 semantic fix**. `buildParentProjectNameMap` was emitting the WRAPPER name as the card subtitle (e.g. "1H Convergix Retainer") for retainer-nested L2s and emitting NOTHING for top-level L1 tasks (e.g. "Pencils Down"). Changed to a single-hop lookup: every L2 card now shows its immediate L1 project name. Also drops one batched query — addresses W4 audit WARN around sequential awaits. (commit `1bb4df9`)
- **Flag panel color overhaul**. Operator-flagged: alarm-red 🔴 past-end emoji + saturated red Needs Update palette + top-level "22" badge + severity-coded borders all combined to make the dashboard feel scary. Fixes:
  - Past-end-l2 emoji 🔴 → 🟠 (less alarming) (commit `350e614`)
  - Needs Update palette: `text-red-400` → `text-red-300/90`, toggle ON `bg-red-500` → `bg-red-500/75` (commit `350e614`)
  - Per-section borders (replaces severity-coded borders): Delivery=sky, Client Warnings=violet, Resourcing Warnings=emerald — severity now lives only in the icon (commit `ad9068f`)
  - Top-level "Flags 22" badge removed; per-section count badges in section colors (commit `ad9068f`)
- **DRY refactor in Account-tier vs Gantt-RSC**. `ReadyToCloseChip` was defined inline in both views; `NoScheduledTasksChip` only existed on By Account. Centralized both into `section-chips.tsx` with a `variant: "light" | "dark"` prop. Added `NoScheduledTasksChip` to the Gantt dark embed for parity. Promoted `weekItemsForSection` and `l1IdForSection` to `section-builders.ts` so both views import the same predicates. (commits `b99e012`, `24fb393`)
- **Scheduled bar palette**. The agent landed on teal/cyan for scheduled. QA flagged it as a "blue cousin" of the in-progress blue at small bar sizes. Switched to violet across all 3 themes — sits opposite blue on the wheel, calm but distinct. (commit `0f98769`)
- **Completed row text dim on dark**. Operator wanted the title + meta on completed rows to read as "done" matching the muted slate bar (without strikethrough — that stays exclusive to canceled). Mirrors the LIGHT_INTERNAL.completed.rowText behavior already shipped on the light themes. (commit `0f98769`)
- **Toggle-off badge persistence**. With the toggle inline in the section header, hiding the section also hid the count. Operator: "I want to know what's being hidden by the toggle." Count badge now stays when toggled off; cards + description still collapse. (commit `2e1277c`)

### Out-of-scope cleanup discovered + executed

- **ABM client deleted**. ABM was test data; not working with that client. 36 rows removed across 3 tables (5 projects, 5 weekItems, 25 audit `updates`, 1 client). Verified no other client touched: `13 → 12 clients`, `59 → 54 projects`. Background agent dispatch with read-only DRY-RUN inventory before deletion. Report: `docs/tmp/abm-deletion-report-2026-05-07.md`.

## Tests

| Metric | Value |
|---|---|
| Baseline (upstream/runway) | 3442 |
| Final (after all commits + QA) | 3553 |
| Tests added | +111 |
| Test files added | 4 (colors.test.ts, section-chips.test.tsx, needs-update-toggle.test.tsx, plus holdout suite from initial agent run) |
| Lint | 0 errors, 13 warnings (all pre-existing baseline) |

## Visual decisions locked during QA

| Surface | Decision | Hex / value |
|---|---|---|
| Gantt scheduled (all 3 themes) | Violet (was teal) | `#8b5cf6` light-internal, `#7c3aed` light-branded, `bg-violet-500/60` dark |
| Gantt completed | Muted slate | `#cbd5e1` light, `bg-slate-500/50` dark + dimmed row text |
| L1 marker bar (Item 12) | Civ brand blue | `#0E5DFF` light, `bg-blue-400/70` dark |
| Delivery flags emoji | 🔥 today / ⏰ upcoming | — |
| Past-end-l2 emoji | 🟠 (was 🔴 alarm) | — |
| Flag panel borders | Per-section colors | Delivery=sky, Client=violet, Resourcing=emerald |
| Needs Update palette | Toned (was alarm-coded) | `text-red-300/90`, toggle `bg-red-500/75` |

## Test plan for reviewer

- [ ] Pull the branch, `pnpm install`, `pnpm dev`, open `/runway`
- [ ] **This Week tab**: In Flight + Needs Update each have an inline toggle in the section header (count + toggle stay visible when off)
- [ ] No section "pinning" while scrolling up/down through Today + In Flight
- [ ] L2 cards on This Week show **L1 project name** as subtitle (e.g. "Pencils Down" → "Website Revamp"). NOT the wrapper name.
- [ ] **Flags panel**: top-level "Flags N" badge removed; each section header has its own count badge in section color
- [ ] Today's deadline cards show 🔥 (fire), tomorrow's show ⏰ (alarm clock)
- [ ] Past-end-l2 cards show 🟠 (orange circle), not 🔴
- [ ] Multi-day rows render in exactly ONE zone (Today/In Flight if currently spanning, This Week day cell if future-dated)
- [ ] **Gantt Charts tab**: completed bars are muted slate (not green) with dim title text; scheduled bars are violet (clearly distinct from in-progress blue)
- [ ] Project rows visibly heavier than Task rows (typography + brand-blue marker bar + thicker timeline bar)
- [ ] L1 with no L2s under a wrapper (or top-level): shows both READY TO CLOSE + NO SCHEDULED TASKS chips on both By Account AND Gantt Charts
- [ ] Standalone Gantt CLI HTML output: chart header reads "(Project)" not "(L1)"; section kind tag reads "Project" not "L1"

## Deployment notes

- No schema changes
- One added field on `view_preferences` JSON: `needsUpdateToggle: boolean` (defaults to `true`); old rows merge cleanly via `parsePreferences()`'s default-spread
- Vercel preview build expected to pass (lint clean, all tests green, no new external deps)
- Two reports left in `docs/tmp/` for audit trail: agent's run reports + ABM deletion report
