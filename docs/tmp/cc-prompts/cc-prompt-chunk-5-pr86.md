# CC Prompt — PR #86 Chunk 5: Notifications, Polish, PR Prep

## Mission

Final chunk. Add past-end L2 detector to flags rail. Audit batch-update skill for gaps. Run `/code-review`, `/pr-ready`, `/atomic-commits` on the full integration branch (TP-invoked, not CC). Draft PR message. Open PR. Iterate Llama findings.

**Safety preamble:**
> You are operating as a sub-agent on a production codebase. Before making any destructive change, deleting files, or modifying shared configuration, stop and confirm with the operator. Do not assume. Do not guess at intent. If something is ambiguous, surface it before acting.

**Efficiency preamble:**
> Work in focused, atomic steps. Stay in scope.

---

## Context

**Working directory:** isolated worktree via Agent tool
**Branch:** `feature/runway-pr86-chunk-5` (rename auto-created branch)
**Base:** `origin/feature/runway-pr86-base` — unified integration line (all Chunks 1, 4 and 7 data migrations already merged here)

## STEP 0 — MANDATORY base correction

```bash
git branch --show-current
git fetch origin
git log --oneline origin/feature/runway-pr86-base -5   # should include Chunk 2 + Chunk 3 merges by the time you run
git checkout -B feature/runway-pr86-chunk-5 origin/feature/runway-pr86-base
```

HALT if fails.

Convention reference: `docs/tmp/runway-v4-convention.md` §"Convention-driven behaviors §4."

---

## Step 0 — Verify state

```bash
git branch --show-current
git log --oneline feature/runway-pr86-wave2..HEAD   # expect empty
git log --oneline feature/runway-pr86-wave2 -20   # sanity: all earlier chunks landed
```

If any fail, STOP.

---

## Scope — strict

**IN (primary items):**

1. **Past-end L2 detector** — add to `src/lib/runway/flags-detectors.ts`. Criteria: `end_date < today AND status='in-progress'`. Returns a flag object compatible with existing flags rail format. Wire into flags page and bot's plate response. See v4 convention doc §"Convention-driven behaviors §4."

2. **Batch-update skill audit** — read `.claude/skills/batch-update/SKILL.md`. Evaluate: filter + multi-field update support, dry-run with diff, batchId tagging on audit, bulk L2-owner backfill. Lightweight additions (≤30 LoC) allowed if gaps.

3. **Tests** for the detector and batch-update additions.

## IN (known debt from Wave 1/2 — see `docs/brain/pr86-chunk4-known-debt.md`)

4. **Extend `PROJECT_FIELDS` whitelist** to include `engagementType`, `contractStart`, `contractEnd`. Also verify `WEEK_ITEM_FIELDS` includes `startDate`, `endDate`, `blockedBy` (Chunk 4 should have added these — verify). Update `PROJECT_FIELD_TO_COLUMN` and `WEEK_ITEM_FIELD_TO_COLUMN` accordingly.

5. **`bucketWeekItem` in `getPersonWorkload` (Chunk 1)** — add `status !== 'completed'` filter to `thisWeek / nextWeek / later` bucketing. Future-dated completed L2s should not inflate counts. Add test covering this case.

6. **`recomputeProjectDates` transaction safety** — move recompute INSIDE the write transaction in all 4 call sites: `createWeekItem`, `updateWeekItemField`, `deleteWeekItem`, `linkWeekItemToProject`. Mirror the pattern `updateWeekItemField` already uses for `dueDate` reverse-cascade. Add test for concurrent-crash-between-write-and-recompute if feasible; otherwise document the invariant with a comment.

7. **Drizzle snapshot/SQL drift** — `drizzle-runway/0001_melted_weapon_omega.sql` was trimmed to only Chunk 4 columns, but `meta/0001_snapshot.json` still contains 4 pre-existing columns (`clients.nicknames`, `clients.updated_at`, `team_members.full_name`, `team_members.nicknames`, `team_members.updated_at`, `updates.batch_id`) from prior unpushed-as-sql migrations. Either regenerate snapshot to match SQL, or expand SQL to match snapshot. Goal: fresh-DB replay via drizzle-kit migrate works cleanly.

8. **Unconditional `updated_at` bump on no-op recompute** — `recomputeProjectDates` writes `UPDATE ... SET updated_at = ...` even when computed dates equal current. Skip the update when no change. Small perf + audit noise improvement.

## Defer (do NOT fix in Chunk 5, document only in PR message)

- Missing Bonterra Design L2s (pre-existing, investigation needed post-merge)
- Soundly audit rows missing batchId tag (minor, affects publish-updates filtering)
- Chunk 1 commit `23d56eb` not bisect-safe in isolation (squash-merge eliminates if operator prefers)
- Team roster interpretation inconsistency (Soundly full-team vs others engaged-roles) — flag for operator post-merge normalization

## Minor polish

Check `docs/brain/pr86-chunk4-known-debt.md` for any remaining items. Scan Wave 1 + Wave 2 integration state for anomalies.

**OUT:**
- Anything in Chunks 1-4 scope (already merged)
- Data migrations (already run)
- Schema changes (Chunk 4 complete)

**Never:** push, pr, destructive git (until PR open step at end — see below).

---

## Post-CC TP steps (do NOT execute in this prompt — TP does these)

After CC's commits land:
- TP invokes `/code-review` on the full integration branch
- TP invokes `/pr-ready` 
- TP invokes `/atomic-commits --staged` if needed to tidy
- TP writes PR message (per operator's thorough-PR-message preference: why + deployment notes + root causes + verification steps)
- TP opens PR against `upstream/runway`
- TP monitors Llama review

---

## Tests

- Past-end detector: triggers at exactly `end_date < today AND status='in-progress'`, skips when status='completed', skips when end_date null+single-day today
- Any batch-update additions covered

---

## Quality flow (for CC portion)

```bash
pnpm test:run
pnpm build
pnpm lint
```

NO `/code-review`, `/atomic-commits`, `/pr-ready` — TP runs these after CC.

---

## Hard constraints

- NO push, pr, destructive git.
- Stage touched files only.
- Do NOT modify anything in Chunks 1-4 files. If you find a bug, flag for TP; do not fix in Chunk 5.
- Atomic commits.

---

## Output

- Commits (SHAs + messages)
- Files touched
- `pnpm test:run` summary
- `pnpm build` result
- `pnpm lint` result
- Batch-update skill audit findings (as a short markdown file in `docs/tmp/batch-update-audit-2026-04-21.md` if meaningful)
- `git log --oneline`
