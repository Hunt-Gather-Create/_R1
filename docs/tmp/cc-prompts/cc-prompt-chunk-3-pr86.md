# CC Prompt — PR #86 Chunk 3: UI Board

## Mission

Refactor Project View to read from the same data source as Week Of view (unified Chunk 1 shape). Add L2 owner inheritance on create. Surface past-end L2 red-section notes, retainer renewal + contract-expired soft flags, In Flight toggle on Week Of, and blocked_by visual indicators. Against real Chunk 1 + Chunk 4 outputs.

**Safety preamble:**
> You are operating as a sub-agent on a production codebase. Before making any destructive change, deleting files, or modifying shared configuration, stop and confirm with the operator. Do not assume. Do not guess at intent. If something is ambiguous, surface it before acting.

**Efficiency preamble:**
> Work in focused, atomic steps. Stay in scope.

---

## Context

**Working directory:** `{WORKTREE_PATH_CHUNK_3}` (off `feature/runway-pr86-wave1`)
**Branch:** `feature/runway-pr86-chunk-3`
**Base:** `feature/runway-pr86-wave1`

Convention reference: `docs/tmp/runway-v4-convention.md` §"Convention-driven behaviors §4-6."

---

## Step 0 — Verify state

```bash
git branch --show-current
git log --oneline feature/runway-pr86-wave1..HEAD   # expect empty
grep -l "PersonWorkload" src/lib/runway/   # Chunk 1 shape landed
grep -l "view_preferences" src/lib/db/runway-schema.ts   # — see #27 below, may need Chunk 4 addition
```

If any fail, STOP.

---

## Scope — strict

**IN:**

1. **Unified Project View** — refactor `src/app/runway/components/ProjectView.tsx` (or closest equivalent) to render from the same data shape as Week Of view. Project View becomes a grouping/pivot of the same data, not a duplicate fetch.

2. **L2 owner inheritance on create** — `createWeekItem` server action auto-populates owner from parent L1.owner when caller does not supply owner. Stored as explicit value (not computed at read).

3. **Past-end L2 red-section inline note** — when an L2 has `end_date < today` and `status='in-progress'`, render inline: "status unchanged past end_date — needs review, last touched N days ago" where N is days since `updated_at`.

4. **Retainer renewal soft surface** — on owner's plate summary (top of Week Of for that person), when an owned L1 has `engagement_type='retainer'` and `contract_end` within 30 days, render a soft pill: "Renewal: {projectName} expires {date}".

5. **Contract-expired soft surface** — when a client's `contract_status='expired'` and owner has an active L1 under them, render a soft pill on plate summary: "Contract expired: {clientName}".

6. **In Flight toggle on Week Of view** — toggle control in Week Of view header. When ON (default), a new section between Red and Today surfaces all L2s where `status='in-progress' AND today between start/end (end=null → =start)`. Toggle state persisted per-workspace in `view_preferences` JSON column on workspaces table. If that column doesn't exist yet, add it here (small additive change; coordinate with Chunk 4 in TP integration).

7. **blocked_by dependency visualization** — for L2s with non-empty `blocked_by` array, render a subtle visual: indent, or small arrow linking to blocker title. Handle rendering gracefully when blocker is on a different day/view (show "blocked by: {title} ({status})" tooltip or inline).

8. **Visual QA tests** — vitest component tests for the new sections; snapshot-based assertions OK where structural.

**OUT:**
- Schema (Chunk 4, unless adding view_preferences as noted above — coordinate at integration)
- Query layer (Chunk 1)
- Bot layer (Chunk 2)
- Any `scripts/runway-migrations/`

**Never:** push, pr, destructive git.

---

## Detail on #6 — `view_preferences` storage

If `workspaces.view_preferences` column does not exist when you start:
- Add to `src/lib/db/runway-schema.ts` as `text("view_preferences")` nullable
- Generate migration, apply via `pnpm runway:push`
- Flag TP at integration: "added view_preferences column in Chunk 3 scope; coordinate with Chunk 4 integration"

Shape of stored JSON:
```json
{ "inFlightToggle": true, "other future keys": "..." }
```

Read default = `{ inFlightToggle: true }` when column is null.

UI reads via server action; writes via server action when toggle flips. Server action checks workspace access per `requireWorkspaceAccess`.

---

## Tests

- Project View renders same data as Week Of from unified source (integration test)
- L2 create inherits owner from L1 when owner not provided
- Past-end red-section note renders correctly with date math
- Retainer renewal pill renders within 30 days
- Contract-expired pill renders for expired clients with active L1s
- In Flight toggle default ON, toggle updates view_preferences
- blocked_by renders visual cue, handles missing blocker gracefully

---

## Quality flow

```bash
pnpm test:run
pnpm build
pnpm lint
```

NO `/code-review`, `/atomic-commits`, `/pr-ready`.

---

## Hard constraints

- NO push, pr, destructive git.
- Stage specific files only.
- Do NOT change the `PersonWorkload` shape — Chunks 1 and 2 already depend on it.
- Do NOT refactor unrelated UI components. Scope discipline.
- Atomic commits per feature.

---

## Output

- Commits (SHAs + messages)
- Files touched
- `pnpm test:run` summary
- `pnpm build` result
- `pnpm lint` result
- Screenshots of new UI states in `docs/tmp/chunk-3-visual-qa/` (optional but helpful; use `pnpm dev` + manual capture)
- Any ambiguity resolved
- Flag if `view_preferences` column was added (TP coordinates with Chunk 4 at integration)
- `git log --oneline`
