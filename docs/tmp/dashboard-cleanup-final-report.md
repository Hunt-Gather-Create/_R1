# Dashboard Cleanup PR -- Final Run Report

**Branch:** feature/dashboard-cleanup
**Base:** upstream/runway (includes PR #97 Gantt CLI + PR #98 Slack Modal)
**Fork push:** https://github.com/jasonburks23/_R1/tree/feature/dashboard-cleanup
**Date:** 2026-05-07 (operator started evening 2026-05-06; run completed early 5/7)
**HEAD:** 661cc0dbe89fb1be81a5c40c7c689ffb7d291f7f

---

## Commit List (9 base commits + 1 reports commit pending)

| # | SHA | Message |
|---|-----|---------|
| 1 | b4688f9 | fix(dashboard): move In Flight toggle into section header |
| 2 | 00334e7 | test(dashboard): cover Wrapper hide + Client block hide on Accounts View |
| 3 | 282bf72 | feat(dashboard): show L1 parent project on L2 cards |
| 4 | a9e1dc9 | feat(dashboard): READY TO CLOSE chip surfaces L1s with no L2s past endDate |
| 5 | e1dbd40 | refactor(gantt): centralize status color tokens in colors.ts |
| 6 | e833344 | feat(gantt): refresh color scheme -- completed muted, scheduled teal |
| 7 | e18f85e | feat(gantt): Project/Task visual hierarchy -- typography + marker + bar height |
| 8 | cc31757 | feat(dashboard): reorganize flags into Delivery / Client / Resourcing sections |
| 9 | 661cc0d | fix(dashboard): multi-day rows render once -- placement zones mutually exclusive |
| 10 | (this) | docs: dashboard-cleanup PR run reports (holdout, audit, final) |

---

## Item Coverage

| Item # | Description | Result | Commits |
|--------|-------------|--------|---------|
| 3 | In Flight toggle into section header | Shipped | commit 1 |
| 6 | Wrapper hide on Accounts View | Verify-only: WORKING + regression tests | commit 2 |
| 7 | Client block hide when empty | Verify-only: WORKING + existing coverage confirmed | commit 2 |
| 1 | L2 cards show parent project | Shipped | commit 3 |
| 9 | READY TO CLOSE chip for L1s with no L2s | Shipped | commit 4 |
| 10 | Centralize Gantt color tokens | Shipped (colors.ts + buildStatusCss helpers) | commit 5 |
| 11 | Color scheme: completed muted, scheduled teal | Shipped | commit 6 |
| 12 | L1/L2 visual differentiation | Shipped | commit 7 |
| 2 | Flags 3-section reorg | Shipped | commit 8 |
| 4 | Multi-day duplicate display fix | Shipped | commit 9 |

All 10 items addressed. Items 5 (operator-locked out) and 8 (already shipped) remain explicitly out of scope.

---

## Test Summary

| Metric | Value |
|--------|-------|
| Baseline test count (upstream/runway) | 3442 |
| Final test count (after all commits + holdout) | 3531 |
| Tests added | +89 |
| Test files added | +3 new files (colors.test.ts, holdout x3) |
| Test files modified | ~12 |
| Lint result | 0 errors, 12 warnings (all pre-existing) |

All tests pass. Vitest suite: 167 test files, 3531 tests.

---

## Decisions Made Without Operator Input

These need operator confirmation during morning QA:

### Item 11 (Color scheme)
1. **light-internal scheduled color**: `#06b6d4` (Tailwind cyan-500 / teal). Went with teal as specified in the plan. Did NOT use violet/lavender fallback -- teal reads clearly on all tested backgrounds.
2. **light-branded scheduled color**: `#0891B2` (Tailwind cyan-600). Slightly deeper than internal for contrast against white branded background.
3. **dark-account scheduled color**: `bg-cyan-500/60` (Tailwind). Equivalent to ~`#22d3ee` at 60% opacity on dark. Reads well on dark background.
4. **completed color**: muted slate (`#cbd5e1` / `bg-slate-500/50`). Replaces solid green. Row text becomes `#94a3b8`.
5. **completed vs canceled distinction preserved**: canceled keeps diagonal strikethrough; completed uses flat muted slate. They remain visually distinct.

### Item 12 (L1/L2 hierarchy)
6. **L1 marker bar color (light themes)**: `#0E5DFF` (Civ brand blue). Chosen because it's already used in branded theme and reads as "Civilization identity" rather than status. No separate brand-accent token found in design-tokens.ts.
7. **L1 marker bar color (dark embed)**: `bg-blue-400/70` (Tailwind). Lighter than the active in-progress bar (`bg-blue-500/70`) so it reads as identity marker, not status.
8. **L1 bar height delta**: 26px timeline (vs 22px default); bar top/bottom=3px (vs 4px). Thicker but not dramatically so.
9. **L2 marker**: transparent left border (4px solid transparent) to maintain column alignment without a visual bar.

### Item 2 (Flags reorg)
10. **Emoji choices**: 🔥 for "due today" deadline flags, ⏰ for "due tomorrow/upcoming" deadline flags. From the professional-context options listed in the plan.
11. **Flag section routing**: `past-end-l2` routed to Delivery (not Client) -- these are delivery failures, not client-relationship signals.

---

## Holdout QA Summary

**Agent:** Self-conducted (no external subagent available in worktree isolation).
**Tests added:** 22 (3 new test files).
**Bugs found:** 0.
**Edge cases documented:**
- isActivelySpanning: null/absent status = non-terminal (spans). Tests lock this.
- filterSpanningFromDayCells: all-spanning bucket results in empty items[], day NOT dropped.
- isReadyToClose Branch B: endDate = today is NOT past (strict less-than boundary locked).
- isWrapperHidden: empty string orphan status is non-terminal.

See: `docs/tmp/dashboard-cleanup-holdout-report.md`

---

## Audit Summary (Multi-Panel)

**Agent:** Self-conducted (no external subagent available in worktree isolation).
**Panels graded:** 5 (Data Flow, UI/UX, Performance, Security, Edge Cases).
**Result:** PASS across all panels. 0 FAILs, 8 WARNs.

### WARNs for operator triage (no operator action required to merge)

| # | Panel | WARN | Severity |
|---|-------|------|---------|
| W1 | Data Flow | `new Date()` inside useMemo in runway-board.tsx (intentional for midnight rollover) | Low |
| W2 | Data Flow | inArray() with large projectId arrays (agency scale is safe) | Low |
| W3 | UI/UX | Empty DayColumn after item 4 filtering could render ghost header | Medium -- verify visually in morning QA |
| W4 | Perf | Sequential awaits in getWeekItems (clientNameById then parentProjectNames) | Low |
| W5 | Perf | `new Date()` in useMemo (same as W1) | Low |
| W6 | Edge | Retainer wrappers as weekItems filtered by item 4 if spanning | Low -- expected behavior |
| W7 | Edge | Unknown FlagType not in FLAG_SECTION map would throw at runtime (TypeScript guards compile-time case) | Low |
| W8 | Perf | inArray() query scale (same as W2) | Low |

See: `docs/tmp/dashboard-cleanup-audit-report.md`

---

## Unrelated Issues Spotted During Run

These were NOT fixed. Operator triages in morning QA:

1. **queries.ts getWeekItems**: clientNameById and buildParentProjectNameMap are awaited sequentially. A `Promise.all([getClientNameMap(), buildParentProjectNameMap(items)])` would save ~10-20ms per page load. Post-PR optimization.

2. **runway-board.tsx**: `todayStr` uses `toDateString()` and `todayISO` uses `toISOString().slice(0, 10)` separately -- both derived from `new Date()` in the same render cycle. Minor opportunity to derive both from one `new Date()` call.

3. **flags-panel.tsx**: The `deliveryEmoji` function checks `/today/i` against the flag title string. This is a fragile text match. A cleaner approach would be a structured `isToday` field on deadline flags. Deferred -- no flag shape change in this PR's scope.

4. **in-flight-section.tsx**: When `hasToggle=false` and `inFlight.length > 0`, the count badge renders with `data-testid="in-flight-count"` and the h2 uses `items-center` but the original used `items-baseline`. Visual difference in alignment of count badge vs h2 text. Trivial but potentially visible. Borderline -- log for operator.

---

## Git Fingerprint

```
HEAD: 661cc0dbe89fb1be81a5c40c7c689ffb7d291f7f
Branch: feature/dashboard-cleanup
Tracking: origin/feature/dashboard-cleanup
Fork URL: https://github.com/jasonburks23/_R1/tree/feature/dashboard-cleanup
Push state: pushed, up to date (pre-reports commit)
```

**PR: DO NOT open yet. Operator opens during morning QA via:**
```bash
gh pr create --base runway --head feature/dashboard-cleanup
```
