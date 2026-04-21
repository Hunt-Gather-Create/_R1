# CC Prompt — PR #86 Chunk 1: Query Layer Foundation

## Mission

Fix the query layer so plate/flag/bottleneck queries respect v4 conventions: exclude completed items, bucket by date, filter stub L2s, match L1 on owner-only. This chunk is consumer-impacting — Chunk 2 (bot) and Chunk 3 (UI) both depend on the interface contracts produced here.

**Safety preamble:**
> You are operating as a sub-agent on a production codebase. Before making any destructive change, deleting files, or modifying shared configuration, stop and confirm with the operator. Do not assume. Do not guess at intent. If something is ambiguous, surface it before acting.

**Efficiency preamble:**
> Work in focused, atomic steps. Complete one thing fully before moving to the next. Commit after each logical unit of work. Do not refactor things that weren't asked to be refactored. Stay in scope.

---

## Context

**Working directory:** `{WORKTREE_PATH_CHUNK_1}` (off `feature/runway-pr86-base` AFTER Chunk 4 merges to base)
**Branch:** `feature/runway-pr86-chunk-1`
**Base:** `feature/runway-pr86-base` (which will include Chunk 4 schema by the time you run)

Convention reference: `docs/tmp/runway-v4-convention.md`, especially "Convention-driven behaviors" §1-4.

---

## Step 0 — Verify state

```bash
git branch --show-current
git log --oneline feature/runway-pr86-base..HEAD   # expect empty
git log --oneline -5 feature/runway-pr86-base       # should include Chunk 4 schema commits
grep -l "engagement_type\|start_date\|blocked_by" src/lib/db/runway-schema.ts
# should match — confirms Chunk 4 schema landed on base
grep -l "linkWeekItemToProject" src/lib/runway/   # should match — helper from cherry-pick
```

If any check fails, STOP and report.

---

## Scope — strict

**IN (fix list):**

1. `src/app/runway/queries.ts:getStaleWeekItems` — skip `status='completed'` items
2. `src/lib/runway/flags-detectors.ts:detectStaleItems` — skip `status IN ('completed', 'on-hold')`
3. `src/lib/runway/flags-detectors.ts:detectResourceConflicts` + `detectBottlenecks` — audit for status-ignore pattern; apply same filter
4. `detectBottlenecks` refinement — count only active L2s (exclude completed, blocked, and stubs where parent L1.status = 'awaiting-client')
5. `src/lib/runway/operations-reads-week.ts:getPersonWorkload` — status filter (default exclude completed)
6. `getPersonWorkload` — date-bucket into `overdue / thisWeek / nextWeek / later`
7. `getPersonWorkload` — L1 match on `owner` only (not resources); separate `ownedProjects` from `weekItems` in response shape per contract below
8. `getPersonWorkload` — stub filter: exclude L2s where parent L1.status = 'awaiting-client' from active buckets

**Tests for each of the above.**

**OUT (do NOT touch):**
- Schema / migrations (Chunk 4, already on base)
- Bot tools (`src/lib/runway/bot-tools.ts`, Chunk 2)
- MCP server (Chunk 2)
- UI components (`src/app/runway/components/`, Chunk 3)
- Any `scripts/runway-migrations/` files (data work)

**Never:** `git push`, `gh pr *`, destructive git.

---

## Interface contract — `getPersonWorkload` return shape

Produce this exact shape. Consumed by Chunks 2 and 3.

```ts
export type PersonWorkload = {
  person: string;
  ownedProjects: {
    inProgress: Project[];     // L1s person owns with any active L2s; excludes awaiting-client
    awaitingClient: Project[];
    blocked: Project[];
    onHold: Project[];
    completed: Project[];      // opt-in only via includeCompleted flag; default omit
  };
  weekItems: {
    overdue: WeekItem[];       // end_date (or start_date if end null) < today AND status != 'completed'
    thisWeek: WeekItem[];      // start_date within current Mon–Sun inclusive
    nextWeek: WeekItem[];      // start_date within next Mon–Sun inclusive
    later: WeekItem[];         // start_date beyond next week
  };
  flags: {
    contractExpired: Client[]; // soft flag; clients.contract_status='expired' AND owned L1 still active
    retainerRenewalDue: Project[]; // engagement_type='retainer' AND contract_end within 30 days
  };
  totalProjects: number;
  totalActiveWeekItems: number;
};
```

**Timezone rule:** treat all dates as America/Chicago (agency local). "Today" = local midnight boundary.

**Sort within buckets:** ASC by start_date then by existing sortOrder field.

**Stub filter:** a week_item's parent L1 has `status='awaiting-client'` → exclude from `weekItems.*` buckets. Still visible via L1 drill-down.

**`end_date=null` semantics:** for bucketing, treat null end_date as same as start_date (single-day item).

---

## Tests — minimum coverage

- `getPersonWorkload` — empty result shape, all 4 date buckets populate correctly, stub filter works, L1 owner-only match, contractExpired flag fires on joined client state, retainerRenewalDue fires within 30 days
- `getStaleWeekItems` — completed items excluded
- `detectStaleItems` — completed/on-hold excluded
- `detectBottlenecks` — stub L2s excluded
- `detectResourceConflicts` — completed L2s excluded

---

## Quality flow

```bash
pnpm test:run
pnpm build
pnpm lint
```

All clean. NO `/code-review`, `/atomic-commits`, `/pr-ready` — TP's QA agents handle those.

---

## Hard constraints

- NO `git push`, NO `gh pr *`.
- NO `git add -A` / `git add .`. Stage touched files only.
- Do NOT modify files outside IN scope.
- Do NOT modify the return shape away from the interface contract — Chunks 2 and 3 depend on exact types.
- Atomic commits: one logical change per commit. E.g., "fix: skip completed items in getStaleWeekItems" and "feat: add date bucketing to getPersonWorkload" are separate commits.

---

## Output

On completion:
- Commits created (SHAs + messages)
- Files touched
- `pnpm test:run` summary (new test count, coverage on getPersonWorkload)
- `pnpm build` result
- `pnpm lint` result
- Any ambiguity you resolved (e.g., how to handle a null start_date mid-migration state)
- `git log --oneline` of your branch
