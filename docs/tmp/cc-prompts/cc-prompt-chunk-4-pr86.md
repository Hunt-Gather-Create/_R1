# CC Prompt — PR #86 Chunk 4: Schema Additions

## Mission

Add v4 convention columns to `projects`, `week_items`, and `updates` tables. Generate Drizzle migration. Push to Turso prod. This chunk fires FIRST in Wave 1 — downstream chunks depend on these columns existing.

**Safety preamble:**
> You are operating as a sub-agent on a production codebase. Before making any destructive change, deleting files, or modifying shared configuration, stop and confirm with the operator. Do not assume. Do not guess at intent. If something is ambiguous, surface it before acting.

**Efficiency preamble:**
> Work in focused, atomic steps. Complete one thing fully before moving to the next. Commit after each logical unit of work. Keep files under the line limit. Do not refactor things that weren't asked to be refactored. Stay in scope.

---

## Context

**Working directory:** `{WORKTREE_PATH_CHUNK_4}` (a worktree off `feature/runway-pr86-base`)
**Branch:** `feature/runway-pr86-chunk-4`
**Base branch:** `feature/runway-pr86-base` (5 commits ahead of `upstream/runway`)

Convention reference: `docs/tmp/runway-v4-convention.md` (locked). Read sections "L1 (project) fields," "L2 (week item) fields," "Client fields" before writing schema changes.

---

## Step 0 — Verify state

```bash
git branch --show-current            # expect feature/runway-pr86-chunk-4
git log --oneline feature/runway-pr86-base..HEAD   # expect empty (fresh branch)
git status                            # expect clean
cat src/lib/db/runway-schema.ts | grep -E "engagement_type|contract_start|blocked_by|triggered_by_update_id"
# expect no matches — these are what you're adding
```

If any check fails, STOP and report.

---

## Scope — strict

**IN:**
- Modify `src/lib/db/runway-schema.ts` — add columns per spec below
- Generate SQL migration via `pnpm runway:generate` (or equivalent; check CLAUDE.md)
- Run `pnpm runway:push` to apply to prod Turso
- Derivation logic: in `src/lib/runway/operations-writes-week.ts` (or closest appropriate file), recompute `project.start_date` and `project.end_date` from children on L2 write
- Backfill script: `scripts/runway-migrations/schema-backfill-v4-2026-04-21.ts` — populate `week_items.start_date` from existing `date` field; populate `project.start_date`/`end_date` via derivation
- Tests for derivation logic + schema
- Drizzle schema and `.sql` migration files must match exactly

**OUT (do NOT touch):**
- `src/lib/runway/operations-reads-*.ts` (Chunk 1)
- `src/lib/runway/flags-detectors.ts` (Chunk 1)
- `src/lib/runway/bot-tools.ts` (Chunk 2)
- UI files under `src/app/runway/components/` (Chunk 3)
- MCP server config files (Chunk 2)
- Anything under `scripts/runway-migrations/` OTHER than your one backfill script

**Never:** `git push`, `gh pr *`, `git reset --hard`, `git branch -D`.

---

## Column spec (v4)

### `projects` table — add columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `start_date` | text (ISO date) | yes | null | Derived from children, recomputed on L2 write |
| `end_date` | text (ISO date) | yes | null | Derived from children, recomputed on L2 write |
| `contract_start` | text (ISO date) | yes | null | Manual override for retainers |
| `contract_end` | text (ISO date) | yes | null | Manual override for retainers |
| `engagement_type` | text | yes | null | Enum at read layer: `project` / `retainer` / `break-fix` |

### `week_items` table — add columns

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `start_date` | text (ISO date) | yes (initially) | null | Backfilled from existing `date`. After backfill, treat as required. |
| `end_date` | text (ISO date) | yes | null | Null for single-day items |
| `blocked_by` | text (JSON array) | yes | null | JSON-encoded array of week_item ids, e.g., `["abc","def"]` |

### `updates` table — add column

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `triggered_by_update_id` | text | yes | null | FK to `updates.id` (no enforced constraint; nullable self-ref) |

---

## Derivation logic spec

After any write to a `week_items` row (create, update start_date/end_date, delete):
- Find the parent `projects.id` = `week_items.projectId`
- Query all non-deleted `week_items` where `projectId` = parent
- Compute:
  - `start_date` = MIN(children.start_date) (null-safe; if no children, null)
  - `end_date` = MAX(children.end_date OR children.start_date) (if end is null, treat start as single-day)
- If `projects.contract_start` set, leave projects.start_date as derived (contract_start is an override read at read layer, not stored override)
- Same for contract_end
- Update `projects` with computed start_date/end_date

Implementation: add `recomputeProjectDates(projectId)` helper. Call from `createWeekItem`, `updateWeekItem` (when date fields change), `deleteWeekItem`.

---

## Backfill spec

Script `scripts/runway-migrations/schema-backfill-v4-2026-04-21.ts` runs ONCE after schema push:

1. Read all `week_items`
2. For each row where `start_date IS NULL AND date IS NOT NULL`, set `start_date = date`
3. Read all `projects`
4. For each, compute derivation (per logic above) and set `start_date`, `end_date`
5. Leave `engagement_type`, `contract_start`, `contract_end`, `blocked_by` all null — migrations populate them per-client in Wave 1 data work

Run with the standard migration harness: `pnpm runway:migrate schema-backfill-v4-2026-04-21 --dry-run --target prod`. Verify diff. Then `--apply --target prod --yes`.

---

## Tests

- Unit test `recomputeProjectDates` with cases: no children, one child no end_date, multiple children with staggered dates, all children deleted
- Schema test: verify new columns exist in `runway-schema.test.ts` or add one
- Backfill smoke test: run against an in-memory snapshot of current prod shape, verify backfill populates expected fields

---

## Quality flow

```bash
pnpm test:run
pnpm build
pnpm lint
```

All three must be clean. Do NOT invoke `/code-review`, `/atomic-commits`, or `/pr-ready` — TP's QA agents handle those.

---

## Hard constraints

- NO `git push`, NO `gh pr *`.
- NO `git add -A` or `git add .`. Stage specific files:
  - `src/lib/db/runway-schema.ts`
  - Generated `.sql` migration file(s)
  - `src/lib/runway/operations-writes-week.ts` (for recomputeProjectDates)
  - Test files co-located with changes
  - `scripts/runway-migrations/schema-backfill-v4-2026-04-21.ts`
- Do NOT modify any file under OUT scope.
- If `pnpm runway:push` errors, STOP and report full error output.
- If the backfill dry-run shows changes outside expectation, STOP and report.
- Commit in logical atomic units (schema change, derivation logic + tests, backfill script). Not one giant commit.

---

## Output

On completion, report:
- Commits created (SHAs + messages)
- Files touched
- `pnpm test:run` summary (pass count, any skipped)
- `pnpm build` result
- `pnpm lint` result
- Migration push output
- Backfill apply output
- `git log --oneline -10` output
- Any ambiguous decisions and how you resolved them
