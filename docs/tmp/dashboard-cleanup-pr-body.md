# Dashboard cleanup — visual + behavioral fixes

## Summary

Closes 10 locked items from `docs/plans/dashboard-cleanup-pr.md` plus a stack of QA-discovered fixes and a post-QA cleanup pass (DRY refactor, data-tp tooling brought to runway side). The PR is structured as 27 atomic commits so each finding can be reviewed in isolation. All visual decisions were operator-confirmed live during QA.

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

### Post-QA cleanup pass

A `/code-review` sweep after QA flagged remaining warts that were fixed in-PR rather than deferred:

- **DRY collapse: shared `<SectionToggle>` + `<SectionHeader>`** (commit `11f2222`). Two near-identical toggle components (`InFlightToggle`, `NeedsUpdateToggle` — ~110 lines each) and the matching header rows in their parent sections collapsed into one preset-driven `<SectionToggle section="in-flight" | "needs-update">` and one `<SectionHeader>`. Net `-81` lines, zero behavior change, stable test ids preserved. Parametrized `section-toggle.test.tsx` (33 cases) replaces 3 separate toggle test files. Adds `actions.test.ts` thin coverage for the two server actions.
- **data-tp skills brought to runway-bound side** (commit `aadce3f`). The `data-evaluator-tp` and `data-integrity-tp` skill directories existed only on `origin/main` (Jason's fork) and never crossed to `upstream/runway`. Worktrees branched from runway couldn't see them in slash autocomplete. Latest in-flight content (10 markdown files, ~2000 lines) committed onto this branch so they land on runway via this PR. Tim's R1 main intentionally stays clean of these — they are Runway-specific operator tooling.
- **data-tp memory-layer docs brought to runway-bound side** (commit `e32b15e`). Same root cause as the skills: `docs/data-tp/cohort-handoff.md` (rolling session log read by the data-integrity-tp skill), plus the two `skill-patches/v4-candidates-*.md` files lived only on parent main. All three brought across so future TP sessions reading from runway aren't amnesiac.
- **v4-triage tracker** (commit `0ecfb44`). The two per-cohort `v4-candidates-*.md` files are point-in-time captures that duplicate as more cohorts close. Replaced with a single durable triage doc at `docs/plans/data-tp-skill-v4-triage.md` indexing all 10 known patch candidates with mutable status fields (open / in-flight / landed / dropped). The two source files stay in the PR for full-prose reference but are queued for removal in a follow-up docs hygiene audit once the first patch lands via the new tracker.

## Tests

| Metric | Value |
|---|---|
| Baseline (upstream/runway) | 3442 |
| Final (after all commits + QA + post-QA cleanup) | 3565 |
| Tests added | +123 |
| Test files added | 5 (`colors.test.ts`, `section-chips.test.tsx`, `section-toggle.test.tsx`, `actions.test.ts`, plus holdout suite from initial agent run) |
| Lint (changed files) | 0 errors, 0 warnings |
| Lint (full repo) | 0 errors, 13 warnings — all pre-existing baseline in files this PR doesn't touch |
| `/preflight` | ✅ build, grep gate, tests, lint all green |
| `/pr-ready` | ✅ no `console.log`, no `debugger`, no `TODO`/`FIXME`, no `any` types in changed files |

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
- [ ] Both section toggles (In Flight, Needs Update) flip via the shared `<SectionToggle>`; click each, refresh page, verify state persisted via `view_preferences`
- [ ] Slash command parity (post-merge + post-`git checkout runway` in parent repo + CC restart): `/data-evaluator-tp` and `/data-integrity-tp` autocomplete, the data-tp skills find their cohort-handoff and skill-patch docs at `docs/data-tp/`

## Deployment notes

- No schema changes
- One added field on `view_preferences` JSON: `needsUpdateToggle: boolean` (defaults to `true`); old rows merge cleanly via `parsePreferences()`'s default-spread
- Vercel preview build expected to pass (lint clean, all tests green, no new external deps). Cross-fork canary deploy validated locally before opening PR.
- New non-code files brought across to runway side (skill files + memory-layer docs): `.claude/skills/data-evaluator-tp/`, `.claude/skills/data-integrity-tp/`, `docs/data-tp/cohort-handoff.md`, `docs/data-tp/skill-patches/`, `docs/plans/data-tp-skill-v4-triage.md`. None are imported by application code; they're operator tooling for the data-tp workflow that the runway-side skills consume.
- Two reports left in `docs/tmp/` for audit trail: agent's run reports + ABM deletion report
