# Runway FK Deletion Pattern

When deleting a Runway entity that is referenced by foreign keys in other
tables, null out those references **inside the same transaction** before
deleting the target row.

This doc exists so future delete operations (e.g., `deleteClient`,
`deleteTeamMember`) follow the same shape as `deleteProject`.

## When it applies

Any delete operation on a Runway entity that has FK references from other
tables. Current examples of such references:

- `week_items.projectId` → `projects.id`
- `updates.projectId` → `projects.id`
- `updates.clientId` → `clients.id`
- `pipeline_items.clientId` → `clients.id`
- `projects.clientId` → `clients.id`

## Why null first, then delete

Runway's schema does not rely on `ON DELETE CASCADE`. Instead we null out
FK references explicitly so that:

1. Audit history is preserved. `updates` rows that referenced the deleted
   entity keep their `summary`, `previousValue`, `updatedBy`, and sibling
   FK (e.g., `clientId` stays on audit rows after the project is deleted).
2. Deletes are safe even when rows in sibling tables point to the target.
3. The intent is explicit in code — readers see exactly which tables hold
   references.

Doing the unlink + delete inside a single transaction keeps the operation
atomic: either all FKs are nulled and the row is deleted, or nothing
changes.

## The pattern

```ts
await db.transaction(async (tx) => {
  // 1. Null out each FK reference from sibling tables
  await tx
    .update(weekItems)
    .set({ projectId: null, updatedAt: new Date() })
    .where(eq(weekItems.projectId, project.id));

  await tx
    .update(updates)
    .set({ projectId: null })
    .where(eq(updates.projectId, project.id));

  // 2. Delete the target row last
  await tx.delete(projects).where(eq(projects.id, project.id));
});
```

Audit record for the delete itself should be inserted **before** the
transaction (see `deleteProject` in `src/lib/runway/operations-writes-project.ts`),
so the audit row survives even if the transaction rolls back — it records
the attempt.

## Files currently applying this pattern

- `src/lib/runway/operations-writes-project.ts` → `deleteProject`

## Future operations

Apply the same shape to any new delete operation. Likely candidates:

- `deleteClient` — will need to null/delete related `projects`, `pipeline_items`,
  and audit references in `updates`
- `deleteTeamMember` — will need to null out any owner/resource string
  references (currently stored as free text, but check for FK refs if the
  schema changes)
- `deletePipelineItem` — check which audit/sibling tables reference
  `pipeline_items.id` at implementation time and null those first
