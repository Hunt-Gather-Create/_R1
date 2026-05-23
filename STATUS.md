# Status — Runway

> Project state snapshot. Where the project IS RIGHT NOW. Refreshed at state shifts,
> milestone closes, framework changes — NOT per session.
>
> For session-specific anchors (where THIS branch is parked), see `.claude/sessions/`.

**Last refreshed:** 2026-05-23

## Where we are

- **PR #103** (`/runway` password gate) shipped 2026-05-19. `/runway/auth` is live in prod.
- **PR #104** (dashboard predicate + display cleanup) shipped 2026-05-22. Closed issues #3, #4, #41, #49, #53. `CASCADE_STATUSES` operator-lock landed (D-02).
- **PR for 9-layer alignment** in flight — this branch.
- Backlog: 50+ open issues on `jasonburks23/_R1`, with the critical cascade cluster (#5 / #8 / #16 / #17) still queued.

## Next 3 up (priority order)

1. **#17 — `_currentBatchId` concurrency bleed on Fluid Compute** (critical, data-cascade).
2. **#16 — Parent date override clobbered by child-triggered recompute** (critical, data-cascade). Bundles with #17 in Branch 2 of ROADMAP.
3. **#5 / #8 — Cascade-statuses + retainer wrapper guard** (critical, data-cascade). Branch 3 in ROADMAP, depends on Branch 2 helpers.

After the cascade cluster lands: GSD / gstack skills (scope-drift, schema-drift, plan-CEO-review gate, review-readiness dashboard) on top of the new 9-layer scaffold.

## Working agreements in effect

- TP/CC roles: TP coordinates + drafts, CC executes code. TP never writes code.
- All prod data writes go through `data-integrity-tp` skill — never direct CC mutations.
- All upstream PRs target `Hunt-Gather-Create:runway`, never `main`.
- Post-build pipeline (in order): `/code-review` → `/update-docs` → `/pr-ready` → `/preflight` → `/canary` → `/atomic-commits` → push. See CLAUDE.md.
- AI defaults to Haiku (D-05).
- 9-layer planning structure adopted (D-01).
- /runway production is password-gate-only (D-03). WorkOS armed in code but env unset by design.

## Known constraints

- Tim's `Hunt-Gather-Create/_R1` is upstream of this fork. Cross-fork Vercel preview doesn't auto-fire; use `/canary` skill before pushing to upstream.
- Runway DB (`RUNWAY_DATABASE_URL`) on free Turso tier — will migrate to dedicated R1 instance later (D-08).
- Per-PR canary deploys point at PROD Turso. Do not interact with canary URLs like a normal user (clicks write to prod).

## Recently superseded / closed

- Visual-qa Playwright harness lived on diverged `main` side branch (2026-05-22) — superseded by D-04 in this PR. The `main` branch becomes obsolete after this merges; deleted via local + origin `git branch -D main` (no PR needed).
- Issue #61 (WorkOS env config) closed as not-a-decision 2026-05-23 — superseded by D-03 (password-only is intentional, not a config gap).
