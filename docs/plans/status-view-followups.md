# Status View follow-ups (fast-follow on PR #110)

**Branch:** `feature/status-view-followups`
**Target:** Monday 2026-06-01 standup OR Sunday evening ship
**Drafted:** 2026-06-01 (post-PR #110 merge)

---

## Goal

Three small additions that polish what shipped in PR #110. Bundle into a single fast-follow PR. All low-risk render-layer changes on top of the just-landed Status View + card UX.

---

## Scope

| Commit | Subject | GH closure |
|---|---|---|
| 1 | `docs: plan for status view follow-ups` | — |
| 2 | `fix(runway): checkbox undo triggers router.refresh so visual state matches server (#79)` | Fixes #79 |
| 3 | `feat(runway): Status View adds 'Kicks Off This Week' yellow bucket (#71)` | Fixes #71 |
| 4 | `fix(runway): audit pill renders on By Account header (#78)` | Fixes #78 |
| 5 | `feat(runway): audit pill open-state copy-to-clipboard button (#76)` | Fixes #76 |
| 6 | `feat(runway): dashboard L2 edit modal + pencil icon (#70)` | Fixes #70, partial close of #11 |

**#70 status:** mid-spec at time of branch spin-up. Q1 (modal style A/B) answered pending. CC starts on #71 + #76 immediately; if #70 spec lands during the build, fold in. If not, ship 3-commit PR and #70 ships in PR+1.

---

## Out of scope (explicit defer)

- #72 Gantt CLI parity — needs its own investigation pass
- #73 Cross-tab optimistic propagation — `BroadcastChannel` is small but its own concern
- #74 Toast dedup — needs UX design call on stacking vs rolling
- #75 polish nits — batch with future cleanup
- #77 docs/tmp sweep — separate chore window

---

## Commit 2 — #79 Checkbox undo visual sync

### Problem

PR #110's checkbox + undo: clicking Undo writes the correct status back to the server but the card stays visually checked until manual refresh. Root cause: `revalidatePath` marks RSC cache stale but doesn't trigger a client refetch. Optimistic state desyncs from prop-derived state.

### Fix

In `src/app/runway/components/complete-checkbox.tsx`:
- Import `useRouter` from `next/navigation`
- Call `router.refresh()` after successful undo (inside `revertTo`)
- Call `router.refresh()` on toast `onAutoClose` (when 8s window expires without undo)
- Do NOT refresh on initial click (would flicker card out of view during the undo window — exactly what we don't want)

Total diff: ~6 lines. No server-side changes.

### Tests

- Playwright spec at `tests/runway/checkbox-undo.spec.ts`:
  - Click checkbox → assert card visually checked
  - Click Undo → assert card visually unchecked WITHOUT manual refresh
  - Wait 8s after click without Undo → assert card disappears from In Flight section

### Risk

Very low. Additive client hook call, no behavior change to existing happy path.

---

## Commit 3 — #71 Kicks Off This Week bucket

### Predicate

```ts
const isKicksOffThisWeek = (item, todayISO, endOfWeekISO) =>
  item.startDate &&
  item.startDate > todayISO &&
  item.startDate <= endOfWeekISO &&
  !["completed", "canceled", "blocked"].includes(item.status ?? "");
```

`endOfWeekISO` = ISO date of the upcoming Friday from `todayISO`. Compute in the same util as `todayISO`.

### Banner color

**Yellow.** Reuse the existing Tailwind palette — recco: `bg-yellow-400` for the banner stripe (verify against existing red/white/blue token in `complete-checkbox.tsx` / `day-item-card.tsx` styling).

### Precedence (locked)

`Needs Update (red) → Today (white) → Kicks Off This Week (yellow) → In Flight (blue)`

Update `computeStatusItems` in `status-view.tsx` to assign the new bucket. Mutual exclusion via the existing `seen` set.

### Data source

Items that match Kicks Off predicate but aren't currently in any Status View bucket. Most will live in `upcomingItems` or similar source on `page.tsx` — confirm the right slice during build.

### Sort

Within Project: date ASC. Same as the existing 3 buckets.

### Tests

- A Tue-startDate item viewed Mon → yellow banner
- A Fri-startDate item viewed Mon → yellow banner
- A Mon-next-week-startDate item viewed Fri → NOT in this bucket (out-of-week)
- A blocked item with future startDate → NOT in this bucket (blocked precedence)

---

## Commit 4 — #78 Audit pill on By Account header

### Problem

PR #110 #66 added the clickable+expandable audit pill on Gantt headers. The original #66 spec called for it on **both** Gantt AND By Account headers. Live QA on 2026-06-01 caught that the By Account path missed the wire-up.

### Fix

`account-section.tsx` (or the By Account header component — verify path) needs the same `AuditBadge` wire-up as `gantt-charts-section.tsx`. Pass the per-section `summary` shape so the pill receives the same issue list.

### Tests

- New test: By Account header renders the audit pill when `summary` has issues
- New test: Click pill on By Account → expanded panel opens with issue list
- Verify panel matches Gantt panel behavior (Esc closes, outside-click closes)
- Theming: dark-account-view variant verified

### Risk

Low. Additive — same component as the Gantt path, just rendered in a second location.

---

## Commit 5 — #76 Audit pill copy-to-clipboard

### What ships

When the audit pill is in OPEN (expanded) state, render a small clipboard icon (two overlapping squares) in the top-right corner of the expanded panel.

Click → copy the visible issue list to clipboard via `navigator.clipboard.writeText(...)`.

### Clipboard format

One issue per line:

```
[CRITICAL] <Section Title> — <rule code>: <message>
[WARNING] <Section Title> — <rule code>: <message>
```

Plain text, paste-friendly for Slack threads / docs.

### Confirmation feedback

Icon flips to a checkmark glyph for ~1s after successful copy, then reverts. No toast (less noise).

If `navigator.clipboard.writeText` rejects (rare — usually permission), show a brief error toast: "Copy failed — try again."

### Accessibility

- Icon is a proper `<button>` with `aria-label="Copy issues to clipboard"`
- Keyboard accessible (Tab into focus, Enter/Space activates)

### Tests

- Click copy button → `navigator.clipboard.writeText` called with expected formatted string
- Multi-issue panel produces multi-line clipboard payload
- Icon swaps to checkmark on success (timer-based; mock setTimeout)

---

## Commit 6 — #70 Dashboard edit modal + pencil icon

**Full spec locked in GH #70 issue body (2026-06-01).** CC reads #70 directly; summary below.

### Trigger

Pencil icon (~14px) top-left of every L2 card on This Week + By Account + Status View. Click stops propagation.

### Modal style

Centered overlay ~600px, dimmed backdrop, animates from source card via Framer Motion `layout` (or web-standard morph). Esc / click-outside / Cancel button = close without save.

### Field set

- **Editable:** title, owner (combobox autocomplete + free-format), resources (chip editor: role dropdown + name combobox per chip), startDate, endDate, dayOfWeek, status, notes, project (simple L1 dropdown)
- **Read-only visible:** category (greyed-out, no lock icon, cascades from project)
- **Out of scope:** L1 edit, full cascading project picker (#11), multi-select, mobile-first, unsaved-changes guard

### updatedBy

Session-cookie name prompt: polished intro modal on first edit per session; persists in cookie; subsequent edits auto-use. Audit rows: `source='dashboard'` + `updatedBy=<cookie name>`.

### Save flow

Optimistic with undo toast:
1. Click Save → modal closes, card reflects new values
2. Server write fires in background
3. Toast: `"Saved [Title]"` + Undo button
4. Undo → reverts all fields to pre-save state (captured at save click), emits revert audit row
5. Server error → auto-revert + error toast: `"Save failed: <error>"`

### Validation (pre-save)

- Title + owner required
- startDate ≤ endDate
- Status in `WEEK_ITEM_STATUSES`
- Notes ≤ 280 chars
- Resources enforced by chip editor construction
- Inline errors; Save disabled while invalid

### Polish

Operator: "needs to feel well-designed, not thrown together or clunky. This is a polished product."
- Card-to-modal animation must feel native (Framer Motion `layout` morph or equivalent)
- Chip editor must feel responsive, not janky (focus management, keyboard nav)
- Name prompt modal must feel intentional, not an afterthought alert
- Toast styling consistent with existing checkbox undo toast

### Tests

- Open modal → fields pre-filled from row
- Edit + Save → optimistic close, audit row emitted with cookie name + dashboard source
- Undo on toast → fields revert, second audit row
- Server error simulated → auto-revert + error toast
- First-edit session cold start → name prompt appears, persists across modal opens
- Validation errors surface inline; Save disabled

### Risk

Medium. Largest single-commit surface in this PR. Mitigations: extensive component tests, manual QA against staging, Vercel-green-on-latest-SHA gate.

---

## Risk surface

| Risk | Mitigation |
|---|---|
| Kicks Off bucket double-counts items also in upcomingItems source | Add explicit test for the new bucket NOT overlapping the existing 3 (extend `seen` set tests) |
| Yellow Tailwind token clashes with existing dashboard chrome | Verify in `pnpm runway:smoke` + visual check before merge |
| Clipboard API requires HTTPS context | `runway.startround1.com` is HTTPS — fine in prod; verify in `pnpm dev` (localhost is also clipboard-allowed) |
| Multi-tab clipboard race (rare) | n/a — single-tab copy |

---

## Test plan

Per commit (run in CI):
- `pnpm test:run` — unit + component
- `pnpm lint`
- `pnpm build` — non-negotiable per `feedback_full_qa_gate_no_shortcuts.md`

Pre-merge:
- `pnpm runway:smoke` against preview
- Manual: open Status View tab on staging, verify yellow banner appears for a future-Tue item; click audit pill copy button, paste into Slack to confirm format
- Vercel cross-fork build GREEN on latest SHA before paging operator

---

## PR shape

**Title:** `feat(runway): Status View follow-ups (Kicks Off This Week + audit pill clipboard)`

If #70 lands in scope: `... + dashboard edit modal`.

**Body outline:**
- Summary: 3 polish additions on top of #110
- Per-commit list with closure callouts
- Explicit defer note on #72-77 (separate PRs)
- Pre-existing baseline source-coverage carry-over note (still red, still not introduced here)

**Bot landscape:** LlamaPReview + Vercel team-auth gate. 5-min pushback cycle per playbook §2.5.5.

---

## Signal cadence

1. `plan ready for TP review at docs/plans/status-view-followups.md` — after CC reads/acks
2. (await TP green-light + #70-conditional)
3. Per-commit `commit N pushed`
4. Final `commits pushed, ready for PR open` after all commits land
5. (await TP green-light to push + open PR)
6. `PR opened at <url>` — bot cycle armed
7. `PR thread-state clean, ready for TP gate` — after 2 empty cycles post-last-push

---

## Open questions for CC

- Tailwind yellow shade for the banner — pick the closest existing token to the red/white/blue used; if no clean match, propose one and surface to TP
- Clipboard icon glyph — Lucide `ClipboardCopy` or `Copy`? Pick whichever matches existing dashboard icons
- Test mocking strategy for `navigator.clipboard.writeText` — vitest's standard approach is fine
