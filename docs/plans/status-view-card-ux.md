# Status View + Card UX bundle

**Branch:** `feature/status-view-card-ux`
**Target:** Monday 2026-06-01 standup
**Drafted:** 2026-05-31

---

## Goal

Build Civilization's Monday-morning status view + ship the highest-leverage card UX wins (checkbox + pencil) on the dashboard surfaces.

Single shared PR. Operator wants no follow-up cleanup PR — everything lands together or gets explicitly deferred.

---

## Scope

| Commit | Subject | GH closure |
|---|---|---|
| 1 | `docs: plan for status view + card UX bundle` | — |
| 2 | `fix(runway): gantt renders retainer direct work items alongside L2 children (#65)` | Fixes #65 |
| 3 | `fix(runway): wrapper with only orphan weekItems hides instead of rendering dead zone (#42)` | Fixes #42 |
| 4 | `feat(runway): audit pill expands on click to show contributing issues (#66)` | Fixes #66 |
| 5 | `feat(runway): card complete checkbox with undo toast (closes #9, partial #67)` | Closes #9, partial #67 |
| 6 | `feat(runway): card pencil icon opens edit modal (UX discoverability)` | — |
| 7 | `feat(runway): Status View tab — Account → Project → Date + bucket banners (closes #64)` | Fixes #64 |

---

## Out of scope (explicit)

- Rest of #67 — wrapper layer + subtasks. The checkbox half ships here. Operator will edit #67 to drop the checkbox from its remaining scope.
- Read-only Status View — operator confirmed interactive (reuses existing modal).
- 4-bucket precedence — confirmed mutually exclusive in production, so each card inherits its dashboard section's color directly.
- Mobile-first treatment — desktop standup-projection use case primary; mobile should not break but is not the design driver.

---

## Commit 2 — #65 Gantt retainer-direct work items

**Problem:** in `src/lib/runway/gantt/resolve-helpers.ts:19-30`, a top-level retainer L1 is classified as a "wrapper" the moment it gains any L2 sub-project. Once classified, `build-raw-data.ts:27-34` collapses its direct work items into `orphanWeekItems` and the row transformer never emits them. Hopdoddy's Digital Retainer was the production bite — 19 direct WIs invisible after one L2 was added.

**Fix:** wrappers render BOTH L2 children AND direct work items as Gantt rows. Two options:
- **A.** Include direct WIs in `children` alongside sub-projects with a discriminator
- **B.** Add a parallel `directWeekItems` field that the row transformer walks separately

**Recco: B.** Cleaner type discrimination, no union shenanigans in `children`. Order rows chronologically by `startDate` ASC, direct WIs interleaved with L2 children by date.

**Tests:** new coverage at `build-raw-data.test.ts` for the mixed-children case (wrapper with 1 L2 child + 3 direct WIs, expect 4 rows in date order).

---

## Commit 3 — #42 Wrapper orphan-only dead zone

**Problem:** `filterActiveRundown` keeps any wrapper with `raw.orphanWeekItems.length > 0` regardless of whether AccountTier knows how to render orphans. AccountTier never iterates orphans → empty wrapper header, no content.

**Fix (Option B per the issue):** filter the wrapper out of `filterActiveRundown` when ALL its content is orphan (zero L1 children + zero non-orphan content). Cleaner than teaching AccountTier orphan iteration.

**Tests:** add coverage to `filterActiveRundown` for the orphan-only case.

---

## Commit 4 — #66 Audit pill expand on click

**Problem:** "N critical, M warnings" pill on each rundown section header is informational only. Click does nothing. Operator has to scroll to the DataIntegrityPanel below the chart to see the actual issues.

**Fix:** pill becomes clickable + keyboard accessible (Enter/Space toggle, Esc collapse). Click expands an inline panel directly under the pill listing each contributing issue (severity badge + title + rule + rationale).

**Source data:** issue list already computed in `detect-issues.ts` and surfaced in `DataIntegrityPanel`. Pass per-section issue list to the pill component, or read from the same source.

**Theming:** verify on all three rundown themes (`light-internal`, `light-branded`, `dark-account-view`).

---

## Commit 5 — Card complete checkbox + undo toast

**What ships:** every L2 card in This Week, By Account, and Status View gets a styled checkbox in a fixed position (recco: top-right corner). Click → flip status to `completed`, fire undo toast.

**Undo toast spec:**
- Position: bottom-center or bottom-right (match existing toast lib in repo)
- Content: "[Title] marked complete" + [Undo] button
- Duration: 8s (long enough to catch accidents, short enough to not stack)
- Undo action: flip status back to previous value (capture pre-flip status in closure)
- Persistence: optimistic UI update first, then server write; on server failure show error toast + revert

**Server action:** reuse existing `updateWeekItemField({ field: 'status', newValue: 'completed' })` from operations-writes. No new endpoint.

**Audit:** the existing action already writes an audit row. Optimistic-undo writes a second audit row reverting (different `updateType` or same with reversed values). Decide in code review.

**Closes #9** (Click-to-complete from the original B8 Card UX bucket). Partial close of **#67** (the checkbox half).

**Tests:**
- Component test: click checkbox → server action called with status=completed
- Component test: undo button → server action called with previous status
- Integration test: click → toast appears → click undo → status reverts

---

## Commit 6 — Card pencil icon for edit modal

**What ships:** small pencil glyph in card corner (recco: top-left or beside the title) that opens the existing edit modal. Body-click to open the modal stays — pencil is for discoverability ("where do I click to edit?").

**Trade-off:** the whole card is already clickable. Pencil is redundant for power users but reduces ambiguity for AMs/CDs unsure if clicking the title vs the date vs the body has different effects. Operator flagged it as highly-requested.

**Tests:** click pencil → modal opens (assert modal-trigger fires).

---

## Commit 7 — Status View tab

### Tab placement

New tab between This Week and By Account. Order locked: `This Week → Status View → By Account → Gantt Charts → Pipeline`.

Add to `View` union in `runway-board.tsx:23` and to `TABS` array around line 76.

Tab key: `"status"`, label: `"Status View"`.

### Data shape

Source set = union of three predicates from existing dashboard:
- **Needs Update** — `endDate < today AND status ∉ {completed, canceled}` (from `getStaleWeekItems` / Needs Update section)
- **Today** — `startDate <= today <= endDate AND today-anchored` (from Today section logic)
- **In Flight** — `filterInFlight` from `plate-summary.ts:157` (status in {in-progress, scheduled} + start < today <= end)
- **Blocked items roll into Needs Update bucket** — render with red banner, card body shows "BLOCKED — [reason]" if blocked-with-no-endDate

Each item belongs to exactly one bucket (dashboard's existing routing already mutually-exclusive via `filterSpanningFromDayCells`). No new precedence logic needed.

### Grouping

```
Account (alpha)
  Project (alpha)
    Card (date ASC within project, oldest first)
```

Blocked-no-endDate items sort to TOP of project's card list within Needs Update zone (oldest-stuck-first, since no endDate to sort on; secondary sort by `updatedAt` ASC).

### Card visual treatment

Bottom-of-card banner (full width, ~6px height) with:
- **Red** (same as Needs Update) — bucket = Needs Update OR blocked
- **White** — bucket = Today
- **Blue** — bucket = In Flight

Banner is the indicator. Card body stays clean.

### Card interactivity

Same card component as This Week / By Account (reuse). Inherits pencil + checkbox + undo from Commits 5-6.

### Empty states

- Account with zero items in any bucket: hide the account entirely (don't render empty section header)
- Account with items in only one bucket: render normally (no empty bucket header — buckets aren't sub-headers in this layout; they're per-card banner colors)

---

## Risk surface

| Risk | Mitigation |
|---|---|
| Card component used in 3+ places; refactor risk | Add pencil + checkbox as ADDITIVE props, default-off where not wanted, default-on for the 3 dashboard surfaces |
| Optimistic UI + server-failure revert race | Capture pre-flip status in closure; on server error reject, revert local + show error toast |
| `filterActiveRundown` change (#42) silently changes existing By Account rendering for any clients with orphan-only wrappers | Audit all 14 production clients first to confirm only the documented edge case is affected; add test for both wrapper-with-orphan-AND-L1 (keep) and orphan-only (filter out) |
| Gantt re-render after #65 fix changes row count for any production wrapper | Run gantt CLI (`pnpm runway:gantt`) snapshot pre/post to verify only Hopdoddy-pattern wrappers gain rows |
| Status View predicate union double-counts edge cases | Add test for each predicate matching the dashboard's existing assignments exactly |
| Undo toast accidentally dismissed by next toast | Use the toast lib's persist-until-clicked option if available, or stack-not-replace |

---

## Test plan

Per commit (run in CI):
- `pnpm test:run` — unit + component
- `pnpm lint`
- Vercel preview deploy

Pre-merge:
- `pnpm runway:smoke` against preview (visual regression on key pages)
- Manual: open new Status View tab, click checkbox on a known-stale card, verify undo works, verify banner color matches dashboard bucket
- Manual: confirm pencil opens modal on each surface

---

## PR shape

**Title:** `feat(runway): Status View tab + card UX bundle (checkbox, pencil, #65, #66, #42)`

**Body outline:**
- Summary: Monday standup view + the highest-leverage card UX wins
- Per-commit list (7) with closure callouts
- Test plan checklist
- Pre-merge manual QA list
- Explicit out-of-scope: rest of #67 (wrapper layer + subtasks)

**Bot landscape:** LlamaPReview + Vercel team-auth gate. 5-min pushback cycle per playbook §2.5.5.

---

## Signal cadence

1. `plan ready for TP review at docs/plans/status-view-card-ux.md` — after writing this doc
2. (await TP green-light + answers on open questions, if any)
3. `commit N pushed` for each milestone commit; bundled final signal `7 commits pushed, ready for PR open`
4. (await TP green-light to push + open PR)
5. `PR opened at <url>` — armed bot cycle
6. `PR thread-state clean, ready for TP holistic QA` — after 2 empty cycles post-last-push

---

## Open questions for CC to raise if blocked

- Pencil icon position: top-left, top-right, or beside title? (operator deferred — pick the cleanest in existing card layout)
- Checkbox position: top-right corner of card, or in the card body row? (recco: top-right corner)
- Toast lib already in repo? Check `package.json` + grep for existing toast usage before importing new
- Status View card MIGHT need to differ from This Week card (smaller? denser?) — reuse first, restyle if it feels wrong in QA
