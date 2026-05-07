# Drafter Agent Prompt Template

Load this when dispatching a drafter agent to author a triplet.

## Role of the Drafter

The drafter is a CC agent that translates a TP-approved batch spec into an executable triplet (forward + verify + REVERT) inside the data-tp-runway worktree. Drafter writes the scripts. TP reviews them.

Drafter is one agent dispatched in worktree isolation. Drafter returns paths and a 200-word summary. Drafter does NOT return the script content (TP reads files in the worktree directly).

## Dispatch Pattern

```
Agent({
  description: "Draft <batch-name> triplet",
  subagent_type: "general-purpose",
  isolation: "worktree",
  prompt: <see template below>,
})
```

## Drafter Prompt Template

```
You are a drafter agent for the Runway data-integrity TP. You are writing one batch triplet.

EXECUTE NOW. Do not enter plan mode. Do not ask clarifying questions unless the spec is contradictory. Default to the spec exactly as written.

## Spec

<paste the TP-approved spec here. Include: batch name, batchId, updatedBy, list of writes with row id + field + old value + new value + helper to call, audit-row count, intent context>

## Files to write

In the worktree at `.worktrees/data-tp-runway/scripts/runway-migrations/`:

1. `<batch-name>-<date>.ts` — forward batch
2. `<batch-name>-<date>-verify.ts` — post-APPLY assertion
3. `<batch-name>-<date>-REVERT.ts` — rollback

## Files to read for context

- `scripts/runway-migrations/_template-batch.ts` (if exists; otherwise pattern from prior batch like `lppc-phase3-kathy-confirmed-2026-04-27.ts`)
- `src/lib/runway/operations-utils.ts` (PROJECT_FIELDS, WEEK_ITEM_FIELDS, validators, idempotency)
- `src/lib/runway/operations-writes-project.ts` (helper: updateProjectField, overrideProjectDate, setProjectParent)
- `src/lib/runway/operations-writes-week.ts` (helper: createWeekItem, updateWeekItemField, deleteWeekItem)
- `src/lib/runway/operations-writes.ts` (helper: updateProjectStatus)

## Triplet structure rules

### Forward batch (`<batch-name>-<date>.ts`)

- Imports helpers, sets batch mode at start (`setBatchId(BATCH_ID, UPDATED_BY)`), unsets at end
- Each write is a helper call (not raw drizzle), unless field is outside PROJECT_FIELDS / WEEK_ITEM_FIELDS — then raw drizzle + manual `insertAuditRecord`
- Wrapper retainer date writes use `overrideProjectDate({bypassGuard: true})`
- Category-first ordering when changing category + date on a deadline-category L2
- Paired `startDate` writes alongside `date` writes (defuses recompute preference)
- Paired `dayOfWeek` writes alongside `date` writes (drafter computes day-of-week from new date)
- DRY_RUN mode: `if (DRY_RUN) { console.log(<intended write>); return; }` BEFORE the helper call. Logs every intended write without executing.
- APPLY mode: actually fires the helper. Operator passes `--apply` flag.

### Verify script (`-verify.ts`)

- One assertion per intended state change
- Reads prod, asserts match, exits non-zero on any failure
- Audit-count assertion: `find_updates(batchId)` length matches documented count

### REVERT script (`-REVERT.ts`)

- Inverse writes with bumped `updatedBy` (e.g., `<original-updatedBy>-revert`)
- Same pattern: helper calls in DRY_RUN/APPLY modes
- Documents which audit rows from the forward batch will be REVERSED (not deleted; new audit rows with inverse values)

## Validation requirements

Before reporting "DRY_RUN green" you MUST:

1. Run the forward script in DRY_RUN mode: `pnpm tsx scripts/runway-migrations/<batch-name>-<date>.ts`
2. Verify output count matches the audit-row count in the spec
3. Verify each intended write logs cleanly (no validator rejections, no missing helpers)

## Return format

Reply with:

1. The three file paths (forward + verify + REVERT)
2. DRY_RUN output line count and audit-row count match (yes/no)
3. 200-word summary covering: helpers used, any raw-drizzle write paths and why, ordering decisions (category-first cases), paired-startDate cases, paired-dayOfWeek cases, wrapper-guard bypass cases, expected audit row count
4. Any spec ambiguities you resolved with explicit choices

DO NOT paste the script content. TP will read the files.

DO NOT modify any other files. Modify ONLY the three triplet files in `scripts/runway-migrations/`.

DO NOT run APPLY. Operator runs APPLY after TP gate.

DO NOT skip DRY_RUN.
```

## Common Drafter Pitfalls (Pre-empt in Spec)

1. **Drafter uses raw drizzle when helper would work** — be explicit in the spec: "use updateProjectField for these fields; use overrideProjectDate for these date fields; raw drizzle only for X."
2. **Drafter forgets paired startDate** — spec must list both `date` and `startDate` writes for every range L2 correction. Don't rely on drafter to derive.
3. **Drafter computes wrong dayOfWeek** — provide the dayOfWeek string in the spec, computed from the corrected date. Don't make drafter compute from JavaScript Date object.
4. **Drafter pads audit count off by one** — explicitly state the count in the spec. Drafter must verify DRY_RUN count matches.
5. **Drafter omits wrapper guard bypass** — if a write touches retainer wrapper dates (engagementType="retainer" with children), spec must say `overrideProjectDate({bypassGuard: true})` explicitly.
6. **Drafter changes scope** — spec lists writes by row id and field. Drafter doesn't add or remove writes. If the drafter sees an obvious gap, they list it in the return summary as "spec ambiguity / suggestion" — TP decides whether to expand scope.

## Re-dispatch After QA Findings

If holdout or code-correctness QA returns FAIL:

1. Compose a new spec with the corrections (NOT a free-form fix request)
2. Bump the batchId date stamp if needed (re-running same batchId may cause idempotency collision on partial-applied state)
3. Bump `updatedBy` if Round 1 already partially applied (per `feedback_revert_idempotency_poisoning` rule)
4. Re-dispatch fresh drafter (clean context, not SendMessage)
5. Re-DRY_RUN, re-rails-check, re-QA
