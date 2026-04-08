# CC Prompt: Status Cascade — Project ↔ Week Item Linking

## Context

You are on branch `feature/runway-bot-context` in the Runway project. Runway is a triage board for Civilization Agency. This prompt links week items to their parent projects and adds AI-assisted status cascade — when a project status changes, the bot intelligently decides whether linked week items should also update.

**Read these files before starting:** `docs/brain/brain-RULES.md`, `docs/ai-development-workflow.md`

**Branch:** `feature/runway-bot-context` (do NOT create a new branch)

**Tests:** Write tests alongside each step, not at the end. Run `pnpm test:run` after each step.

---

## Step 1: Link week items to projects in seed script

**File:** `scripts/seed-runway.ts`

The `weekItems` table already has a `projectId` FK column but it's never populated. After inserting projects (step 2 of the seed), build a lookup map of `clientId + projectName → projectId`. Then when inserting week items, fuzzy-match each week item's title against the client's projects to populate `projectId`.

Fuzzy matching rules:
- Normalize both strings: lowercase, trim
- A week item title like "CDS Messaging & Pillars R1 (Gate for all CDS content)" should match project "CDS Messaging & Pillars R1" — check if the project name is a prefix of (or contained in) the week item title
- A week item like "Bonterra — Paige presenting designs" should match project "Impact Report — Design" only if the notes or title contain a clear reference — when in doubt, leave `projectId` null
- Some week items are standalone tasks (e.g., "TAP Travel Invoice") that may not have a parent project — `projectId` stays null for these
- Log how many week items were linked vs unlinked so we can verify

Create a helper function `findProjectIdForWeekItem(clientId: string, title: string, projectMap: Map<string, {id: string, name: string}[]>): string | null` that encapsulates the matching logic. Put it in the seed script (not in the operations layer — this is seed-time only).

**Test:** After seeding, query week items and verify that items with obvious project parents have `projectId` set. Add a test in `scripts/seed-runway.test.ts` (or inline verification in the seed script output).

---

## Step 2: Add `get_linked_week_items` helper to operations

**File:** `src/lib/runway/operations-reads-week.ts` (or new file `operations-cascade.ts` if cleaner)

Add a function:
```ts
export async function getLinkedWeekItems(projectId: string): Promise<WeekItemRow[]> {
  const db = getRunwayDb();
  return db.select().from(weekItems).where(eq(weekItems.projectId, projectId));
}
```

Where `WeekItemRow` is the inferred select type from the schema.

Export through `operations.ts` barrel.

**Test:** `operations-cascade.test.ts` — verify it returns items for a known projectId and empty array for unknown.

---

## Step 3: Add cascade logic to `updateProjectStatus`

**File:** `src/lib/runway/operations-writes.ts`

After the project status update succeeds (line 79-82 currently), add cascade logic:

```ts
// Cascade to linked week items
const linkedItems = await getLinkedWeekItems(project.id);
const cascadedItems: string[] = [];

for (const item of linkedItems) {
  // Only cascade if it makes sense:
  // - Don't un-complete items (if week item is already "completed", leave it)
  // - Don't override items that have progressed further than the project
  // - DO cascade: completed, blocked, on-hold (terminal/blocking states)
  const shouldCascade = 
    newStatus === "completed" || 
    newStatus === "blocked" || 
    newStatus === "on-hold";
  
  const itemAlreadyTerminal = 
    item.status === "completed" || 
    item.status === "canceled";

  if (shouldCascade && !itemAlreadyTerminal) {
    await db.update(weekItems)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(weekItems.id, item.id));
    cascadedItems.push(item.title);
  }
}
```

Add `cascadedItems` to the return data:
```ts
return {
  ok: true,
  message: `Updated ${client.name} / ${project.name}: ${previousStatus} -> ${newStatus}`,
  data: {
    clientName: client.name,
    projectName: project.name,
    previousStatus,
    newStatus,
    cascadedItems, // string[] of week item titles that were also updated
  },
};
```

Import `weekItems` from the schema and `getLinkedWeekItems` from operations.

**Test:** In `operations-writes.test.ts` (or `operations-cascade.test.ts`):
- Status change to "completed" cascades to linked non-completed week items
- Status change to "completed" does NOT un-complete already-completed items
- Status change to "in-production" does NOT cascade (non-terminal status)
- Status change to "blocked" cascades to linked active items
- Week items without `projectId` are never affected

---

## Step 4: Update bot tool to surface cascade info

**File:** `src/lib/slack/bot-tools.ts`

In the `update_project_status` tool execute function, update the return to include cascade info when present:

```ts
const cascaded = result.data?.cascadedItems as string[] | undefined;
const cascadeNote = cascaded?.length 
  ? ` Also updated ${cascaded.length} linked week item(s): ${cascaded.join(", ")}.`
  : "";

return { result: result.message + cascadeNote };
```

Also update the updates channel post to mention cascaded items if any:

```ts
const updateText = `${result.data.previousStatus} -> ${result.data.newStatus}${notes ? ` (${notes})` : ""}${cascaded?.length ? ` [+${cascaded.length} week items]` : ""}`;
```

**Test:** Verify the bot tool returns cascade info in its response text.

---

## Step 5: Add cascade info to bot system prompt

**File:** `src/lib/runway/bot-context-sections.ts`

In `buildQueryRecipes()`, add a note under the status update section:

```
### Status cascade behavior
When you update a project status to completed, blocked, or on-hold, linked week items 
automatically cascade. The response will tell you which items were updated. 
Non-terminal status changes (in-production, awaiting-client) do NOT cascade — 
week items may be at different stages than the project overall.
If you're unsure whether to cascade, tell the user what would happen and ask.
```

**Test:** Update `bot-context-sections.test.ts` to verify the new section exists.

---

## Step 6: Re-seed and verify

Run `pnpm runway:seed` and verify:
1. The seed output shows how many week items were linked to projects
2. Query the DB to confirm `projectId` is populated on appropriate week items
3. Run `pnpm test:run` — all tests pass
4. Manual spot check: pick a Convergix project with known week items and verify the link

---

## Cascade rules summary

| New Project Status | Cascades to Week Items? | Condition |
|---|---|---|
| completed | Yes | Unless item is already completed/canceled |
| blocked | Yes | Unless item is already completed/canceled |
| on-hold | Yes | Unless item is already completed/canceled |
| in-production | No | Week items may be at different stages |
| awaiting-client | No | Some items may still be in production |
| not-started | No | Would regress items that already started |

The bot sees the cascade results in its tool response and can communicate what happened to the user naturally. If the user says "mark Bonterra Impact Report as completed," the bot does it and says "Done. Also marked 3 linked week items as completed: Paige presenting designs, Impact Report design presentation, ..."
