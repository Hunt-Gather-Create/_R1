# Holdout Panels — Dispatch and Interpretation

Load this when dispatching the 5 holdout QA panels plus the code-correctness QA agent.

## Why Holdout

The 2026-04-28 trust failure happened because every QA pass that day was code-review-only: agents read the spec plus the triplet plus the helpers, and verified internal consistency. The audit was circular. Spec and code came from the same upstream (TP plus drafter), so flaws in either stayed invisible.

Holdout panels read prod state and operator-stated intent INDEPENDENTLY of the spec. None of them read the triplet, the DRY_RUN output, or the spec doc. They evaluate prod against intent and report divergences. Combined with code-correctness QA (which reads the spec + triplet + helpers), both tracks together cover "the spec matches operator intent" plus "the script implements the spec correctly."

Skipping the holdout track is the failure pattern.

## The 5 Panels

Each panel is a separate fresh-context Agent dispatch with `isolation: "worktree"`. Run all five plus code-correctness QA in parallel as a single message with six Agent tool calls.

### Panel 1: Completeness

**Reads**: every entity (project, weekItem, pipelineItem, client) touched by the batch. Plus the runway-data-integrity-intent.md conventions doc.

**Reports**: every field that is null where convention says it should not be. Examples to look for:
- Project with `engagementType="retainer"` and null `contractStart` or `contractEnd`
- Project with `status="in-production"` and null `notes`
- WeekItem in a range (multi-day) and null `endDate`
- WeekItem with null `status` (Slackbot create-gap)
- WeekItem with null `dayOfWeek` (drafter-gap)
- Active project with null `owner`
- Retainer project (engagementType="retainer") with null `startDate`/`endDate` and no children to recompute from

**Output format**: list each row with id (8-char prefix), title, and which fields are null-but-shouldnt-be. Cite the convention rule.

### Panel 2: Consistency

**Reads**: same entities. Plus current convention doc.

**Reports**: invariant violations independent of intent.
- WeekItems where `date != endDate` on multi-day range tasks (current convention: `date=endDate` on ranges)
- WeekItems where `dayOfWeek` does not match the actual day-of-week of the `date` field
- WeekItems where `weekOf` is not the Monday of the week containing `date`
- WeekItems where `startDate > endDate` (impossible)
- Single-day milestones (no endDate) where `startDate != date`
- Range tasks where `startDate > date`
- Resources strings that don't pass `normalizeResourcesString` shape (raw names without role prefix where convention requires it)

**Output format**: list each row with id (8-char prefix), title, and the specific invariant violated. Compute the expected value vs actual.

### Panel 3: Intent Fidelity

**Reads**: operator-stated decisions in this conversation, this session's TP plan, the runway-data-integrity-intent.md, plus prod state. Optionally Slack threads or schedule sheets if the operator pointed at specific ones in the intent doc.

**Reports**: divergence between what operator said they wanted and what prod reflects. Every divergence cited with source.

**Output format**: list each divergence as: "Prod state: X. Operator stated: Y. Source: <citation>. Status: covered by batch / NOT covered / unclear."

### Panel 4: Source Attribution

**Reads**: prod entities touched by the batch. For each non-trivial value (vendor name, contractor label, date, scope), trace the source.

**Reports**: any value that traces to "drafter inferred" or "TP guess" rather than a citable source (Slack thread, schedule sheet, operator decision, prior audit log entry, clientContacts entry).

**Specific patterns to flag**:
- Vendor names appearing in `resources` (e.g., "Vendor: Ken Clark") that don't appear in clientContacts or operator messages
- Contractor labeled as "client" or "client" labeled as contractor (cross-check team_members.roleCategory)
- Specific dates that don't appear in any operator-shared schedule
- Task titles that don't match any operator-shared work breakdown

**Output format**: list each value with: "Value: X. Where it appears: row id Y. Sourced from: <citation> OR FLAGGED as inferred."

### Panel 5: Cascade Integrity

**Reads**: parent projects + their weekItems and child projects. Computes derived state and compares to stored state.

**Reports**: cascade and recompute violations.
- For every project touched: `project.startDate == MIN(children.startDate ?? children.date)` and `project.endDate == MAX(children.endDate ?? children.startDate ?? children.date)`. Drift means recompute didn't fire or was overridden.
- For every retainer wrapper: confirm guard intact (wrapper dates set manually, not derived from L2 widths).
- For every project with `dueDate` set: confirm linked deadline weekItems' `date` matches `dueDate` (forward cascade integrity).
- For every weekItem with `category="deadline"` and `date` set: confirm parent project's `dueDate` matches (no reverse-cascade orphans).
- Orphan check: any weekItem with `projectId=null` (should be 0).

**Output format**: list each project with: "Stored: startDate=X endDate=Y. Computed from children: startDate=A endDate=B. Drift: yes/no."

## Code-Correctness QA Agent (Sixth Parallel)

Reads: the triplet (forward + verify + REVERT), the helpers it calls, the DRY_RUN output, the spec doc.

Reports: bugs, plan-vs-script mismatches, rails violations (12-point checklist), date/weekday math, recompute coverage, transaction ordering risks, audit-trail correctness, idempotency hygiene.

Priority tags: critical / warning / nit. Cap report at ~800 words.

## Dispatch Template (Agent Tool Call)

For each holdout panel, dispatch with this prompt shape. Replace `<PANEL>` and `<PANEL_INSTRUCTIONS>` per panel.

```
You are a fresh-context QA agent for the Runway data-integrity TP. Your panel is <PANEL>.

You have NO access to the spec, the migration script (triplet), or the DRY_RUN output. Do not look for them. Do not read docs/tmp/data-integrity-audit/. Do not read brain docs.

Your read scope is:
- Prod state via the runway MCP tools (get_clients, get_projects, get_week_items, get_pipeline, find_updates, etc.)
- The intent reference at docs/runway-data-integrity-intent.md
- The conventions in <link to current intent doc>
- (For Panel 3 only): operator-shared Slack threads or schedule sheets the intent doc cites

Your job:
<PANEL_INSTRUCTIONS>

Output format:
- Verdict: PASS / WARN / FAIL
- Findings: list each as priority (critical/warning/nit) + row id (8-char prefix) + title + the specific issue + cited rule
- Cap at 800 words

Run as agent in worktree isolation. Do not modify any files. Read-only.
```

For the code-correctness QA agent:

```
You are a fresh-context code-correctness QA agent for a Runway prod-write batch.

Your read scope is:
- Triplet at .worktrees/data-tp-runway/scripts/runway-migrations/<batch-name>-<date>.{ts, -verify.ts, -REVERT.ts}
- DRY_RUN output (will be provided as a file path or pasted)
- Helpers at src/lib/runway/operations-utils.ts, operations-writes-project.ts, operations-writes-week.ts, operations-writes.ts
- The 12-point rails compliance checklist at ~/.claude/skills/data-integrity-tp/rails-reference.md

Your job:
- Verify the triplet implements the spec correctly
- Run the 12-point rails compliance check against the actual script
- Flag bugs, ordering risks, recompute interactions, audit-row count mismatches
- Check idempotency key composition for revert+retry safety

Output format:
- Verdict: APPLY-clean / APPLY-after-fix / DO-NOT-APPLY
- Findings: priority (critical/warning/nit) + file:line + the specific issue + recommended fix
- Cap at 800 words

Run as agent in worktree isolation. Read-only.
```

## Interpretation

| Verdict | Action |
|---|---|
| All 6 PASS | Hand Operator the APPLY command string. Wait for Operator greenlight. |
| 1+ FAIL on any panel | Block APPLY. Send drafter back to fix. Re-DRY_RUN. Re-dispatch the failing panel(s). |
| WARN findings only | Triage with Operator. Decide whether to fix in this batch or fold into a follow-up. Document the call. |

WARN that's tolerated must be tracked. Convention violations accumulating as ignored WARN-tier became the 2026-04-28 trust failure.

## Round 2 (If Round 1 Found Critical Issues)

If Round 1 surfaced critical issues that the drafter fixed:

1. Re-DRY_RUN
2. Spawn a SECOND fresh-context QA agent (do NOT reuse via SendMessage; clean slate). Ask it to:
   - Verify each Round 1 fix landed
   - Hunt new issues the first round may have missed
3. Same panels. Same report shape.

If Round 2 finds new critical issues, fix and repeat. Otherwise APPLY.

## Stale-Snapshot Defense

If more than 30 minutes elapsed between holdout panels completing and Operator giving APPLY greenlight: re-pull prod state and re-run the affected panels (typically Cascade Integrity and Completeness) on fresh data. Prod may have shifted via Slackbot writes during the gap.
