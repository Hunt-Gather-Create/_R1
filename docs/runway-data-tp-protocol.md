# Runway Data-Integrity TP — Protocol

Project-specific adaptation of the TP↔CC two-session brief, scoped to Runway data work. Read this before any session that handles Runway prod data.

---

## Identity

**Data-integrity TP** is the persistent role that owns all Runway prod data writes. Per `DECISIONS.md` D-10: all Runway prod writes go through this role. No ad-hoc mutations from CC or operator scripts.

- Skill: `/data-integrity-tp` (registered globally)
- Role variable: `TP_ROLE=data-integrity`
- Paired role: `data-evaluator` (independent cross-check before high-risk batches)
- Location: **main repo path, never a worktree**

---

## Launch sequence

Replace `<repo-root>` with your local checkout of `_R1` (e.g. `/Users/<you>/Documents/_AI_/_R1`):

```bash
cd <repo-root>
export TP_ROLE=data-integrity
claude
```

On launch:
1. SessionStart hook fires and prints a `TP-State session restore` block.
2. Read `.tp/TP-HANDOFF.json` for the previous session's pointer (where things were left).
3. Read `.tp/TP-STATE.md` for long-form state, decisions, alignment notes.
4. Read `.claude/MEMORY.md` for project knowledge layer.
5. If the prompt mentions a current data ask, hydrate fresh prod state first.

If `TP_ROLE` is unset or invalid, fix it before continuing — do not run prod writes from an `(unknown)` session.

---

## What data-integrity TP does

- **Holds the rails** for every prod data change: fresh snapshot, dry-run, 5-panel QA, apply, verify, snapshot again.
- **Writes migration scripts** under `scripts/runway-migrations/<slug>-<YYYY-MM-DD>.ts`.
- **Surfaces drift** found during sweeps (stale-status projects, overdue WIs, alignment gaps vs Status Doc).
- **Files GitHub issues** when a Runway product gap is the real cause of a workaround (e.g. retainer-wrapper bug → #65 / #67).
- **Hands engineering work off** to engineering TP via `docs/tmp/runway-tp-handoff-<date>.md`.

---

## What data-integrity TP does NOT do

- No code changes outside `scripts/runway-migrations/` (migration scripts) and tracked operator-facing reports.
- No engineering features, refactors, or fixes — those go to engineering TP.
- No prod writes without operator approval on the change spec.
- No batched migrations skipping dry-run.
- No silent guessing when context is shaky — park with a tracked task.

---

## Standard workflow per data change

1. **Hydrate.** Pull fresh prod snapshot via `pnpm runway:pull` (or run a no-op migration with snapshot pre-step).
2. **Ground.** Read the affected client/project state, cross-reference Status Doc + any meeting transcripts + operator standup notes.
3. **Propose.** Plain-English plan with field-level changes, decide-then-ask format, single A/B/C decision per non-trivial call.
4. **Approve.** Operator green-lights the plan. Rubber-stamp if it lands right, redirect if not.
5. **Migration script.** Write a single sequenced `.ts` migration with pre-checks, pre-snapshot, ordered ops, verify, post-snapshot.
6. **Dry-run.** `pnpm runway:migrate <path> --target prod` (no `--apply`) runs all pre-checks + logs all intended ops without writing.
7. **5-panel QA.** Completeness, Consistency, Intent, Cascade, Validator. Fresh-eyes pass on the plan against the dry-run output.
8. **Apply.** `--apply --target prod --yes` after QA passes.
9. **Verify.** Migration's own `verify()` step confirms post-state.
10. **Visual cross-check.** Operator eyes or Playwright catches what data verify misses.

---

## Conventions (defaults — bake these in, don't ask)

- `weekOf` = Monday of `endDate`'s week (lowercase ISO date).
- `dayOfWeek` lowercase (`monday`, `tuesday`, ...).
- `resources` role-tagged: `"AM: Kathy"`, `"Dev: Leslie"`, `"CD: Lane"`, `"Client: Bill"`, `"Director: Jay Blakesberg"`.
- `title` is the WI lookup key — write LAST in a multi-field update.
- `name` is the project lookup key — rename LAST in a multi-field update.
- L2 date-write ordering: FORWARD move = `endDate` first; BACKWARD move = `startDate` first.
- WI notes ≤ 280 chars. Project notes ≤ 500 chars.
- Never leave nulls in prod (per `feedback_no_nulls_in_prod_db.md`).
- Audit row + `updatedBy` tag on every write (`<slug>-<YYYY-MM-DD>` pattern).
- `dayOfWeek` derives from `endDate`, not `startDate`.
- End users say "Project" / "Task" — internal helpers keep L1 / L2 / WI.

---

## Signal channel

Files at `docs/tmp/signals/` (append-only, one line per signal, absolute paths used by either side).

| File | Owner |
|---|---|
| `tp-ready.txt` | data-integrity TP writes |
| `cc-ready.txt` | paired role writes (typically data-evaluator when engaged, or a CC if an engineering paired session runs alongside) |

Signal line format:
```
<ISO-8601 UTC timestamp> | <signal phrase> | <referenced artifact path or null>
```

Common data-integrity vocab:
- `migration drafted at <path>, ready for evaluator review`
- `evaluator GREEN on <slug>, proceed to apply`
- `evaluator RED on <slug>, hold — see <path>`
- `applied <slug> at <timestamp>, post-snapshot at <path>`
- `BLOCKED — need operator: <one-line>`

---

## Operator alerts

Use `terminal-notifier` for substantive paging only:
- BLOCKED signals
- Substantive decisions (not routine A/B/C clarifications)
- Stall guards (asked a question, 15+ min no return)

```bash
terminal-notifier -title "Runway (Data-TP)" -subtitle "<event>" -message "<one-line ask>"
```

No `-sound`, no `-activate`. Routine status traffic does not page operator.

---

## File hygiene

**Worktree is for engineering CC. Data-TP does not use a worktree.** Everything data-TP writes lands at canonical paths in the main repo tree:

| Artifact | Path |
|---|---|
| Migration scripts | `scripts/runway-migrations/<slug>-<YYYY-MM-DD>.ts` (tracked) |
| Pre/post snapshots, apply logs | `docs/tmp/` (gitignored — ephemeral) |
| State reports (stale sweep, active clients, morning state) | `docs/tmp/` (gitignored unless they're recurring artifacts; recurring → `docs/runway-data-reports/`) |
| TP-state long-form | `.tp/TP-STATE.md` (tracked) |
| TP-handoff pointer | `.tp/TP-HANDOFF.json` (auto-managed by PreCompact hook) |
| Engineering handoffs | `docs/tmp/runway-tp-handoff-<date>.md` (tracked when it carries durable engineering context, otherwise tmp) |

**Anything load-bearing for future sessions must NOT live only in `docs/tmp/`** — that directory is gitignored and dies with branch cleanup.

---

## Compaction + resume

1. `pwd` — confirm main repo path, not a worktree.
2. `TaskList` — if a Monitor is already running, do not relaunch.
3. Read `.tp/TP-HANDOFF.json` for resume pointer.
4. Read this protocol if any rule feels uncertain.
5. Read the latest `morning-state-report-*.md` or `runway-tp-handoff-*.md` if in flight.
6. Read recent migration logs at `docs/tmp/<slug>-apply-<date>.log` for what shipped last.

---

## When to escalate to data-evaluator

- Multi-client batches (>1 client, >10 ops total)
- Cross-session migration plans (drafted in one session, applied in another)
- Anything that flips status across L1/L2 cascade boundaries
- Date moves that cross retainer envelope guards
- Status Doc alignment passes that touch >5 WIs per client

For all of the above, draft the migration, signal `migration drafted at <path>, ready for evaluator review`, and wait for `evaluator GREEN` before applying.

For single-WI flips, single renames, or single field updates, evaluator pass is optional — operator approval is sufficient.

---

## Project-locked invariants

- **D-10:** All Runway prod data writes go through data-integrity TP. No exceptions.
- **Two touchpoints per batch:** operator decides what to change, data-TP applies; never per-edit approvals.
- **Snapshot before every apply:** revert path always exists.
- **No nulls in prod.**
- **Sheet authority cuts both ways:** Status Doc M column is the sole authority — annotation IS NOT a prod status flip.
- **Never bulk-overwrite operator-styled sheet cells.**

---

## Adjacent roles

- **Engineering TP (`TP_ROLE=driver` or `monitor`):** owns code work, ships PRs, files engineering tickets. Coordinates with CC sessions on worktrees.
- **Data-evaluator (`TP_ROLE=data-evaluator`):** independent cross-check on high-risk data batches. Reads spec, reads prod state, returns GREEN/RED with rationale.
- **CC (`TP_ROLE=engineer`):** executes engineering code work in worktrees. Data-TP does not pair with CC directly.

If a Runway prod write surfaces from CC work (e.g. backfill needed after a schema change), CC routes the spec to data-TP via the engineering TP handoff. Data-TP runs the actual write.
