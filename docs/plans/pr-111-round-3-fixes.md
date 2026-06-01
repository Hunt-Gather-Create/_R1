# PR #111 round-3 fixes — plan

**Target:** new fix PR bundling 6 items caught by DI-TP's round-2 QA against prod + Llama's late finding on PR #111.
**Branch:** `fix/pr-111-round-3-bugs` off `upstream/runway` (HEAD `3186a00`, PR #111 squash merge).
**Drafted:** 2026-06-01 by Runway TP. Post-PR-#111 merge.

---

## Goal

Fix the 6 prod bugs surfaced by DI-TP's round 2 QA + the dropped Llama F1 finding. Land before the next QA round so the dashboard checkbox + Undo + modal-save flows actually round-trip cleanly in prod.

---

## Scope (in fix-order priority)

| Commit | GH | Sev | Subject |
|---|---|---|---|
| 1 | — | — | `docs(runway): plan for PR #111 round-3 fixes` |
| 2 | #80 | P0 | `fix(runway): dashboard checkbox + Undo idem-key per-operator (mirror modal editorName)` |
| 3 | #84 | P1 | `feat(runway): edit modal — WI category editable (card chip enum)` |
| 4 | #81 | P2 | `fix(runway): edit modal — project category cascade display populated` |
| 5 | #83 | P2 | `fix(runway): edit modal — Undo re-opens with unsaved edits applied` |
| 6 | #82 | P3 | `fix(runway): pencil icon gutter to clear account label` |
| 7 | (DI-TP) | P3 | `feat(runway): audit pill copy icon — cleaner stacked-squares glyph (DI-TP round-2 polish)` |
| 8 | (#111-llama) | P2 | `fix(runway): drop duplicate router.refresh in fireSave (Llama PR #111 follow-up)` |

8 commits total. Tim's upstream squash collapses on land.

---

## Commit 2 — #80 P0 idem-key

### Problem (CONFIRMED via DI-TP round 2)

`updateWeekItemField` at `src/lib/runway/operations-writes-week.ts:555` calls `checkDuplicate(idemKey, ...)`. The idem key is:

```
(updateType, weekItemId, field, newValue, updatedBy)
```

For the dashboard checkbox path, `updatedBy` is hardcoded `"runway:dashboard"` in `setWeekItemStatusAction` at `src/app/runway/actions.ts:97`. The first successful click creates a stable audit row keyed on that idem-key. Every subsequent click on the same (row, field, value) collides → returns `ok:true` without writing.

**Real-world impact:** Once any user clicks the checkbox on any row to mark it complete, that row → completed transition is permanently dedup-blocked from the dashboard for all users.

### Why modal works where checkbox fails

`updateWeekItemFieldsAction` (modal path) passes `input.updatedBy` from the client (the `use-editor-name.ts` cookie value). The modal's `updatedBy` varies per operator, so idem-key fingerprint is naturally distinct. Modal-save status path is a safe interim workaround.

### Fix

Mirror the modal's pattern in `setWeekItemStatusAction`:

1. Action accepts `editorName: string` from the client.
2. Action threads `updatedBy = \`runway:dashboard:${editorName}\`` into the helper call.
3. Client (`complete-checkbox.tsx`) reads from `use-editor-name.ts` cookie + triggers the name-prompt modal on first click if cookie is empty.

### Why not bypass idem entirely

Idempotency is the right default for Slack / MCP / batch callers that may legitimately retry. Dashboard click + Undo are different — they're user UI gestures. Mirroring the modal's editorName pattern keeps idempotency + provides correct audit attribution (we know WHO clicked).

### Tests

- `actions.test.ts`: 2 new cases — second-click flips again (no dedup) when editorName differs, second-click DOES dedup when same editorName + same value combo (sanity)
- `complete-checkbox.test.tsx`: name prompt fires on first click when cookie empty, persists cookie, subsequent clicks reuse

---

## Commit 3 — #84 P1 WI category editable

### Problem

The week_item's `category` field (drives the card chip — DELIVERY / KICKOFF / REVIEW / etc.) is not surfaced in the edit modal. Operators can't change the chip from the dashboard.

### Fix

Add new editable `Category` field to `dashboard-edit-pencil.tsx` modal:

- Dropdown bound to `WEEK_ITEM_CATEGORIES` at `src/lib/runway/operations-utils.ts:1022`
- Values: `delivery | review | kickoff | deadline | approval | launch`
- "(clear)" option writes empty string

Server path: `updateWeekItemFieldsAction` already supports `category` via `updateWeekItemField` — just plumb the new field through `EditPencilItem` + `EditState` + `WeekItemEditPatch` + diff/save.

### Layout

Per operator suggestion — two fields distinguished:

```
CATEGORY  (editable — this WI's chip)
PROJECT CATEGORY  (read-only context — separate visual row)
```

OR drop the project-category row entirely if not load-bearing. Operator's call during build; default to keeping it if simple, dropping if it adds noise. Surface via signal if ambiguous.

### Validation

Server validator already exists — `validateWeekItemCategory` at `operations-utils.ts:1036`. No new validation logic needed.

### L1-status-category compat (not a concern here)

`validateStatusCategoryCompatibility` operates on L1 project values, not WI values, so it doesn't fire on this field. Per `gotcha_l1_close_category_first.md` — L1-only.

### Tests

- `dashboard-edit-pencil.test.tsx`: WI category dropdown renders, value pre-fills from row, save patches `category` field, undo reverts
- `actions.test.ts`: WI category in patch routes through `updateWeekItemField`, audit row written

---

## Commit 4 — #81 P2 cascade display

### Problem

"CATEGORY (CASCADES FROM PROJECT)" field in the modal renders empty even when the parent project has `category` set. Read-only field — display gap, not data integrity.

### Fix

Trace the prop chain from the parent project's `category` value through to `DashboardEditModal`'s read-only display:

1. Extend `WeekItemForCard` (or equivalent type) with `parentCategory: string | null`
2. Add `parentCategory: parentProject.category` to the projection in `page.tsx` (or wherever the query builds the WI row)
3. Thread through `L2MiniCard` + `DayItemCard` → `EditPencilItem`
4. `DashboardEditModal` reads `item.parentCategory` for the read-only display

This is the same pattern as commit 7b's `parentProjectName + notes` threading.

### Tests

- Modal pre-fills the "PROJECT CATEGORY" field with parentCategory value
- Field empty when parentCategory is null (graceful)

---

## Commit 5 — #83 P2 Undo re-opens modal

### Problem

On modal-save Undo, DB reverts correctly but modal stays closed. User's edits are silently erased without giving them the chance to fix or re-apply.

### Fix

In `dashboard-edit-pencil.tsx` `fireUndo` (or equivalent):

1. Capture the pre-Undo edit payload (the field values the user actually changed)
2. Fire the revert action server-side (DB matches pre-save state — existing behavior)
3. Re-open the modal pre-populated with the captured edits
4. Save button enabled

State management: the modal already has a captured-edit state (passed to the save action). Just persist it across the Undo cycle and re-mount the dialog with `defaultValue` from that state.

### Tests

- Save → Undo round-trip: DB reverts AND modal re-opens with prior edits applied
- Edge: Undo with no changes (clean state) doesn't break

---

## Commit 6 — #82 P3 pencil overlap

### Problem

Pencil icon top-left visually overlaps account label text on every card.

### Fix

Recco: move pencil to top-right with a gutter from the checkbox (matches checkbox's existing top-right + own gutter pattern). Adjust `EditPencil` positioning in `edit-pencil.tsx`.

Alternative: keep top-left but add padding above the account label.

CC's call during build — pick the one that looks cleanest in `pnpm runway:smoke` screenshot comparison.

### Tests

- Visual: no overlap in default card render
- Click target still hits pencil (regression test for stopPropagation behavior)

---

## Commit 7 — Audit pill copy icon swap (DI-TP round-2 polish)

### Problem

DI-TP round 2 QA at 15:30Z flagged the existing audit-pill copy icon glyph as too dense visually. Operator's reference is a cleaner stacked-squares glyph (two overlapping outline squares — Lucide `Copy` or `ClipboardCopy` style).

### Fix

In `src/app/runway/components/audit-pill.tsx` (or wherever `CopyToClipboardButton` lives), replace the current copy glyph with a cleaner stacked-squares icon. Likely a Lucide icon swap — `<Copy />` instead of whatever's currently rendered.

### Tests

- Component renders new glyph
- Existing copy behavior unchanged (clipboard API call, 1s checkmark flash on success, sonner error toast on reject)

### Risk

Very low. Pure visual swap, no behavior change.

---

## Commit 8 — Llama PR #111 F1 dup-router-refresh

### Problem (deferred from PR #111 bot cycle)

`fireSave` in `dashboard-edit-pencil.tsx:665-675` registers `router.refresh()` in `toast.onAutoClose` AND calls it immediately at line 675. The immediate call is correct (sub-second UI feedback); the onAutoClose dup would refresh again 8s later. No user harm but redundant.

### Fix

1-line delete: remove the `router.refresh()` registration in `toast.onAutoClose`. Keep the immediate call.

The orphan commit at `ef862f0` on `jasonburks23/_R1` already has this exact fix. Either cherry-pick directly or re-implement (1 line either way).

### Tests

- Existing `complete-checkbox.test.tsx` (router.refresh on auto-close-without-undo) still passes — that's a different code path. The modal-save `fireSave` test should NOT assert two refreshes.

---

## QA gate (mandatory per locked memory)

**CC pre-PR-open:**
1. `/code-review` on the full diff
2. QA fresh-eyes subagent
3. `/preflight` — `pnpm build` (NON-NEGOTIABLE) + lint + tests + grep gate
4. `/pr-ready` cleanup

Any findings get fix commits BEFORE signaling ready.

**TP pre-merge-page:**
5. TP independent `/code-review` subagent
6. TP independent `/preflight` subagent
7. Verify Vercel preview GREEN on latest SHA
8. Terminal-notify operator with PR URL + merge link

**Operator:** merges. One click.

---

## Signal cadence

Standard per `docs/plans/status-view-followups.md` §"Signal cadence":

1. `post-handoff CC online, scope acknowledged` after CC reads handoff
2. `no gaps, ready to start commit 1 on TP green-light` or DECISION Q
3. Per-commit `commit N pushed: <sha> — <summary>`
4. After all commits: `gate clean, opening PR`
5. `PR opened at <url>` → arms 5-min bot-pushback monitor cycle 1
6. Per cycle: `cycle N closed`, findings folded if any
7. `PR thread-state clean, ready for TP gate`
8. TP runs independent gates → terminal-notifies operator

---

## Branch + PR shape

- **Branch:** `fix/pr-111-round-3-bugs` off `upstream/runway` HEAD `3186a00`
- **Target:** `Hunt-Gather-Create:runway` per D-06 (NEVER main)
- **PR title:** `fix(runway): PR #111 round-3 — checkbox idem-key + 5 modal bugs`
- **PR body must include:** per-commit closure callouts (Fixes #80 #81 #82 #83 #84 + the Llama PR #111 follow-up note), pre-existing source-coverage carryover baseline note, scope-deviation callouts in commit bodies (consistent with PR #111 pattern)

---

## Out of scope

- Anything not in the 8 commits above. New bugs surfaced during build go in NEW GH issues, not folded silently.
