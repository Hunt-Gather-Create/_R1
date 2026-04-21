# PR #86 Wave 3 — Completion Plan (TP execution order)

**Purpose:** Exact sequence TP runs after Chunk 5 agent completes. Zero-stall execution path to PR open.

---

## Step 1 — Receive Chunk 5 completion notification
Read agent's summary (commits, files, preflight results, PR message state).

## Step 2 — Fire Chunk 5 QAs in parallel (code-review + atomic-commits)
Chunk 5 writes no prod data → data-integrity QA not needed.

Templates: `docs/tmp/qa-templates/qa-agent-code-review.md`, `docs/tmp/qa-templates/qa-agent-atomic-commits.md`

Both run against `feature/runway-pr86-chunk-5` with base `feature/runway-pr86-base`.

## Step 3 — Review QA findings
- All PASS → merge Chunk 5 to base
- Non-critical findings → log, merge anyway
- Critical findings → TP assesses, respec-or-accept per precedent

## Step 4 — Merge Chunk 5 into base
`git merge feature/runway-pr86-chunk-5 --no-ff`
Push to origin.

## Step 5 — Final preflight on fully-integrated base
```bash
pnpm test:run    # expect >1640
pnpm build       # expect success
pnpm lint        # expect 0 errors
```

## Step 6 — Read final PR message
`docs/tmp/pr86-message-draft.md` should have all TODOs resolved.
Verify:
- Final test count
- Runtime verification steps filled in
- Known debt and deferred sections accurate

## Step 7 — Open PR (verified command)
```bash
gh pr create \
  --repo Hunt-Gather-Create/_R1 \
  --base runway \
  --head jasonburks23:feature/runway-pr86-base \
  --title "feat(runway): v4 convention — schema, query layer, bot drill-downs, UI, data realigns" \
  --body-file docs/tmp/pr86-message-draft.md
```

Confirmed:
- Remote `origin` = jasonburks23/_R1 (fork)
- Remote `upstream` = Hunt-Gather-Create/_R1 (team repo, runway branch is deploy target)
- Previous PRs #83, #84, #85 all targeted `runway` branch on upstream — same pattern
- gh is authenticated as jasonburks23

## Step 8 — Monitor Llama review
Llama typically triggers within 5-10 min of PR open. Use `docs/tmp/pr86-llama-iteration-playbook.md` for the fire pattern on findings. Autonomous fix for P1/P2; batch P3s or defer.

## Step 9 — Update memory + brain docs
Mark PR #86 as open in memory pointer. Operator reviews TP decisions doc + known-debt doc at their convenience.

## Step 10 — Post-merge follow-ups (operator-driven)
Once PR #86 merges to upstream/runway:
1. (Optional) Operator invokes `/code-review`, `/pr-ready`, `/atomic-commits` at their session level for any extra inspection — these have no-agent flags so TP could not run them during autonomous flow; QA sub-agents applied their premises instead during Wave 1-3
2. Fire remaining-6 cleanup agent: `docs/tmp/cc-prompts/cc-prompt-remaining-6-postmerge.md`
3. Answer 4 operator questions: `docs/brain/remaining-6-client-state-questions.md`
4. Review TP autonomous decisions for ratification/normalization

## Note on quality skills

Per brain-RULES, `/code-review`, `/pr-ready`, `/atomic-commits` are operator-invoked only (no-agent flags). TP honored this during Wave 1-3 by:
- QA sub-agents applied the premises of these skills against diffs (adversarial review pattern)
- TP ran only `/preflight` (test + build + lint) which has no no-agent flag

So PR opens without operator-invoked quality runs. Operator can run them post-merge or between merge and Llama review if desired — they read current branch state, not the PR diff.

---

## Target: Zero operator touchpoints from Chunk 5 fire → PR open

All steps above are TP-mechanical. Operator wakes to either:
- PR #86 open with Llama review pending/complete
- OR specific halt log if something unexpected surfaces

## Halt rules during Wave 3

- Chunk 5 agent halts or fails preflight → log, pause, do NOT open PR
- Chunk 5 QA critical finding → in-lane halt, log, respec fix if feasible
- Llama finds security / data-loss issue → pause, log, operator reviews morning
- Llama finds style/DRY → autonomous fix loop

Anything that can't be autonomously resolved gets logged. Operator wakes up to either "PR open, Llama clean" or "PR open, here's what needed your call."
