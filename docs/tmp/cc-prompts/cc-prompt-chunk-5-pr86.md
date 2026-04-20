# CC Prompt — PR #86 Chunk 5: Notifications, Polish, PR Prep

## Mission

Final chunk. Add past-end L2 detector to flags rail. Audit batch-update skill for gaps. Run `/code-review`, `/pr-ready`, `/atomic-commits` on the full integration branch (TP-invoked, not CC). Draft PR message. Open PR. Iterate Llama findings.

**Safety preamble:**
> You are operating as a sub-agent on a production codebase. Before making any destructive change, deleting files, or modifying shared configuration, stop and confirm with the operator. Do not assume. Do not guess at intent. If something is ambiguous, surface it before acting.

**Efficiency preamble:**
> Work in focused, atomic steps. Stay in scope.

---

## Context

**Working directory:** `{WORKTREE_PATH_CHUNK_5}` (off `feature/runway-pr86-wave2`)
**Branch:** `feature/runway-pr86-chunk-5`
**Base:** `feature/runway-pr86-wave2` (Chunks 1-4 + all data migrations integrated)

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

**IN:**

1. **Past-end L2 detector** — add to `src/lib/runway/flags-detectors.ts`. Criteria: `end_date < today AND status='in-progress'`. Returns a flag object compatible with existing flags rail format. Wire into flags page and bot's plate response.

2. **Batch-update skill audit** — read `.claude/skills/batch-update/SKILL.md`. Evaluate:
   - Does it support filter + multi-field update?
   - Does it support dry-run with diff output?
   - Does it tag batchId on audit records?
   - Does it support bulk L2-owner backfill (for operator-initiated "apply L1 owner to all L2s of this project")?
   - Any gaps → propose lightweight additions (max 30 lines of code). If the skill is solid, document as-is and skip.

3. **Minor polish** — any surfaced items from Wave 1-2 integration notes (check `docs/tmp/pr86-wave-1-details.md` and `pr86-wave-2-details.md` for any deferred polish items TP flagged).

4. **Tests** for the detector and any batch-update additions.

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
