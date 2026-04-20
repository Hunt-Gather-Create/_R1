# Wave 0 Go/No-Go Checklist

**Purpose:** Confirmation gate before firing Wave 1 agents. All items must be TRUE.

---

## Base branch

- [x] `feature/runway-pr86-base` created off `upstream/runway`
- [x] 5 commits cherry-picked/added:
  - [x] `148dbdf` fix(runway): publish-updates dedup
  - [x] `5f8c794` feat(runway): linkWeekItemToProject helper + weekOf whitelist
  - [x] `187b958` feat(runway): bonterra cleanup migration 2026-04-19
  - [x] `c7dfcf4` feat(runway): add category to editable project fields
  - [x] `cc268a6` chore: ignore docs/tmp in eslint config
- [x] `pnpm test:run` green (1493 tests pass)
- [x] `pnpm lint` green (0 errors, 11 pre-existing warnings)
- [x] Pushed to `origin/feature/runway-pr86-base`
- [x] `pnpm build` green (no errors, routes compile cleanly)

## Amendment docs

- [x] `docs/tmp/runway-v4-convention.md` locked
- [x] `docs/tmp/pr86-orchestration-plan.md` (v1 base)
- [x] `docs/tmp/pr86-orchestration-amendment.md` (v2.1 binding)
- [x] `docs/brain/remaining-6-client-state-questions.md` (post-merge prep)

## CC prompts

- [x] `docs/tmp/cc-prompts/cc-prompt-chunk-1-pr86.md`
- [x] `docs/tmp/cc-prompts/cc-prompt-chunk-2-pr86.md`
- [x] `docs/tmp/cc-prompts/cc-prompt-chunk-3-pr86.md`
- [x] `docs/tmp/cc-prompts/cc-prompt-chunk-4-pr86.md`
- [x] `docs/tmp/cc-prompts/cc-prompt-chunk-5-pr86.md`

## QA templates

- [x] `docs/tmp/qa-templates/qa-agent-code-review.md`
- [x] `docs/tmp/qa-templates/qa-agent-atomic-commits.md`
- [x] `docs/tmp/qa-templates/qa-agent-data-integrity.md`
- [x] `docs/tmp/qa-templates/qa-digest-subagent.md`

## Migration specs

- [x] `docs/tmp/migration-specs/overnight-clients-v4-realign.md` (6 clients)
- Asprey is in the same spec doc for Wave 2

## Worktrees

- [ ] `feature/runway-pr86-chunk-4` worktree (fires first in Wave 1 Step 1)
- [ ] `feature/runway-pr86-chunk-1` worktree (Wave 1 Step 2 after Chunk 4 merges to base)
- [ ] `feature/runway-pr86-data` worktree for data agents

_Worktrees created at wave start, not Wave 0 end, so base branch has latest commits._

## Preambles

- [x] Safety + efficiency preambles embedded in every CC prompt template
- [x] Safety + efficiency preambles embedded in every QA template

## Interface contracts

- [x] `getPersonWorkload` return shape locked in Chunk 1 prompt
- [x] `get_project_status` return shape locked in Chunk 2 prompt
- [x] Schema column contract locked in Chunk 4 prompt
- [x] Resources parser contract locked in Chunk 2 prompt

## Pre-flight decisions

- [x] In Flight toggle default ON (workspace view_preferences JSON)
- [x] Bucket sort by date ASC
- [x] Retainer renewal flag 30 days
- [x] blocked_by = JSON text column
- [x] Full client snapshot for backup
- [x] Timezone = America/Chicago for "today" boundary

## Memory pointer

- [x] `~/.claude/projects/.../memory/project_pr86_orchestration_plan.md` updated with amendment v2.1 read-order

---

## Items remaining before Wave 1 fire button

1. `pnpm build` on base branch — run and confirm green
2. Create 3 worktrees (chunk-4, chunk-1, data)
3. Final pre-Wave-1 snapshot to plan doc
4. Spawn Chunk 4 schema agent (Wave 1 Step 1)

---

## Halt and report if any of these are TRUE at Wave 1 fire time

- Base branch shows unexpected commits
- Turso prod DB is in unexpected state (basic sanity query fails)
- Preflight fails on base branch
- Any of the locked docs above have been modified post-approval without operator notice
- Operator has signaled pause or changed scope
