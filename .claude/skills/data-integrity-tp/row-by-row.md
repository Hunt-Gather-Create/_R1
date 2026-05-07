# Row-by-Row Data Update Workflow

Direct prod data updates handled interactively in conversation. Distinct from the corrective-batch (triplet) pipeline. No drafter agents, no holdout panels — TP and operator only.

## When to use this workflow

Operator wants to walk through specific rows, dictating values or approving proposals. Common for:
- Notes cleanup passes
- Targeted convention compliance fixes (singletons, not sweeps)
- Single-client deep cleans where every decision needs operator eyes

## When NOT to use this workflow

Use the full corrective-batch pipeline (triplet + drafter + holdout) for:
- Cross-client mechanical sweeps
- Anything touching retainer wrappers / parent-child linkage
- Anything Operator flagged as data integrity risk
- Batches over ~30 writes

The line between row-by-row and triplet is judgment. Default to triplet when unsure.

## Decide-then-ask (hard rule)

Every operator-facing question is a 🟡-flagged recco with confidence level — never an option menu. Apply logic first, present a recco with reasoning, ask for override second. The operator can change direction in one word; they can't help you if you didn't think it through.

❌ Bad: "Past-end status: sweep all to completed, or confirm case-by-case?"
✅ Good: "Past-end status: sweep all 3 to completed (R3 Design Review, Dev Kickoff, Map Dev Revisions). 🟡 Confidence high — they ended 4/23 or 4/24 and today is 4/29. Override if Jill flagged a slip."

❌ Bad: "L1 notes: I draft, or you dictate?"
✅ Good: "L1 notes draft: 'Vanilla HTML/CSS/JS landing page for Bonterra's Impact Report.' 🟡 Override if you want to dictate."

❌ Bad: "Placeholder dates: null them, or keep?"
✅ Good: "Placeholder dates: null them. 🟡 Confidence medium — they're not real schedule signals. Override if you want them as 'tentative kickoff' markers for visibility."

The instinct to defer to the operator on judgment calls is strong. Resist it.

## Pre-Card-1 checklist

Before presenting Card 1, confirm in order:

1. ✅ **Hydrated from prod** — per-client query, full fields. Not the global dump.
2. ✅ **Purged stale snapshots** — `rm docs/tmp/data/*.json` (or skip if folder empty).
3. ✅ **Snapshot written** — `docs/tmp/data/<scope>-snapshot.json` with all rows + `doneInThisSession` flags.
4. ✅ **Batch mode set** — `set_batch_mode(batchId='<scope>-<date>')`.
5. ✅ **Structural review run** — see `data-conventions.md` § Structural review. Any L1 children collapsed into notes? Any rows with `weekOf != Monday(date)`?

If any step is skipped, stop and complete it before card work. The skill's value is in the order, not just the steps.

## Pattern

1. **Hydrate prod state for the affected scope.** Per-client query (`get_week_items(clientSlug=X)` + `get_client_detail(slug=X)`). For multi-client scope use parallel per-client queries, never the global dump.

2. **Snapshot to disk** (non-optional). Purge `docs/tmp/data/*.json`, then write `docs/tmp/data/<scope>-snapshot.json` with full prod state. See `Snapshot-to-disk` below for structure.

3. **Set batch mode** with a unique batchId at the start: `set_batch_mode(batchId='<scope>-<date>')`. Suppresses Slack on `update_week_item` direct calls and tags every audit row.

4. **Present rows as cards.** See `Card format` below. Operator approves, edits, or skips per card.

5. **Write each approved row.** See `Write paths` below. `batch_apply` is preferred — atomic, ordered, fully Slack-suppressed. Direct `update_week_item` is fine with batch mode active. Direct `update_project_field` has a Slack leak — see Quirks.

6. **Adjust pace based on operator signal.** Default to 1 card per message. When operator says "go faster" or "approve" without edits across several cards, batch 3-5 cards per message. When operator pushes back on a call, drop back to 1-card pace.

7. **Verify at end.** Re-pull and confirm all convention checks pass. Report totals.

8. **Disable batch mode** when done: `set_batch_mode(batchId=null)`.

## Card format

```
**Card N of M: [Title]** (`id [first 8 chars]...`, `weekOf [Monday-ISO]`)

| Field | Current | Proposed |
|---|---|---|
| ... | ... | ... |

**What this row IS:** [one-sentence description]

(Optional) **Project context:**
[ASCII gantt strip showing where this row sits — useful when sequencing matters]

**Hard writes (N):** [list]
🟡 **Operator calls:** [judgment calls flagged for explicit yes/no]

Approve, edit, or skip?
```

🟡 = educated guess or non-obvious call. Always flag and let operator confirm — don't bake decisions into writes.

When showing a project context strip, prefer simple ASCII over prose:

```
Mon 6/1   Production Shoot
            ▼
Mon 6/1 ─── Wed 6/3 ─── Thu 6/4 ─── Fri 6/5 ───
            shoot       SITE         R1 Site
                        STAGING      Review
```

## Snapshot-to-disk pattern

Initial full prod hydration burns 150-200k context. After compaction, that context is summarized away. The pattern that survives:

1. **At session start**, purge stale snapshots: `rm docs/tmp/data/*.json` (or skip if folder is empty / doesn't exist yet — `mkdir -p docs/tmp/data` first if needed).

2. **Run the snapshot script** (replaces ad-hoc MCP hydration): `pnpm runway:snapshot --scope=<slug>` (e.g. `--scope=lppc`).
   - Writes `docs/tmp/data/<scope>-snapshot.json` with `_meta` (snapshotAt, scope, rowCounts) + raw `client` / `projects` / `weekItems` / `pipeline` rows. Full passthrough, no projection.
   - Script purges existing `*.json` in the output dir as part of its run, so step 1 is satisfied automatically when you use the script.
   - To track progress, mutate the file post-write to add `doneInThisSession` flag and `remainingTodo` field per row. The script doesn't add these — it's a raw pull.
   - Source: `scripts/runway-snapshot.ts` in the runway worktree. Audit log queries (`find_updates`, `get_data_health`, `get_cascade_log`) stay on MCP — the script is for entity state only.

3. **Compact when context approaches 40-50%.** Write a handoff doc at `docs/tmp/data/<scope>-handoff.md` alongside the snapshot. Handoff carries: resume instructions, design principles agreed in session, remaining row plan with IDs and weekOfs, verification targets.

4. **After compaction**, read both files first. Footprint is much smaller than re-paying the hydration cost. Resume work without re-querying prod for state already captured.

5. **Update the snapshot's `doneInThisSession` flags** as you write rows. The snapshot is the running state of the session.

**Why purge each session:** snapshots are session-scoped. Yesterday's snapshot reflects yesterday's prod, which has drifted. Cross-session contamination from stale snapshots leads to writing against ghost state. Always purge → fresh pull → fresh snapshot.

Trade-off within a session: the snapshot can drift if prod changes mid-session. For row-by-row work where TP and operator are the only writers, drift is bounded. Re-pull at end before verification if a long session.

## Write paths

Within row-by-row workflow:

| Write type | Use | Why |
|---|---|---|
| Multi-field on one L2 row | `batch_apply` (one batchId across all ops) | Atomic + ordered + Slack-suppressed |
| Single L2 field, batch mode active | `update_week_item` direct | Convenient + Slack-suppressed via batch mode |
| Multi-field on one L1 (project) | `batch_apply` with `update_project_field` ops | ⚠️ Direct `update_project_field` leaks Slack even with batch mode |
| Single L1 field | `batch_apply` (single op) | Same Slack reason |
| Cross-row sweep (10+ rows) | Single `batch_apply` with all ops | Best audit grouping |

## MCP write quirks

| Issue | Workaround |
|---|---|
| `update_week_item` field enum excludes `weekOf` | Use `batch_apply` with op tool=`update_week_item` field=`weekOf`. Bypasses the strict MCP enum, hits the underlying `WEEK_ITEM_FIELDS` whitelist (which DOES include weekOf). |
| `update_client_field`, `delete_pipeline_item` not in BATCH_DISPATCH | `set_batch_mode(batchId)` then call directly — audit row gets tagged but write happens outside batch_apply. |
| `update_project_field` direct call leaks Slack despite batch mode active | Use `batch_apply` with op `update_project_field` instead. Confirmed working suppression. Direct call has a code-side gap. |
| `update_project_field` field enum excludes `startDate` and `endDate` | L1 dates auto-derive from L2 dates (and child L1s for retainer wrappers). To change L1 dates, change the underlying L2 dates and let recompute drive. For wrapper-guarded direct overrides, use `overrideProjectDate`. |
| Reverse-cascade on `category=deadline` date writes | Validate category before any date write on rows with parent project. Flip category to `delivery` first if intent is to move date without cascading. |
| Discovering a missing L1 child during cleanup | Use `add_project` with `parentProjectId` set to the wrapper. Pass status, dates, owner, and resources in the create call to avoid follow-up writes. The L1 child must be a real entity (own scope), not just a notes detail. |
| Retainer wrapper dates don't auto-fill from children | Recompute drives child L1 dates from their L2 dates, but does NOT propagate up to the retainer wrapper. After adding/updating child L1s, the wrapper's `startDate`/`endDate` may still be null. Acceptable to leave null (system-side quirk) or use `overrideProjectDate` to set explicitly. |
| Stale `weekOf` after a prior date change | When prior cleanup moved `date` across a Monday boundary without updating `weekOf`, the row has `weekOf != Monday(date)`. Lookup by convention-correct weekOf will fail. Always check `weekOf == Monday(date)` during structural review; if mismatched, look up by the stale weekOf and include a `weekOf` fix in the write. |

## Order rules within a batch_apply

When updating multiple fields on the same row:
1. Update `category` first if changing it (changes type before any date math)
2. Update `date`, `dayOfWeek`, `endDate`, `notes`, etc. in any order
3. Update `weekOf` LAST — every op's lookup uses the row's CURRENT weekOf, so changing it mid-batch breaks subsequent lookups

Across rows, order doesn't matter — each op is independent and uses its own row's lookup.

## Verification at end

After all row writes, run a single `get_week_items(clientSlug=X)` and `get_client_detail(slug=X)`. Verify:
- `endDate` populated where convention requires
- Range tasks: `date == endDate` AND `dayOfWeek == day-of-endDate`
- Single-day: `date == startDate == endDate`
- `weekOf == Monday(date)` (verify via filter query if needed — `get_week_items` projection omits weekOf)
- No "OPERATOR" markers in notes
- No `(client)` annotations on contractor names

Report totals: rows touched, audit row count, batchId, any residual flags.

For the closing mechanical sweep across the client (broader than per-row verification): see `data-conventions.md` § Mechanical sweep categories. Five enumerated categories must be named explicitly before scoping the sweep.

## Common pitfalls

| Pitfall | Prevention |
|---|---|
| Forgetting to set batch mode → first write leaks Slack | Set batch mode FIRST, before any write tool call. Card 1 gets the same treatment as Card N. |
| `update_project_field` direct call → Slack leak | Always wrap project-field writes in `batch_apply`, even single ops. |
| Updating `weekOf` before other fields → subsequent lookups fail | weekOf goes LAST within any row's ops. |
| L1 notes recap every L2 schedule | L1 = highlights only. See `data-conventions.md`. |
| Card presentation too thin | Include row context (what this row IS, project gantt strip when sequencing matters). Operator pushed back specifically when cards lacked detail. |
| Card presentation too verbose | Drop the gantt strip when sequencing isn't relevant. Tighten field tables to changed fields only after first card. |
| Open decisions sent to operator | Don't punt — make the call, flag with 🟡, let operator override. Avoid option menus. |
