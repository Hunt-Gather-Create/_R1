# CC Prompt — Remaining-6 Post-Merge Cleanup

## Mission

Single agent cleanup pass. Apply v4 convention to 6 clients not touched during Wave 1 overnight work: Hopdoddy, Beyond Petro, AG1, ABM, EDF, Wilsonart. Runs AFTER PR #86 merges to runway branch.

**SAFETY PREAMBLE:**
You are operating as a sub-agent on a production codebase. Before making any destructive change, deleting files, or modifying shared configuration, stop and confirm with the operator. Do not assume. Do not guess at intent. If something is ambiguous, surface it before acting.

**EFFICIENCY PREAMBLE:**
Work in focused, atomic steps. Stay in scope.

---

## STEP 0 — State check

```bash
git branch --show-current
git fetch origin
git log --oneline origin/runway -5   # verify PR #86 merged to runway branch
git checkout -B cleanup/remaining-6-v4-postmerge origin/runway
ls scripts/runway-migrations/   # should see all v4 migrations from PR #86
grep -l "engagement_type\|start_date\|blocked_by" src/lib/db/runway-schema.ts   # schema should have v4 columns
```

HALT if PR #86 not yet merged to runway — this agent is post-merge only.

## Locked TP decisions (consistent with Wave 1/2)

- Team roster: engaged-roles-per-L1 interpretation (union of L2 roles + L1 owner role; if L1 has no L2s, fall back to full `clients.team`)
- `engagement_type='project'` default on most clients unless evidence of retainer
- Null L2 resources OK if single-person work (v4 rule)
- PROJECT_FIELDS whitelist gap may be fixed in Chunk 5 — if still present, use raw `ctx.db.update()` + `insertAuditRecord()` pattern
- Title format: `[Project Name] — [Milestone]`, em-dash, no client prefix, no category word
- Dormant L1s with no historical evidence: leave resources null

## Per-client direction

**Read operator decisions first:** `docs/brain/remaining-6-client-state-questions.md` has 4 open questions. If operator has answered them in the doc, apply those answers. If not, use the defaults below and flag each in a post-run note.

### Hopdoddy
- Light — reconcile L1 with existing week items
- Apply v4 convention (team roster, owner inheritance, engagement_type)
- `engagement_type='project'` default

### Beyond Petro (complex)
- 9 projects on record, 4 SOWs out, rest dormant
- **If operator hasn't specified dormant/active split:** mark all SOWs-out as `status=awaiting-client`, everything else as dormant (`on-hold` or preserve current)
- `engagement_type='project'` default
- Team roster from `clients.team` per engaged-roles rule

### AG1
- Video trial scope
- **If operator hasn't specified state:** leave status as-is, flag in post-run note
- `engagement_type='project'`

### ABM
- New biz, RFP response
- **If operator hasn't specified RFP state:** keep as pipeline, flag in post-run note
- `engagement_type='project'` if won; stays in pipeline otherwise

### EDF
- Jill reviving
- **If operator hasn't specified state:** keep current status, flag in post-run note
- `engagement_type='project'`

### Wilsonart
- Light — graphics tweak
- `engagement_type='project'`

## Workflow (for each of the 6)

For each client, in order:

1. **Pre-snapshot:** `docs/tmp/<slug>-v4-postmerge-pre-snapshot-2026-04-XX.json`
2. **Write forward script:** `scripts/runway-migrations/<slug>-v4-postmerge-2026-04-XX.ts`
3. **Dry-run:** `pnpm runway:migrate scripts/runway-migrations/<slug>-v4-postmerge-2026-04-XX.ts --target prod`
4. **Apply:** `pnpm runway:migrate ... --apply --target prod --yes`
5. **Post-snapshot + reverse script**
6. **Commit 2 atomic commits per client:** forward + reverse

Can process all 6 sequentially in one agent session since they're independent.

## Halt rules per client (in-lane halt, continue with next)

- Drift >1 record or outcome change → HALT this client, log to `docs/tmp/<slug>-v4-halt-report.md`, continue with next client
- Pre-existing v4 compliance discovered → log as no-op, skip, continue
- Prod state contradicts operator answer → HALT, document conflict

## Quality flow

`pnpm test:run` / `pnpm build` / `pnpm lint` at end of all 6 migrations.

## DO NOT

- `git push`, `gh pr *`
- Modify code outside `scripts/runway-migrations/` and `docs/tmp/<slug>-*`
- Skip halt rules

## Output format

```
### Remaining-6 Post-Merge Cleanup Complete

**Branch / Worktree:** <>
**Commits:** <list 12 commits: 6 forward + 6 reverse, or fewer if halts>

**Per-client summary:**
- Hopdoddy: <ops, status, halted or clean>
- Beyond Petro: <ops, status>
- AG1: <ops, status, flagged unknowns>
- ABM: <ops, status, flagged unknowns>
- EDF: <ops, status, flagged unknowns>
- Wilsonart: <ops, status>

**Open questions flagged for operator:** <list>
**Preflight:** test / build / lint <results>
**Concerns:** <or none>
```
