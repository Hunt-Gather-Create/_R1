# Session pointer — Runway TP

**Branch:** `chore/9-layer-alignment`
**Last touched:** 2026-05-23

## What this session is parked on

9-layer planning structure rollout. PR adds:

- `VISION.md`, `DECISIONS.md` (20 entries D-01..D-20), `ROADMAP.md`, `STATUS.md` at repo root
- `.claude/sessions/` directory + this pointer
- Cherry-equivalent landing of Playwright + `runway-visual-qa` skill from the now-obsolete
  `main` side-branch onto `runway` (no merge conflict — copied files + added `@playwright/test`
  to devDeps + `runway:smoke` script + .gitignore entries; `pnpm install` regenerated lockfile)
- CLAUDE.md pruned to under 2k tokens (nav table + commands + working agreements only)
- `.claude/MEMORY.md` Decisions section removed (entries migrated to DECISIONS.md)
- 3 shipped plans archived (`auth-runway-page-fix.md`, `dashboard-predicate-and-display-cleanup.md`, `l1-canceled-status-fix.md`)
- GH milestones B1..B12 + supporting `track:*` labels created; every open issue assigned a primary home

## What ships next from this branch

1. Verification gates: `pnpm install`, `pnpm test:run`, `pnpm build`, `pnpm runway:smoke`, `/canary`
2. Operator approves PR open after gate results
3. Atomic commits split, then push + open PR to `Hunt-Gather-Create:runway`

## After this PR merges

- Local + origin cleanup: `git branch -D main` (local), `git push origin --delete main` (fork). Side-branch obsolete per D-04.
- Resume the cascade critical cluster — Branch 2 in `ROADMAP.md` (#17 first, then #16).
- Build GSD/gstack skills (scope drift, schema drift, plan-CEO-review gate, review-readiness dashboard) on top of the new scaffold.

## Resume protocol

For any future CC resuming this branch (or starting a new branch off `runway`):

1. Read `STATUS.md` for current project snapshot
2. Read `ROADMAP.md` for what's next
3. Read this file for session-local anchors
4. Skim `DECISIONS.md` only when about to make an architectural call

The `archive/` subdirectory holds gitignored session snapshots from past sessions.
