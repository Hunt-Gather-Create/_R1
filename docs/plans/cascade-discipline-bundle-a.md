# Data-cascade discipline — bundle A

**Target:** bundle 4 cascade-area bug fixes + 1 main-hygiene chore into one PR.
**Branch:** `fix/cascade-discipline-bundle-a` off `upstream/runway` HEAD `e4cad97` (PR #112 squash merge).
**Drafted:** 2026-06-01 by Runway TP. Revised 2026-06-02 by CC after plan-vs-issue diff (TP greenlit all 4 decisions in `docs/tmp/cc-plan-vs-issue-diff-cascade-bundle-a.md`).

---

## Goal

Land 4 bug fixes in the data-cascade subsystem (`recomputeProjectDatesWith`, the cascade-duedate writer, `linkWeekItemToProject`, and the Undo flow) plus a main-hygiene gitignore chore. All 4 fixes share the same subsystem context so tests can share fixtures and CC holds one mental model throughout.

Compounding payoff: cascade discipline is the most-touched subsystem this week (PRs #106 + #109 + #112 all touched it), and DI-TP's prod migration scripts currently embed workaround patterns (paired post-insert `overrideProjectDate` calls) to compensate for the cascade-clobber and missing-field bugs. Landing the structural fix to #20 retires the workaround entirely — every future migration gets simpler.

---

## Scope (in fix-order priority)

| Commit | GH | Sev | Subject |
|---|---|---|---|
| 1 | — | — | `docs(runway): plan for cascade-discipline bundle A` |
| 2 | — | chore | `chore: gitignore .claude/*.lock harness artifacts` |
| 3 | #19 | P2-medium | `feat(runway): emit cascade-date-change audit row when recompute moves parent dates (no double-write with override)` |
| 4 | #26 | P3-low | `fix(runway): wrap Undo find-last + apply-undo in a single transaction + friendly stale-target error` |
| 5 | #22 | P2-medium | `fix(runway): cascade-duedate also syncs L2 startDate/endDate/dayOfWeek for deadline-category L2s (skipping terminal)` |
| 6 | #20 | P2-medium | `fix(runway): extend retainer-guard in recomputeProjectDatesWith to also skip recompute for L2-only retainer wrappers (#20 structural)` |

6 commits total. Tim's upstream squash collapses on land. First commit body becomes the squash-merge description lead per `feedback_plan_commit_meaningful_context`.

Order rationale: plan first (squash-description lead), then chore (hygiene + isolated risk), then 4 fixes from most-additive (#19 audit row + guard) to most-structural (#20 cascade-guard extension that retires a documented workaround pattern).

---

## Commit 2 — gitignore chore

### Problem
`.claude/scheduled_tasks.lock` is a Claude Code harness lock file created automatically every session. Shows up as untracked in `git status` on every dev machine → dirty `?` indicator on main.

### Fix
One-line `.gitignore` add right under the existing `.claude/worktrees/` entry:

```
# Claude Code harness lock files (per-session ephemeral)
.claude/*.lock
```

### Tests
None — config change, no behavior.

### Risk
Zero.

---

## Commit 3 — #19 `cascade-date-change` audit row + double-write guard

### Problem (per GH #19)
When an L2 date write triggers parent L1 date recompute via `recomputeProjectDatesWith`, the parent row is raw-UPDATEd with no `updates` audit row. The codebase already has `cascade-status` and `cascade-duedate` update_type values — `cascade-date-change` is the missing third. AG1 batch 2026-05-03 returned 5 audit rows instead of expected 6 because of this gap; every prior cohort that touched L2 dates likely under-counted by 1+ per parent boundary.

### Fix (TP-locked decisions baked in)

In `src/lib/runway/operations-writes-week.ts` (`recomputeProjectDatesWith`), after the parent date update fires, emit an audit row capturing:

- `updateType`: **`cascade-date-change`** (matches existing `cascade-status` + `cascade-duedate` siblings, per issue #19 body)
- `entityType`: `project`
- `entityId`: parent project id
- Old → new `startDate` / `endDate` in `metadata` JSON
- `cause`: child week-item-id that triggered the recompute (already in scope)
- `updatedBy`: `cascade:recompute` (defensible non-null per `feedback_no_nulls_in_prod_db`; system-driven not user-driven)
- batchId + standard audit row metadata wired through like existing cascade audit rows

### No-double-write guard (per issue acceptance crit + `gotcha_overrideProjectDate_not_sticky`)
When `overrideProjectDate` runs and the cascade recompute also fires in the same flow, we don't want two audit rows for what's logically one date change. The override emits its own `date-override` row; the cascade would emit `cascade-date-change` for the same delta.

**Guard:** skip the `cascade-date-change` row when:
1. The cascade recompute is a no-op (computed value identical to stored value), OR
2. A `date-override` audit row was already written for the same {entityId, fieldName} in this batch (look up via batchId-scoped query on `audits` table).

### Tests
- Audit row written when cascade triggers parent date change (forward extend; endDate moves later).
- Audit row written when cascade triggers parent date change (backward pull; endDate moves earlier).
- No audit row written when cascade is a no-op (parent dates unchanged).
- No audit row written when L1-children guard short-circuits recompute (existing path).
- No double-write: when `overrideProjectDate` + cascade both fire on the same {entity, field}, only the `date-override` row lands (cascade-date-change suppressed).

### Risk
Low — additive. Existing recompute behavior unchanged.

---

## Commit 4 — #26 Undo transaction + friendly stale-target error

### Problem (per GH #26)
The Undo flow at `src/lib/runway/operations-writes-undo.ts:34-49` reads the last undoable audit row outside a transaction, then issues the inverse write separately. A concurrent writer between the find and the apply can land a new audit row → the apply works against a stale find result. The idempotency check at line 46 prevents double-apply but produces an opaque user-facing error.

### Fix (TP-locked decisions baked in)

1. Wrap both ops in a single Drizzle transaction (`db.transaction(async tx => { ... })`). Pass `tx` through to both `findLastAuditRow` and the apply-undo write so they share the same isolation snapshot. Mirror the existing transaction pattern in `updateWeekItemFieldsAction` (modal save path).
2. Replace the opaque idempotency-mismatch error with a user-readable copy: `"This change has been modified since you last saw it. Refresh to see the latest state."` (or whatever the existing UX copy convention prefers — check `src/components/runway/` toasts for tone match).

### Tests
- Race-fix: simulate concurrent write between find + apply via mocked tx → Undo sees consistent snapshot (existing-passes-still-pass + the inverse undo writes correctly under contention).
- Stale-target UX: assert the friendly error message fires when the find-target moved between find and apply.
- Existing Undo happy-path tests unchanged.

### Risk
Low — transaction wrap is the standard race-fix pattern. Turso/libSQL is serializable by default. Error-message change is 1-2 lines.

---

## Commit 5 — #22 cascade-duedate syncs related fields for deadline-category L2s

### Problem (per GH #22)
When an L1 project's `dueDate` / `startDate` / `endDate` changes, the existing L2 dueDate-sync cascade only writes L2.dueDate. It misses L2.startDate / L2.endDate / L2.dayOfWeek, which should also stay consistent with the parent's envelope. L2s drift out of envelope alignment with their parent L1 over time; DI-TP has to manually re-align in migration scripts.

### Fix (TP-locked A+B hybrid)

In the cascade-duedate writer in `operations-writes.ts` (grep `cascade.*duedate` / `recomputeProjectDates`):

1. **Scope to deadline-category L2 children only** — same gate that controls the existing dueDate cascade (per issue #22 scope language).
2. **Skip cascade write entirely** for L2s in terminal status (`completed` / `canceled`) — terminal items represent shipped work, not envelope-tracked work. (Option B floor.)
3. For non-terminal deadline-category L2s, when L1 envelope changes, in addition to writing L2.dueDate, also write:
   - L2.startDate — clamped to new L1 envelope
   - L2.endDate — clamped to new L1 envelope
   - L2.dayOfWeek — recomputed from new L2.startDate, **lowercase** per `feedback_dayofweek_lowercase`
4. **Date-write ordering per `feedback_l2_date_write_ordering`:** FORWARD move (new > current) writes endDate first; BACKWARD move (new < current) writes startDate first. Cross-field validator (`L2 startDate ≤ endDate`) trips at runtime otherwise.

### Tests
- L1 endDate forward → deadline-category L2 endDate updated + dayOfWeek lowercase + endDate-before-startDate ordering correct.
- L1 startDate backward → deadline-category L2 startDate updated + dayOfWeek recomputed lowercase + startDate-before-endDate ordering correct.
- Non-deadline-category L2: no extra-field cascade (unchanged behavior — only L2.dueDate writes via existing path, or nothing if non-deadline doesn't currently cascade at all).
- Terminal-status L2 (completed): cascade skips entirely → no writes to L2, no validator trips on shipped work.
- Existing cascade-duedate tests unchanged.

### Risk
Medium — touches the most-active cascade path. Retainer-guard untouched (per `feedback_retainer_guard_l1_children_only`).

---

## Commit 6 — #20 extend retainer-guard for L2-only retainer wrappers (STRUCTURAL)

### Problem (per GH #20)
Linking a week_item to a retainer wrapper that has no L1 children skips the retainer-wrapper guard in `recomputeProjectDatesWith` and silently collapses the wrapper's startDate/endDate to the linked L2's date. The Convergix 2H wrapper required a post-link `overrideProjectDate` step to restore 8/1 – 1/31 dates. Same root pattern as the L2-insert clobber but on a different write helper.

This is the same gap documented in `feedback_cascade_clobber_on_retainer_l1_no_children` and `feedback_retainer_guard_l1_children_only`: the existing retainer-guard queries `projects WHERE parentProjectId = thisProjectId` (L1 children only) so a retainer L1 with only L2 children (no L1 children) escapes the guard and behaves like `engagementType=project`.

### Fix (TP-locked STRUCTURAL approach per issue body, NOT the migration-style patch pattern)

In `recomputeProjectDatesWith` (`src/lib/runway/operations-writes-week.ts`), extend the existing retainer-guard predicate by one OR clause:

- **Before:** guard short-circuits when L1 has `engagementType=retainer` AND has L1 children (other projects with `parentProjectId = this.id`).
- **After:** guard ALSO short-circuits when L1 has `engagementType=retainer` AND has no L1 children. (Both shapes are "wrappers" for cascade purposes; both should pin contractStart/contractEnd and ignore WI-driven envelope drift.)

Same change pays compounding interest:
- Fixes #20 cleanly at the source (link no longer triggers a clobber).
- Pre-emptively fixes the L2-insert clobber pattern in `feedback_cascade_clobber_on_retainer_l1_no_children`. DI-TP can stop writing the paired-override workaround in migrations.
- Single predicate extension; blast radius is contained.

### Why NOT the patch pattern
The plan-as-drafted proposed letting clobber happen then re-pinning via paired `overrideProjectDate` calls. TP rejected per:
- `feedback_skip_throwaway_guardrails` — operator prefers structural fix over workaround.
- `gotcha_overrideProjectDate_not_sticky` — the pin holds only until the next WI write under the wrapper, then re-clobbers. Workaround would need to be re-applied on every link op forever.
- The patch pattern would lock the migration workaround into the prod hot path (extra audit rows, fragile pin) instead of fixing the root cause.

### Tests
- Link L2 into wrapper-with-no-L1-children → recompute short-circuits → wrapper dates unchanged + no `cascade-date-change` audit row.
- Link L2 into wrapper-with-L1-children → existing guard path fires (unchanged behavior).
- Link L2 into engagementType=project L1 → recompute fires normally (unchanged behavior).
- Existing `linkWeekItemToProject` happy-path tests pass.
- Existing L2-insert tests that previously documented the clobber-then-patch pattern: assert the clobber no longer happens (and reconfirm DI-TP's prior workaround is now no-op, not regression).

### Risk
Medium — single-predicate change but extends semantics for all L2-only retainer wrappers across both link-path AND L2-insert-path. Read `feedback_cascade_clobber_on_retainer_l1_no_children` + `feedback_retainer_guard_l1_children_only` before writing. Grep for callers of `recomputeProjectDatesWith` to confirm no other path depends on the L2-only-retainer-clobber behavior as a feature.

---

## QA gate (mandatory per `feedback_full_qa_gate_no_shortcuts`)

**CC pre-PR-open (in order):**
1. `/code-review` on the full diff
2. QA fresh-eyes subagent
3. `/preflight` — `pnpm build` (**NON-NEGOTIABLE**) + lint + tests + grep gate
4. `/pr-ready` cleanup

Any findings → fix commits BEFORE signaling `gate clean, opening PR`.

**TP pre-merge-page:**
5. TP independent `/code-review` subagent
6. TP independent `/preflight` subagent
7. Verify Vercel preview GREEN on latest SHA
8. Terminal-notify operator with PR URL + merge link

**Operator:** merges. One click.

---

## Signal cadence (per `feedback_no_silent_scope_drops`)

1. `<ISO> | cascade-bundle-a CC online, scope acknowledged` ✓ (01:34Z)
2. `<ISO> | DECISION Q / plan-vs-issue diff complete` ✓ (01:35Z) → TP greenlit at 01:37Z
3. Per-commit `<ISO> | commit N pushed: <sha> — <one-line summary>`
4. After all commits: `<ISO> | gate clean, opening PR`
5. `<ISO> | PR opened at <url>` → arm 5-min bot-pushback monitor cycle 1
6. Per cycle: `<ISO> | cycle N closed`, findings folded if any
7. After 2 consecutive empty cycles: `<ISO> | PR thread-state clean, ready for TP gate`

---

## Branch + PR shape

- **Branch:** `fix/cascade-discipline-bundle-a` off `upstream/runway` HEAD `e4cad97`
- **Target:** `Hunt-Gather-Create:runway` per D-06 (NEVER `main`)
- **PR title:** `fix(runway): data-cascade discipline bundle A (#19 #20 #22 #26 + .gitignore chore)`
- **PR body must include:** per-commit closure callouts (`Fixes jasonburks23/_R1#19 #20 #22 #26`), the gitignore chore as a separate noted line, baseline source-coverage carryover note (1 pre-existing fail on lppc migration scripts is acceptable per PR #111 baseline)

---

## Out of scope

- #16 (parent-date override clobber — architectural, needs operator semantic decision)
- #43 (timezone canonical model — architectural)
- #74, #85 (UX/architectural calls, not solo-CC-driveable)
- Anything not in the 6 commits above. New bugs surfaced during build go in NEW GH issues, not folded silently.

---

## Related locked memories CC must internalize

- `feedback_full_qa_gate_no_shortcuts` — the gate that runs
- `feedback_no_silent_scope_drops` — diff plan-vs-issue before writing code (done; 4 deltas surfaced + greenlit)
- `feedback_cc_opens_pr_operator_only_merges` — CC runs `gh pr create` + bot cycle, operator merges only
- `feedback_plan_commit_meaningful_context` — commit body = design context with decisions baked in
- `feedback_qa_in_pr_no_ask` — QA finds get fixed in the active PR, not deferred via "should we fix?"
- `feedback_skip_throwaway_guardrails` — load-bearing for #20 structural choice over patch
- `feedback_cascade_clobber_on_retainer_l1_no_children` — load-bearing for commit 6; commit 6 retires the workaround this memory documents
- `feedback_retainer_guard_l1_children_only` — load-bearing for commits 5 + 6 (commit 6 extends the predicate this memory describes)
- `gotcha_overrideProjectDate_not_sticky` — load-bearing for commits 3 + 6 (motivates the double-write guard + the structural choice over patch)
- `feedback_dayofweek_lowercase` — load-bearing for commit 5
- `feedback_l2_date_write_ordering` — load-bearing for commit 5
- `feedback_no_nulls_in_prod_db` — load-bearing for commit 3 (audit row updatedBy)
- `gotcha_l1_close_category_first` — NOT load-bearing here (L1 close path untouched)
