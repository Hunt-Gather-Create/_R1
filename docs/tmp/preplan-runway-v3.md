# Runway Bot v3: Deadline Cascade + Logging

## Context

PR #81 (Bot v2) shipped and is deployed. Thread history, write operations, fuzzy matching, undo, and capability boundaries all work. But a critical bug was found in production:

**Leslie asked the bot to "move the Bonterra deadline to 4/28."** The bot:
1. Correctly disambiguated between 3 Impact Report projects (fuzzy matching works)
2. Called `update_project_field` to set `projects.dueDate = "2026-04-28"` (DB write worked)
3. Told Leslie "Done"
4. But Leslie kept seeing 4/23 on the board

**Root cause:** The board reads from **week items** (calendar entries), not from `projects.dueDate`. The "4/23" was a week item titled "Bonterra Impact Report — code handoff" with `date=2026-04-23` and `category=deadline`. Updating `projects.dueDate` doesn't touch week items -- so the user never sees the change.

**Additional findings:**
- 24 of 39 week items have `project_id = NULL` (unlinked to any project). All 4 Bonterra items are unlinked.
- `projects.dueDate` is NOT surfaced anywhere in the board UI
- No-op duplicate updates (same value → same value) still post to the updates channel
- Zero structured logging of tool calls -- debugging requires forensic DB queries

**Decision:** Week items are the source of truth for what users see. `projects.dueDate` is secondary metadata.

---

## Phase 1: Data Foundation

**Goal:** Fix the broken links so cascades have something to cascade to.

### 1A. Backfill week item links

**New file: `scripts/backfill-week-item-links.ts`**

Reuse `findProjectIdForWeekItem()` from `scripts/seed-runway.ts` (already exported, already tested in `scripts/seed-runway.test.ts`).

Script flow:
1. Query all week items where `project_id IS NULL` and `client_id IS NOT NULL`
2. Query all projects, group by `clientId`
3. For each unlinked item, run `findProjectIdForWeekItem(clientId, title, projectsByClient)`
4. If match found, update the week item's `project_id`
5. Dry-run mode by default (`--apply` flag to commit)
6. Log each match/non-match for review

Env: needs `export $(grep -E '^RUNWAY_' .env.local | xargs)` before running (same as other runway scripts).

**Test:** Run dry-run, review matches against the 24 unlinked items. The linking function already has tests in `scripts/seed-runway.test.ts`.

### 1B. Add `getLinkedDeadlineItems` helper

**Modify: `src/lib/runway/operations-reads-week.ts`**

New function alongside existing `getLinkedWeekItems`:

```typescript
export async function getLinkedDeadlineItems(projectId: string): Promise<WeekItemRow[]> {
  const db = getRunwayDb();
  return db.select().from(weekItems)
    .where(and(eq(weekItems.projectId, projectId), eq(weekItems.category, "deadline")));
}
```

Imports needed: `and` from `drizzle-orm` (add to existing import).

**Export chain:** `operations-reads-week.ts` → `operations-reads.ts` → `operations.ts`

**Test** (add to `src/lib/runway/operations-reads.test.ts`):
- Returns only deadline-category items for a project
- Returns empty array when no deadline items linked
- Does not return non-deadline items (review, delivery, etc.)

### Phase 1 Checkpoint
- [ ] Backfill script runs in dry-run, matches reviewed
- [ ] After `--apply`, unlinked count drops significantly
- [ ] `getLinkedDeadlineItems` exists with tests
- [ ] `pnpm test:run`, `pnpm build`, `pnpm lint` all pass

---

## Phase 2: Cascade + No-Op Fix

**Goal:** Deadline changes propagate bidirectionally. No-ops stop spamming the channel.

### 2A. Forward cascade: project dueDate → week items

**Modify: `src/lib/runway/operations-writes-project.ts`**

After the existing `db.update(projects)` call (line 69-72), add cascade when `field === "dueDate"`:

```typescript
const cascadedItems: string[] = [];
if (typedField === "dueDate") {
  const linkedDeadlines = await getLinkedDeadlineItems(project.id);
  for (const item of linkedDeadlines) {
    await db
      .update(weekItems)
      .set({ date: newValue, updatedAt: new Date() })
      .where(eq(weekItems.id, item.id));
    cascadedItems.push(item.title);
  }
}
```

Add `cascadedItems` to the return `data` object so the bot can mention which calendar items were updated.

New imports: `getLinkedDeadlineItems` from `./operations` (or reads barrel), `weekItems` from schema.

**Pattern reference:** `src/lib/runway/operations-writes.ts` lines 85-102 (status cascade).

**Tests** (add to `src/lib/runway/operations-writes-project.test.ts`):
- "cascades dueDate to linked deadline week items" -- mock `getLinkedDeadlineItems` returning 2 items, verify both updated
- "does not cascade non-dueDate field changes" -- update owner, verify `getLinkedDeadlineItems` never called
- "handles no linked deadline items gracefully" -- empty array, no error

### 2B. Reverse cascade: week item date → project dueDate

**Modify: `src/lib/runway/operations-writes-week.ts`**

After `updateWeekItemField` writes to the week item, add reverse cascade when `field === "date"` AND item has `category === "deadline"` AND `item.projectId` is not null:

```typescript
if (typedField === "date" && item.category === "deadline" && item.projectId) {
  await db
    .update(projects)
    .set({ dueDate: newValue, updatedAt: new Date() })
    .where(eq(projects.id, item.projectId));
}
```

New import: `projects` from schema.

**No circular cascade risk:** Forward cascade is inside `updateProjectField` (writes to `weekItems` table directly). Reverse cascade is inside `updateWeekItemField` (writes to `projects` table directly). Neither calls the other function -- they use raw `db.update()`. No loop.

**Tests** (add to `src/lib/runway/operations-writes-week.test.ts`):
- "reverse cascades date change on deadline item to project.dueDate"
- "does not reverse cascade for non-deadline category"
- "does not reverse cascade when projectId is null"
- "does not reverse cascade for non-date field changes"

### 2C. Fix no-op channel posts

**Modify: `src/lib/slack/bot-tools.ts`**

In the `update_project_field` tool handler (line 256), guard the channel post:

```typescript
if (result.data) {
  const prev = result.data.previousValue as string;
  const next = result.data.newValue as string;
  if (prev !== next) {
    await safePostUpdate({ ... });
  }
}
```

Apply same guard to `update_project_status` and `update_week_item` handlers.

**Test:** Existing `bot-tools.test.ts` can add a case where previousValue === newValue and verify `safePostUpdate` is not called.

### 2D. Update bot prompt

**Modify: `src/lib/runway/bot-context-behaviors.ts`**

In `buildCapabilityBoundaries()`, update the `update_project_field` description:

```
- Update a project field (update_project_field) -- this ACTUALLY changes the database.
  When you update dueDate, linked deadline items on the calendar are also updated automatically.
```

### Phase 2 Checkpoint
- [ ] Forward cascade: `updateProjectField` with field=dueDate updates linked deadline week items
- [ ] Reverse cascade: `updateWeekItemField` with field=date on deadline items syncs to project.dueDate
- [ ] No-op updates do not post to the channel
- [ ] Bot prompt mentions deadline cascade
- [ ] `pnpm test:run`, `pnpm build`, `pnpm lint` all pass

---

## Phase 3: Structured Logging + Verification

**Goal:** Every tool call is visible in Vercel logs. Leslie's scenario works end-to-end.

### 3A. Structured logging in bot.ts

**Modify: `src/lib/slack/bot.ts`**

After `generateText` completes (line 191), replace the simple token log with structured logging:

```typescript
// Structured logging for observability
console.log(JSON.stringify({
  event: "runway_bot_request",
  user: displayName,
  slackUserId,
  isThread: !!threadTs,
  inputTokens: result.usage?.inputTokens,
  outputTokens: result.usage?.outputTokens,
  stepCount: result.steps.length,
}));

for (const step of result.steps) {
  for (const call of step.toolCalls) {
    console.log(JSON.stringify({
      event: "runway_bot_tool_call",
      tool: call.toolName,
      input: call.input,
    }));
  }
  if (step.toolResults) {
    for (const tr of step.toolResults) {
      console.log(JSON.stringify({
        event: "runway_bot_tool_result",
        tool: tr.toolName,
        result: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result),
      }));
    }
  }
}
```

Also log errors with structured format:

```typescript
console.error(JSON.stringify({
  event: "runway_bot_error",
  user: displayName,
  error: err instanceof Error ? err.message : String(err),
}));
```

**Note:** Check the actual AI SDK `step` type for `toolResults` property name -- the `handleProactiveFollowUp` function (line 85) types steps as `Array<{ toolCalls: Array<{ toolName: string; input: unknown }> }>`. The result type from `generateText` may have richer types. If `toolResults` isn't directly available on step, log after the full result returns by correlating `result.toolCalls` and `result.toolResults`.

**Test:** Non-breaking change (logging only). Verify existing tests still pass. Optionally spy on `console.log` to check JSON structure.

### 3B. Scenario verification -- Leslie's exact workflow

Run against prod DB to verify the full loop:

1. Query Bonterra projects and their linked deadline week items (verify links exist post-backfill)
2. Call `updateProjectField({ clientSlug: "bonterra", projectName: "Impact Report Dev", field: "dueDate", newValue: "2026-04-28" })`
3. Verify `projects.dueDate` = "2026-04-28"
4. Verify linked deadline week item's `date` = "2026-04-28" (cascade worked)
5. Call `getWeekItemsData()` and verify the calendar shows the updated date
6. Simulate no-op retry -- call same update again, verify no channel post would fire

Also verify reverse:
7. Call `updateWeekItemField` to change a deadline week item's date
8. Verify linked project's `dueDate` synced

### Phase 3 Checkpoint
- [ ] Structured JSON logs for every tool call (name, input, result)
- [ ] Request-level log includes user, tokens, step count
- [ ] Leslie's scenario traces end-to-end: dueDate → week items → board shows correct date
- [ ] Reverse cascade verified
- [ ] No-op channel post suppressed
- [ ] `pnpm test:run`, `pnpm build`, `pnpm lint` all pass

---

## Files to Modify

| File | Phase | Change |
|------|-------|--------|
| `scripts/backfill-week-item-links.ts` | 1A | New script, reuses `findProjectIdForWeekItem` |
| `src/lib/runway/operations-reads-week.ts` | 1B | Add `getLinkedDeadlineItems` |
| `src/lib/runway/operations-reads.ts` | 1B | Re-export |
| `src/lib/runway/operations.ts` | 1B | Re-export |
| `src/lib/runway/operations-reads.test.ts` | 1B | Tests for `getLinkedDeadlineItems` |
| `src/lib/runway/operations-writes-project.ts` | 2A | Add dueDate → week item cascade |
| `src/lib/runway/operations-writes-project.test.ts` | 2A | Cascade tests |
| `src/lib/runway/operations-writes-week.ts` | 2B | Add reverse cascade (deadline date → project dueDate) |
| `src/lib/runway/operations-writes-week.test.ts` | 2B | Reverse cascade tests |
| `src/lib/slack/bot-tools.ts` | 2C | Guard no-op channel posts |
| `src/lib/runway/bot-context-behaviors.ts` | 2D | Update prompt re: deadline cascade |
| `src/lib/slack/bot.ts` | 3A | Structured JSON logging |

## Dependencies

```
Phase 1A (backfill) ── run first, data prerequisite for cascade testing
Phase 1B (getLinkedDeadlineItems) ── Phase 2A depends on this
Phase 2A (forward cascade) ── can start once 1B is done
Phase 2B (reverse cascade) ── independent of 2A
Phase 2C (no-op fix) ── independent
Phase 2D (prompt update) ── independent
Phase 3A (logging) ── independent of all phases
Phase 3B (verification) ── depends on all of the above
```

## Risks

1. **Backfill mismatches:** `findProjectIdForWeekItem` fuzzy matching may link to wrong project. Mitigated by dry-run review.
2. **Multiple deadline items per project:** A project could have "code handoff" and "go live" both as deadline items. Cascade updates ALL -- if the deadline moves, all references should move. If this is wrong, we surface it during backfill review.
3. **Still-unlinked items:** Some deadline week items may not match any project even after backfill. These remain unchanged by cascade. The prompt should note this limitation.
