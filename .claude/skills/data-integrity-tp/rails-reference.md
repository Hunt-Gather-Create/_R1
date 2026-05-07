# Rails Reference — Runway Helpers and Validators

Load this when running the pre-APPLY rails compliance check, or when reviewing a drafter's batch plan.

All file paths are relative to the data-tp-runway worktree: `.worktrees/data-tp-runway/`.

## Schema Reality (`src/lib/db/runway-schema.ts`)

Most fields are nullable. Convention enforcement lives in code rails plus caller discipline, not DB constraints.

- `clients`: notNull on `id`, `name`, `slug` (unique). `nicknames` is a JSON array of strings.
- `projects`: notNull on `id`, `clientId`, `name`. Every other field nullable: status, category, owner, dueDate, startDate, endDate, contractStart, contractEnd, engagementType, parentProjectId, notes. No FK on parentProjectId (self-ref, no DB enforcement).
- `weekItems`: notNull on `id`, `title`. Everything else nullable: projectId, clientId, dayOfWeek, weekOf, date, startDate, endDate, blockedBy, status, category, owner, resources, notes. One DB index: `idx_week_items_week_of` on `weekOf`.
- `pipelineItems`: notNull on `id`, `name`. Other fields nullable.
- `updates` (audit table): notNull on `id`, `createdAt`. `idempotencyKey` unique. `batchId` nullable. `triggeredByUpdateId` nullable self-ref.
- `teamMembers`: notNull on `id`, `name`. `roleCategory` valid values include "leadership", "am", "creative", "dev", "community", "contractor".

## Field Whitelists (`src/lib/runway/operations-utils.ts`)

### PROJECT_FIELDS (12 fields, lines 323-332)

Writeable via `updateProjectField`:

```
name, dueDate, owner, resources, waitingOn, notes, category,
engagementType, contractStart, contractEnd,
parentProjectId
```

NOT writeable via `updateProjectField`:
- `status` — uses `updateProjectStatus` separately (cascades to weekItems)
- `startDate`, `endDate` — derived from children. Direct write only via `overrideProjectDate` (has wrapper guard).

### WEEK_ITEM_FIELDS (12 fields, lines 358-362)

Writeable via `updateWeekItemField`:

```
title, status, date, dayOfWeek, weekOf, owner, resources, notes, category,
startDate, endDate, blockedBy
```

### PIPELINE_ITEM_FIELDS (6 fields)

```
name, owner, status, estimatedValue, waitingOn, notes
```

### CLIENT_FIELDS (7 fields)

```
name, team, contractValue, contractTerm, contractStatus, clientContacts, nicknames
```

### TEAM_MEMBER_FIELDS (8 fields)

```
title, fullName, slackUserId, roleCategory, accountsLed, isActive, nicknames, channelPurpose
```

## Enum Validators (operations-utils.ts lines 842-983)

Schema comments may be stale. The validator is ground truth.

| Validator | Allowed values | Notes |
|---|---|---|
| `validateEngagementType` | `["retainer", "project"]` | Schema comment lists "break-fix" but validator rejects it. `""` accepted as clear (becomes null). |
| `validateWeekItemStatus` | `["scheduled", "in-progress", "blocked", "at-risk", "completed", "canceled"]` | NULL also accepted, treated as `scheduled`. |
| `validateWeekItemCategory` | `["delivery", "review", "kickoff", "deadline", "approval", "launch"]` | No `active`/`on-hold` (those are project-category values, not weekItem). |
| `validateIsoDateShape` | YYYY-MM-DD with regex + Date parse + roundtrip equality | Used on contractStart, contractEnd, date, startDate, endDate. `""` accepted as clear. |

**No validator on `project.status`** — `updateProjectStatus` accepts any string. Only `CASCADE_STATUSES = ["completed", "blocked", "on-hold"]` trigger weekItem cascade.

**No validator on `project.category`** — `updateProjectField` for category is whitelisted but not value-validated.

## Recompute Behavior (`operations-writes-week.ts:71-154`)

`recomputeProjectDatesWith` is called automatically on any L2 date change.

### Wrapper guard (lines 87-109)

If `project.engagementType="retainer"` AND has at least one child project (`projects.parentProjectId = this.id`):
- Wrapper's `startDate` and `endDate` are PINNED to existing values, NOT recomputed from L2 widths.
- A wrapper with currently-null dates STAYS null forever via this path.
- Only way to set wrapper dates: `overrideProjectDate({field, bypassGuard: true})`.

### Derivation rule (lines 120-134)

For non-wrapper projects:
- `startDate = MIN(child.startDate ?? child.date)`
- `endDate = MAX(child.endDate ?? child.startDate ?? child.date)` — single-day items use start as end.

### Recompute fires on

- `createWeekItem` (atomic with insert)
- `deleteWeekItem` (atomic with delete)
- `updateWeekItemField` when field is `date`, `startDate`, or `endDate`
- `linkWeekItemToProject` (both old and new parents)

### Recompute does NOT fire on

- `updateProjectField` (any field on project)
- `overrideProjectDate` (direct project date writes)
- `updateProjectStatus`

## Reverse Cascade Trap (`operations-writes-week.ts:416-452`)

Trigger: `field === "date"` AND `category === "deadline"` AND `projectId set`.

Effect: writes `projects.dueDate = newValue` in the same transaction.

**Implication**: any write that changes both `date` AND `category` on a deadline-category L2 must flip category in an EARLIER helper call than date. Otherwise the date write fires reverse cascade and overwrites the parent's dueDate.

Yesterday's HDL batch did this correctly: Production Shoot category flipped `deadline -> delivery` at audit timestamp 05:12:26 before its date change at 05:12:27.

## Forward Cascade — dueDate (`operations-writes-project.ts:260-276`)

`updateProjectField({field: "dueDate"})` cascades to all linked deadline weekItems, writing `date = newValue` on each. Audits children via `triggeredByUpdateId`.

## Wrapper Guard on `overrideProjectDate` (`operations-writes-project.ts:415-426`)

Refuses retainer wrapper writes without `bypassGuard: true`. Wrapper definition: `engagementType="retainer"` AND has children projects pointing at it via `parentProjectId`.

## parentProjectId Validators (`operations-utils.ts:1021-1076`)

Four invariants enforced for any write that sets `parent_project_id`:

1. Parent must exist (non-null case).
2. `parent.engagementType === "retainer"`.
3. `parent.clientId === child.clientId` (no cross-client parenting).
4. No cycle (10-hop walk).

Both `set_project_parent` MCP tool and `updateProjectField({field: "parentProjectId"})` route through this validator. No bypass.

## Idempotency Mechanics

`generateIdempotencyKey` is SHA-256 over joined parts, truncated to 40 hex chars.

| Operation | Key composition |
|---|---|
| Field change | `("field-change", rowId, field, newValue, updatedBy)` |
| Week field change | `("week-field-change", itemId, field, newValue, updatedBy)` |
| Status change | `("status-change", projectId, newValue, updatedBy)` |
| Date override | `("date-override", projectId, field, prevValue, newValue, updatedBy)` — 6 parts handle revert+retry |
| Create week item | `("create-week-item", clientId, title, weekOf, updatedBy)` |
| Delete week item | `("delete-week-item", itemId, updatedBy)` |
| Cascade status | `("cascade-status", parentAuditId, itemId, newValue)` |
| Cascade duedate | `("cascade-duedate", parentAuditId, itemId, newValue)` |

For null writes: `idemNewValue = "(null)"` so repeat null writes collapse.

**Revert + retry rule**: helpers do NOT delete audit rows on revert (they preserve with projectId nulled). So retry after revert always needs a different `updatedBy`, otherwise the hash collides and the write silently skips.

## Resources Normalization (`operations-utils.ts:780-788`)

`normalizeResourcesString`:
- Converts `→ => >>` to canonical `->`
- Trims, splits on comma, filters empty, rejoins with `, ` separator
- Does NOT dedupe

Format convention: `Role: Person, Role: Person -> Role: Person`. Concurrent collaborators at same handoff position use comma. Sequential handoff uses `->`.

Roles in use: AM, CD, Dev, CW, PM, CM, Strat. Plus contractor labels like `Vendor: Name`.

## contractStart/End Cross-field Invariant (`operations-writes-project.ts:196-215`)

`contractStart < contractEnd` (strict less-than). One side null skips the check. Helper rejects equal or inverted values.

## Twelve-point Pre-APPLY Rails Compliance Checklist

Before dispatching holdout panels, grep-verify each of these against the drafted triplet:

1. **Field whitelist**: every `field:` in the batch is in PROJECT_FIELDS or WEEK_ITEM_FIELDS. Anything outside requires `overrideProjectDate` (date fields only) or raw drizzle with manual `insertAuditRecord`.
2. **Enum compliance**: every status, category, engagementType value is in the validator enum.
3. **Wrapper handling**: any retainer wrapper date write uses `overrideProjectDate({bypassGuard: true})`. Wrapper dates do not auto-populate from L2 widths.
4. **Category-first ordering**: any L2 where the batch changes both category AND date and current category is `deadline` flips category in an earlier helper call than date.
5. **Paired startDate**: any `date` write on an L2 is paired with a `startDate` write to defuse recompute preference (recompute prefers `startDate ?? date`).
6. **dayOfWeek consistency**: `date` writes are paired with `dayOfWeek` writes computed from the new date.
7. **weekOf invariant**: if `date` crosses a Monday boundary, `weekOf` follows. Use `getMonday` logic (not exported, drafter computes inline).
8. **Reverse-cascade collateral**: any `date` write on a deadline-category L2 will overwrite `projects.dueDate`. Plan acknowledges or avoids.
9. **Batch hygiene**: unique `batchId`, unique `updatedBy`, `set_batch_mode` wrap. `updatedBy` bumped if this is a re-attempt after a prior REVERT.
10. **Audit-row math**: count by helper call. Each `updateWeekItemField` = 1 audit row. Each `updateProjectField({field:"dueDate"})` may trigger 1 + N for cascade. Each `createWeekItem` = 1. Each `overrideProjectDate` = 1. Each `updateProjectStatus` = 1 + cascade. Documented count must match DRY_RUN output count.
11. **contractStart/End invariant**: `contractStart < contractEnd` (strict) where both set.
12. **Resources normalization**: corrections pass `normalizeResourcesString` shape. Empty string clears.

Any check failing means the batch goes back to the drafter before holdout panels fire.
