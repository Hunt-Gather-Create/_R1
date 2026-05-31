# CASCADE_STATUSES bug: silent invalid-enum writes to L2 on L1 status cascade

**Operator brief 2026-05-13T03:15Z.** Discovered during Convergix Thread #15 (Rockwell notes) drafter dispatch: setting an L1 project status to `on-hold` cascades that exact string to all linked L2 weekItems via `tx.update` — bypassing validators — but `on-hold` is not a valid L2 status enum value. Silent garbage in prod.

This ticket is for R1 TP to fix the underlying code so future L1 status flips don't write invalid enums to L2s.

---

## Repro

```ts
// Currently in src/lib/runway/operations-writes.ts
import { updateProjectStatus } from "@/lib/runway/operations-writes";

// L1 has linked L2s
await updateProjectStatus({
  projectId: "1923fc1a36524a9c810a73763",  // Rockwell Co-Marketing L1
  newStatus: "on-hold",                     // L1 enum value
  updatedBy: "test",
});

// → cascade fires (on-hold ∈ CASCADE_STATUSES)
// → raw tx.update writes weekItems.status = "on-hold" for every linked L2
// → "on-hold" is NOT in WEEK_ITEM_STATUSES enum
// → no validator catches it
// → prod silently has invalid L2 status values
```

---

## Root-cause citations (verified via grep 2026-05-13)

| Location | What it does |
|---|---|
| `src/lib/runway/operations-utils.ts:28` | `CASCADE_STATUSES = ["completed", "blocked", "on-hold"]` — declares which L1 statuses trigger cascade. |
| `src/lib/runway/operations-writes.ts:14` | imports `CASCADE_STATUSES`. |
| `src/lib/runway/operations-writes.ts:107` | `shouldCascade = CASCADE_STATUSES.includes(newStatus)` — gate check. |
| `src/lib/runway/operations-writes.ts:115-128` | cascade body: `tx.update(weekItems).set({ status: newStatus, ... })` — raw write, no validator. |
| `src/lib/runway/operations-utils.ts:929-936` | `WEEK_ITEM_STATUSES = ["scheduled", "in-progress", "blocked", "at-risk", "completed", "canceled"]` — L2 enum. Does NOT include `on-hold`. |
| `src/lib/runway/operations-utils.ts:1019-1026` | `L1_PROJECT_STATUSES` (informal — also missing `canceled`; tracked in companion plan `l1-canceled-status-fix.md`). |

**Enum overlap analysis:**

| L1 status (CASCADE_STATUSES member) | Valid L2 enum? | Outcome on cascade |
|---|---|---|
| `completed` | Yes | Works correctly |
| `blocked` | Yes | Works correctly |
| `on-hold` | **No** | **Silent garbage write** |

So only `on-hold` is currently broken — but the architecture invites future breakage every time enums drift.

---

## Why this matters

- Any operator action that sets L1.status=on-hold writes invalid `on-hold` to every linked L2's status field.
- The L2 dashboard, Gantt, By Account tier, Slack publish, and any audit-log consumer will render the invalid string.
- Worse: if a future L1 enum addition (e.g., a hypothetical `paused`) gets added to CASCADE_STATUSES without a matching L2 enum entry, the same silent-garbage pattern repeats.
- The runway data-integrity batches tonight (5/12 PM) tripped this on Convergix #15 and had to drop the L1.status flip from the migration; the audit row went from 4 to 3 because we could not safely write the operator-intended state.

---

## Proposed fix (recco: combine 1 + 2)

### Fix 1 — validate cascade target enum (minimum-viable safety)

Inside the cascade body in `operations-writes.ts:115-128`, before the raw `tx.update`, check that `newStatus` is a member of `WEEK_ITEM_STATUSES`. If not, throw a typed error so callers know to handle the case (instead of silently writing garbage).

```ts
if (shouldCascade) {
  if (!WEEK_ITEM_STATUSES.includes(newStatus as WeekItemStatus)) {
    throw new Error(
      `CASCADE_STATUSES violation: L1 status "${newStatus}" cascades but is not a valid L2 status enum value. Add L1→L2 mapping (see Fix 2) or remove from CASCADE_STATUSES.`
    );
  }
  await tx.update(weekItems).set({ status: newStatus, ... });
}
```

This converts a silent corruption into a loud failure. Migrations and callers can then either:
- Avoid setting L1 status to the invalid value, or
- Use the new mapping (Fix 2).

### Fix 2 — explicit L1→L2 status mapping for cascade

Add a `CASCADE_STATUS_MAP` constant in `operations-utils.ts` that defines, for each L1 status in CASCADE_STATUSES, the corresponding L2 status to write during cascade. Default mapping:

```ts
export const CASCADE_STATUS_MAP: Record<string, WeekItemStatus> = {
  "completed": "completed",
  "blocked": "blocked",
  "on-hold": "blocked",   // L2 has no on-hold; blocked is the closest semantic match
};
```

Inside `operations-writes.ts:115-128`, change the cascade write to use the mapped value:

```ts
if (shouldCascade) {
  const cascadedStatus = CASCADE_STATUS_MAP[newStatus];
  if (!cascadedStatus) {
    throw new Error(/* same as Fix 1 */);
  }
  await tx.update(weekItems).set({ status: cascadedStatus, ... });
}
```

This makes the cascade safe by default AND preserves the operator-intended cascade behavior (L1 on-hold → L2 blocked, which is what we want).

### Fix 3 (optional) — skipCascade param for opt-out

Add `skipCascade?: boolean` param to `updateProjectStatus`. Migration scripts that want to explicitly avoid cascade (e.g., the Convergix #15 PATH A pattern) can opt out without restructuring around the helper.

```ts
await updateProjectStatus({
  projectId: "...",
  newStatus: "on-hold",
  skipCascade: true,  // I'll handle L2 status writes myself
  updatedBy: "...",
});
```

This is a quality-of-life addition; Fix 1+2 already make the cascade safe by default.

---

## Suggested branch + worktree

Branch off upstream `runway`:

```bash
cd /Users/jasonburks/Documents/_AI_/_R1
scripts/worktree cascade-statuses-fix
# → .worktrees/cascade-statuses-fix/ with branch feature/cascade-statuses-fix
```

The worktree script installs deps + runs migrations + launches Claude.

---

## Implementation checklist

1. **`src/lib/runway/operations-utils.ts`**
   - Add `CASCADE_STATUS_MAP` constant (Fix 2).
   - Export from utils.

2. **`src/lib/runway/operations-writes.ts`**
   - Import `CASCADE_STATUS_MAP` + `WEEK_ITEM_STATUSES`.
   - Replace direct `newStatus` cascade write with `CASCADE_STATUS_MAP[newStatus]` lookup.
   - Add validator throw if mapping missing.
   - Add `skipCascade?: boolean` param to `updateProjectStatus` signature (Fix 3) — when true, skip the cascade block entirely.

3. **`src/lib/runway/operations-writes.test.ts`** (co-located test file — create if not present)
   - Test: L1 on-hold cascade writes `blocked` to all linked L2s (not `on-hold`).
   - Test: L1 completed cascade writes `completed` to L2s.
   - Test: L1 blocked cascade writes `blocked` to L2s.
   - Test: `skipCascade: true` does not modify any L2.
   - Test: invalid `newStatus` (not in CASCADE_STATUS_MAP and in CASCADE_STATUSES) throws typed error.

4. **Docs sync** (`docs/runway/` if mapping doc exists)
   - Add note on cascade behavior + mapping table.

5. **Migration audit (read-only sweep)**
   - Grep `scripts/runway-migrations/` for existing calls to `updateProjectStatus` with `newStatus="on-hold"`. None should exist post-fix; any that do need the new behavior validated (or use `skipCascade`).

---

## Post-build pipeline (per CLAUDE.md)

Run in order before pushing:

1. `/code-review` — DRY, prop drilling, hooks/context, test coverage
2. `/update-docs` — sync `/docs` knowledge base
3. `/pr-ready` — debug statements, unused imports, final cleanup
4. `/preflight` — build + grep gate + tests + lint (incl. `vercel build` on runway-tracked branches)
5. `/canary` — cross-fork Vercel preview deploy
6. `/atomic-commits` — split working tree into focused commits

Then push to `jasonburks23/_R1` fork → open PR to `Hunt-Gather-Create/_R1:runway`.

---

## PR title + summary

**Title:** `fix(runway): cascade-statuses writes correct L2 enum via mapping (was silently writing invalid on-hold)`

**Summary:**
- `updateProjectStatus` cascade was writing the raw L1 status value to linked L2s via `tx.update` with no validator. L1 enum "on-hold" is NOT a valid L2 status — produces silent invalid data.
- Introduce `CASCADE_STATUS_MAP` defining the L1→L2 mapping for cascade writes (on-hold → blocked, completed → completed, blocked → blocked).
- Add typed-error validator inside cascade body so any future CASCADE_STATUSES additions without a matching mapping fail loudly instead of silently.
- Add `skipCascade?: boolean` param to `updateProjectStatus` so migration scripts can opt out when they want to handle L2 status writes explicitly.
- Tests cover all cascade paths + skipCascade behavior + the missing-mapping throw.

**Test plan:**
- `pnpm test:run src/lib/runway/operations-writes.test.ts`
- `pnpm lint`
- `pnpm build`
- Manual: in a non-prod worktree, run a script that sets L1.status="on-hold" on a test L1 with linked L2s; verify L2.status="blocked" lands.
- Canary deploy + smoke-check Gantt + By Account tabs for any cascade-related render.

---

## Companion ticket reference

There's a related-but-distinct plan at `docs/plans/l1-canceled-status-fix.md` covering L1 enum gap (missing `canceled`). The two fixes touch the same domain (L1 status semantics) but address different issues:

| | `l1-canceled-status-fix` | `cascade-statuses-fix` (this) |
|---|---|---|
| Concern | Enum membership (L1 lacks `canceled`) | Write-path behavior (cascade writes invalid enum to L2) |
| File primary | `operations-utils.ts` (enum) + views | `operations-writes.ts` (cascade body) |
| L2 impact | None | Direct (cascade target) |

Sequence: either ticket can land first; they don't depend on each other. If you take both in one PR for batching, that's also fine — same general area + reviewers + post-build pipeline.

---

## Background context

Discovered 2026-05-13 during Convergix #15 (Rockwell notes) drafter dispatch. Earlier in the same session, LPPC-1 Panel 5 had verified CASCADE_STATUSES "unused in write path" — that verification was scoped too narrowly (writes-week.ts + writes-project.ts only) and missed `operations-writes.ts:107` where the constant IS live. Confirmed via wider grep at the Convergix #15 drafter's Phase 0c guard.

Per `feedback_l1_vs_l2_status_enums.md` (auto-memory): "L1 status enum ≠ L2 status enum. updateProjectStatus has NO validator — writes garbage silently." The cascade discovered tonight is the same class of bug, manifesting in the parent→child write path. This fix closes that gap.
