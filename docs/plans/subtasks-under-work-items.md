# Subtasks under work items

Pre-plan for `_R1#67`. Written by Runway TP on 2026-09-02 for CC handoff.
Operator chose to build this on 2026-09-02, option A on the walk.

## What ships

A subtask is a smaller step inside one work item. It has a title, an owner, a
status of todo or done, a position, and a due date. The work item card shows a
done over total count. Opening the work item shows the list.

## The design is already recorded, follow it

`src/lib/db/runway-schema.ts:84-88` names the choice and it predates this plan:

> L5 door (unified-hierarchy principle): every level is potentially actionable
> AND container. week_items becomes container-capable when real subtask demand
> appears.
> `// parentTaskId: text("parent_task_id"),  // FK-free self-ref per parentProjectId convention`

So a subtask is a `week_items` row with `parentTaskId` set. It is not a new
table. This matches how a sub-project already works, a `projects` row with
`parentProjectId` set.

Do not introduce a `subtasks` table. The ticket's preserved original text
proposes one, and also proposes a wrapper-as-entity migration. Both are stale.
The wrapper already ships as a `projects` row with a null `parentProjectId`.
Read only the rewritten top half of the ticket, not the quoted block below it.

## Operator and TP decisions, do not re-litigate

**One level deep.** A subtask cannot own subtasks. Enforce it in the write
helper, not by convention. A row whose own `parentTaskId` is set must be
refused as a parent.

**Completed subtasks stay visible, struck through.** They do not hide behind a
toggle. The reason is that the card already carries the done over total count,
so hiding removes the record without adding information. Log this in
`DECISIONS.md` with that reason.

**Title limit 280 characters,** matching the work item notes convention.

## The hazard, and it is the whole job

`weekItems` is read in **56 files** under `src/lib/runway` and `src/app/runway`.
Every one of those reads currently assumes a `week_items` row is a top-level
work item. The moment a subtask is a `week_items` row, all 56 are wrong unless
they exclude it.

If this is missed, subtasks appear as their own cards on the board, count as
work in health checks, and feed the date rollup.

Three consequences to handle by name:

1. **Board and list reads must exclude `parentTaskId IS NOT NULL`.** Start with
   `operations-reads-week.ts`, `operations-reads-sections.ts`,
   `operations-reads-project-status.ts`, `data-for-commands.ts`,
   `bot-context-sections.ts`.
2. **Date rollup must ignore subtasks.** `recomputeProjectDatesWith` takes MIN
   and MAX over week item dates to derive the parent's dates. A subtask due
   date must not move a project's dates.
3. **The L1 dueDate cascade must not reach subtasks.** The cascade writes
   through to child week items. It must stop at the work item.

Also check, and say what you found either way: the Gantt filters, the sheet
sync `taskNo` minting and `sheet_sync_ledger` registration, and the health and
orphan checks.

## Sequencing

Two branches, in order. Do not combine them.

**Phase 1, data and writes.** Schema field, migration, write helpers for
create, update, complete and delete, read exclusions across the 56 file
surface, cascade and rollup guards. No UI.

**Phase 2, interface.** Done over total count on the work item card. The list
when a work item is opened. A checkbox on each subtask row that routes through
the same helper, so the audit trail and the recompute behave exactly as they do
for a work item today.

Phase 2 does not start until Phase 1 is gated and merged.

## Out of scope

Drag and drop reordering. Subtask templates. Bulk complete across work items.
Project-level checkboxes. Anything touching the wrapper model.

No production writes. The schema push is a deploy-time step and is not this
ticket's job to run.

## Done when

**Phase 1.** A subtask row exists in the database under a work item. The board,
the section reads, the bot context and the health checks all still return the
same number of work items they returned before it existed. Proved by counting
before and after against the same database, not by a passing test suite.

A second proof, run the other way: attempt to give a subtask its own subtask
and watch the helper refuse it. Attempt to set a subtask due date far outside
its project's range and confirm the project's dates do not move.

**Phase 2.** A person checks off a subtask in the interface. The count on the
card changes. The completed subtask stays visible with a strike through. One
audit row is written, the same shape a work item completion writes.

A green suite proves none of this on its own. The point is the 56 read sites,
and a test written against the new code cannot notice a read site nobody
changed. Count rows against a real database.
