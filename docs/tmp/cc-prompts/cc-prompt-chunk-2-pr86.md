# CC Prompt — PR #86 Chunk 2: Bot Tool / Response Layer

## Mission

Upgrade the Slack bot's tools and response layer for v4 convention: resource-inclusive week item matching, drill-down tools, resources parser (comma + arrow), cascade-on-all-categories, triggeredByUpdateId audit propagation, and smart plate framing in the bot prompt. Depends on Chunk 1's `getPersonWorkload` contract.

**Safety preamble:**
> You are operating as a sub-agent on a production codebase. Before making any destructive change, deleting files, or modifying shared configuration, stop and confirm with the operator. Do not assume. Do not guess at intent. If something is ambiguous, surface it before acting.

**Efficiency preamble:**
> Work in focused, atomic steps. Stay in scope. Do not refactor unasked.

---

## Context

**Working directory:** `{WORKTREE_PATH_CHUNK_2}` (off `feature/runway-pr86-wave1`, after Wave 1 integration)
**Branch:** `feature/runway-pr86-chunk-2`
**Base:** `feature/runway-pr86-wave1` (Chunk 1 query layer + Chunk 4 schema + 6 client migrations integrated)

Convention reference: `docs/tmp/runway-v4-convention.md` §"Resources field format," "Convention-driven behaviors §7-9."

---

## Step 0 — Verify state

```bash
git branch --show-current
git log --oneline feature/runway-pr86-wave1..HEAD   # expect empty
grep -l "PersonWorkload" src/lib/runway/   # should return — Chunk 1's new type is landed
grep -l "engagement_type\|blocked_by" src/lib/db/runway-schema.ts   # Chunk 4 landed
```

If any fail, STOP.

---

## Scope — strict

**IN:**

1. `src/lib/runway/operations-reads-week.ts:get_week_items` (or bot-tool equivalent) — match on `resources` field too, not owner-only. Same substring match semantic as owner.

2. New MCP tool `get_week_items_by_project(projectId)` — returns all non-completed L2s under a given project id. Wired into MCP server + bot tool registry.

3. New bot tool `get_project_status(clientSlug, projectName)` — returns structured drill-down per interface contract below.

4. Resources parser — in `src/lib/runway/operations-utils.ts` or similar, add `parseResources(raw: string): ResourceEntry[]` that:
   - Splits on `,` for collaboration (concurrent peers)
   - Splits on `->` for handoffs (sequential)
   - Mixed: `CD: Lane -> Dev: Leslie, CW: Kathy` reads as "Lane hands to Leslie; Kathy on both"
   - Normalizes `→`, `=>`, `>>` to canonical `->` on write
   - Returns typed entries: `{ role: string, person: string, handoffPosition: number, isConcurrent: boolean }`

5. Bot prompt context (`src/lib/runway/bot-system-prompt.ts` or equivalent):
   - Add v4 convention summary (one paragraph explaining L1 owner, L2 inherits, resources format, stub filter behavior)
   - Smart plate framing rule: when user asks "what's on my plate," bot presents L2s first (by bucket), owned L1s as a rollup count ("You own 4 active engagements"), offer drill-down ("Ask me about Convergix to see what's next")
   - Category-derived tone rule: `launch/deadline` = urgent tone, `approval` = awaiting-signal tone, `kickoff/review/delivery` = neutral

6. Cascade on all categories — in `src/lib/runway/operations-writes-project.ts` or cascade handler. When L1 status flips to terminal (`completed` or `on-hold`), cascade fires for ALL L2 categories (not just `deadline`). Update cascade tests.

7. `triggeredByUpdateId` propagation — cascade-generated audit rows in `updates` table carry FK to the parent update that triggered them. Column added by Chunk 4; this is wiring.

8. Tests for all above.

**OUT:**
- Schema (Chunk 4)
- Query layer (Chunk 1)
- UI (Chunk 3)
- Data migrations

**Never:** push, pr, destructive git.

---

## Interface contract — `get_project_status` return shape

```ts
export type ProjectStatus = {
  name: string;
  client: string;
  owner: string;
  status: ProjectStatusEnum;
  engagement_type: 'project' | 'retainer' | 'break-fix' | null;
  contractRange: { start?: string; end?: string };   // ISO dates
  current: {
    waitingOn?: string;
    blockers?: string[];   // from status='blocked' L2s OR blocked_by resolution
  };
  inFlight: WeekItem[];        // status='in-progress' AND today between start/end (end=null means =start)
  upcoming: WeekItem[];        // next 14 days, status != 'completed'
  team: string;                // L1.resources raw
  recentUpdates: Update[];     // last 3 updates, newest first
  suggestedActions: string[];  // short strings: "change status to completed", "add note about delay", etc.
};
```

Bot formats this as human-friendly markdown. Frontend can render structured.

---

## Resources parser contract

```ts
type ResourceEntry = {
  role: string;       // e.g., "CD"
  person: string;     // e.g., "Lane"
  handoffPosition: number;  // 0 for first, 1 for second in arrow chain, etc.
  isConcurrent: boolean;    // true when comma-joined at same position
};

parseResources("CD: Lane -> Dev: Leslie, CW: Kathy"): [
  { role: "CD", person: "Lane", handoffPosition: 0, isConcurrent: false },
  { role: "Dev", person: "Leslie", handoffPosition: 1, isConcurrent: true },
  { role: "CW", person: "Kathy", handoffPosition: 1, isConcurrent: true },
];
```

---

## Tests

- Resources parser: single entry, comma-joined, arrow-joined, mixed, unicode arrow normalization, empty string, malformed
- `get_week_items` resource match: test returns items where person is in resources OR owner
- `get_project_status`: test returns correct inFlight/upcoming buckets, suggestedActions derivation
- Cascade on all categories: trigger status flip on L1, verify all L2 categories cascade (not just deadline)
- `triggeredByUpdateId`: verify cascade audit rows have FK populated

---

## Quality flow

```bash
pnpm test:run
pnpm build
pnpm lint
```

NO `/code-review`, `/atomic-commits`, `/pr-ready` — TP's QA agents handle those.

---

## Hard constraints

- NO push, pr, destructive git.
- Stage touched files only. No `git add -A`.
- Bot prompt context file is a touchy one — do NOT restructure unrelated sections. Only add/modify sections called out in IN scope.
- Resources parser must be pure function (no DB reads), easily testable.
- Atomic commits per logical unit.

---

## Output

- Commits (SHAs + messages)
- Files touched
- `pnpm test:run` summary (new test count; coverage on new tools)
- `pnpm build` result
- `pnpm lint` result
- Any ambiguity resolved
- `git log --oneline`
