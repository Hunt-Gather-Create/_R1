# PR #86 Orchestration Plan — Amendment v2.1

**Status:** Locked. Supersedes `pr86-orchestration-plan.md` v1 where conflicts exist.
**Purpose:** Autonomous execution design, adversarial review, data integrity, rollback, compaction prediction, Max Max pacing.

---

## Operator-locked decisions

1. Fully autonomous execution, zero mid-flight pauses. Any halt = in-lane, logged, other work continues.
2. Data agent halt threshold: drift affecting >1 record OR changing intended outcome.
3. TP resolves UX/polish questions autonomously; logs decisions; operator reviews at wave boundary.
4. Aggressive adversarial review: 3 QA agents per chunk + 1 digest subagent.
5. Concurrency cap: 4 agents in flight max (Max Max plan pacing).
6. Zero operator touchpoints during execution. Vercel auth is a post-merge deploy step, not a merge blocker.

---

## Locked pre-flight decisions

| Decision | Value |
|---|---|
| In Flight toggle default state | ON |
| In Flight default storage | Workspace `view_preferences` JSON (configurable without PR) |
| Bucket sort within weeks | By date ASC (matches existing default) |
| Retainer renewal flag window | 30 days before contract_end |
| `blocked_by` storage | JSON text column on `week_items` (Option A) |
| Data migration backup strategy | Full client-scope snapshot before each agent |

---

## Revised wave structure

### Wave 0 — TP prep (2-3h, TP solo)
- `feature/runway-pr86-base` branch, cherry-picks from `backup/pr86-work` + uncommitted `category` whitelist
- 5 chunk CC prompts
- 3 QA agent prompt templates (code-review premise, atomic-commits premise, data-integrity)
- 1 QA digest subagent prompt template
- 6 overnight client migration specs (remaining-6 excluded, post-merge)
- 6 matching reverse-migration script skeletons
- Compaction prediction ruleset

### Wave 1 — Schema first, then parallel (~6-7h)

**Step 1 (sequential, 1 agent, ~45m):** Chunk 4 schema push.
- Schema + `.sql` + `pnpm runway:push`
- 3 QA agents → digest subagent → TP decision
- **TP merges Chunk 4 to `feature/runway-pr86-base` before firing Batch A** (prevents worktree schema skew)

**Step 2 Batch A (parallel, 4 agents, ~3-4h):** Chunk 1 code + Bonterra + Convergix + Soundly.

**Step 2 Batch B (parallel, 3 agents, ~2-3h):** TAP + HDL + LPPC.
- Each data agent runs from `backup/pr86-work` worktree for `linkWeekItemToProject`
- Flow: pre-snapshot → dry-run → pre-check → apply → post-snapshot → verification subagent
- Each produces forward + reverse script committed to `scripts/runway-migrations/<client>-v4-<date>.ts`
- Adversarial review fires sequentially per chunk; digest subagent consolidates

**Integration 1 (TP, 30-60m):** merge to `feature/runway-pr86-wave1`, reconcile, `/preflight`. Fold agent details into `docs/tmp/pr86-wave-1-details.md`; plan doc gets compact "Wave 1 — DONE" block.

### Wave 2 — UI + bot (~4h)
Parallel (2 agents): Chunk 2 (bot layer) + Chunk 3 (UI, against real schema).
Asprey v4 touchup as background data agent if not already caught.
Integration 2: merge to `feature/runway-pr86-wave2`, prune details.

### Wave 3 — Polish + PR (~4h)
Chunk 5 polish, TP pre-Llama review, PR message, open PR, Llama iteration (1-2 cycles buffer).

### Post-merge — Remaining-6 batch (~1-2h, 1 agent)
Hopdoddy, Beyond Petro, AG1, ABM, EDF, Wilsonart. See `docs/brain/remaining-6-client-state-questions.md`.

---

## Adversarial review protocol

For every code chunk after `/preflight` green, TP spawns 3 QA subagents in parallel. Each receives safety + efficiency preambles + the diff + relevant skill premise.

- **QA Agent 1 (code-review premise):** reads `.claude/skills/code-review/SKILL.md`, applies 5-step premise to diff. Reports line-level findings.
- **QA Agent 2 (atomic-commits premise):** evaluates commits against `/atomic-commits` premise. Reports logical cohesion, messages, bundled changes.
- **QA Agent 3 (data integrity, migration/schema chunks only):** reads pre/post snapshots, expected-state spec. Reports deltas + anomalies by severity.

**Digest subagent:** receives all 3 QA reports + diff. Produces 10-line digest: pass/fail per QA, critical findings only, TP action recommended. TP acts on digest; full QA reports persist in `docs/tmp/qa-reports/chunk-N-qa-*.md`.

**TP decision on digest:**
- All clean → merge to integration, append to plan doc
- Non-critical findings → TP re-specs fix, CC reruns, re-review
- Critical finding → in-lane halt, log, continue other work

---

## Data integrity guardrails

Every data agent follows:
1. **Pre-snapshot:** full client-scope query to `docs/tmp/<client>-pre-snapshot.json`
2. **Dry-run:** `--dry-run` flag, diff logged
3. **Pre-check:** pre-snapshot vs spec's expected pre-state. Drift >1 record OR outcome change = halt + log. Sub-threshold = note + proceed.
4. **Apply:** `--apply --target prod --yes`
5. **Post-snapshot:** same query, store JSON
6. **Verification subagent:** pre + post + expected → anomaly report
7. **Script commit:** forward + reverse committed to `scripts/runway-migrations/`
8. **Outcome:** clean → log. Anomaly → in-lane halt, log, reverse available.

---

## Rollback

Every data migration produces 2 separate script files:
- Forward: `scripts/runway-migrations/<client>-v4-<date>.ts`
- Reverse: `scripts/runway-migrations/<client>-v4-<date>-REVERT.ts` — reads pre-snapshot JSON, applies inverse ops

**If verification halts or operator vetoes at morning review:**
- Primary: `pnpm runway:migrate scripts/runway-migrations/<client>-v4-<date>-REVERT.ts --apply --target prod --yes`
- Secondary: `undo_last_change` with batchId scope (cascades across audit trail)

**Note on harness:** `pnpm runway:migrate <script>` defaults to dry-run. Add `--apply --target prod --yes` to actually write. No `--revert` flag exists — reverse is a separate file invoked the same way.

Post-revert: re-verify against pre-snapshot. If divergent, pause for operator.

---

## Compaction prediction + snapshot cadence

- **60% context:** TP writes wave-state snapshot to plan doc
- **70%:** no new parallel agents, finish in-flight only
- **75%:** MEMORY.md update, full wave snapshot, signal ready to compact
- **Per-agent-complete:** 5-line append to plan doc
- **Per-wave-complete:** fold detail into `docs/tmp/pr86-wave-N-details.md`; plan doc gets 5-10-line "Wave N — DONE" block
- **Target:** plan doc stays under 400 lines through all waves
- **Post-operator-response:** confirm understanding in plan doc before acting

---

## Escalation — no mid-flight pauses

All failure modes resolve in-lane. Agent halts its own work, logs full context, TP continues other work. Operator reviews at wave boundary or end of run.

**In-lane halt triggers:**
- Data drift >1 record OR outcome change
- QA critical finding (security, data loss, convention break)
- Pre-check fails
- `/preflight` fails after 2 fix attempts

**Autonomous TP resolution (no halt):**
- Interface contract drift → TP reconciles at integration
- UX/polish ambiguity → TP picks more-likely, logs
- Sub-threshold data drift → note + proceed
- QA non-critical → TP specs fix, CC reruns
- 1-2 Llama findings post-PR-open → TP drafts fix, fires CC agent

**Log format:**
```
HALT [wave.step.agent] — [what] — [full context snippet] — decision: [continue others | await operator]
```

---

## Claude Max Max pacing

- **Concurrent agent cap: 4.** Never spawn 5th until one completes.
- **Adversarial review: sequential per chunk.** Not bursted.
- **Verification subagents: one at a time.**
- **Batch structure:** Wave 1 split Batch A / Batch B.
- **Token budget reserve:** leave ≥20% window headroom.

---

## Operator communication during execution

**During active data waves, operator does NOT use Slack bot or Runway UI to mutate prod DB.** Write collisions would invalidate pre-snapshots and verification integrity.

If operator must intervene: signal at next agent completion, pause at batch boundary, resolve, resume.

Operator notified at each wave start with ETA + "no DB writes until clear" window.

---

## CC prompt flow corrections

All CC prompts end quality flow at:
```
pnpm test:run
pnpm build
pnpm lint
```

**Removed from CC prompts:** `/code-review`, `/atomic-commits`, `/pr-ready` (operator-invoked only per brain-RULES). QA agents apply their premises instead.

**TP invokes** `/code-review`, `/atomic-commits`, `/pr-ready` at Wave 3 on final integration branch.

**Every spawned agent receives:**
- Safety preamble (from brain-RULES §22)
- Efficiency preamble (from brain-RULES §25)

---

## Risk register deltas from v1

| Risk | v2.1 mitigation |
|---|---|
| Schema timing | Sequential FIRST in Wave 1, merged to base before Batch A |
| Chunk 3 mock drift | Shifted to Wave 2 against real schema |
| Beyond Petro blocks Wave 3 | Moved to post-merge batch |
| Compaction mid-wave | Per-agent snapshots + per-wave detail fold-out |
| CC self-review cheat | QA subagents w/ skill premises + digest |
| Data migration drift | Threshold >1 record/outcome; in-lane halt |
| Operator bottleneck | Fully autonomous; Vercel auth is post-merge deploy, not plan-blocking |
| Max Max window cap | 4 concurrent cap; sequential QA; 20% reserve |
| No rollback path | Reverse scripts per migration + batchId undo fallback |
| Worktree schema skew | Schema merged to base before Batch A fires |
| Vercel auth stall | Not a stall — post-merge deploy only, click when convenient |
| Concurrent DB writes | Explicit no-mutation rule during data waves |
| Plan doc ballooning | Wave-boundary fold-out to details file |
| TP context burn on QA | Digest subagent consolidates 3 QA reports |

---

## Revised timeline

| Phase | Wall clock | Concurrency |
|---|---|---|
| Wave 0 prep | 2-3h | TP solo |
| Wave 1 schema | 45m | 1 agent |
| Wave 1 Batch A | 3-4h | 4 agents |
| Wave 1 Batch B | 2-3h | 3 agents |
| Integration 1 | 30-60m | TP |
| Wave 2 | 4h | 2 agents |
| Integration 2 | 30m | TP |
| Wave 3 | 4h | 1 agent + QA (Llama buffer) |
| Post-merge batch | 1-2h | 1 agent |

**~18-22h total. Zero operator touchpoints during execution. Wave-boundary log reviews async, at operator's convenience. Vercel auth click post-merge to publish to prod.**
