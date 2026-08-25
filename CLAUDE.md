# CLAUDE.md — Navigation Map

Runway is Civilization Agency's triage dashboard (Phase 0 of the agency PM tool). It runs on
the Next.js R1 platform with a separate Turso DB, a Slack bot for natural-language updates,
and an MCP server for AI consumers. See `VISION.md` for the full pitch.

## Where to look for what

| If task requires… | Read | Decay |
|---|---|---|
| Strategic context, "why does X exist" | `VISION.md` | Stable |
| About to make an architectural / operational call | `DECISIONS.md` | Slow-grows |
| Picking up an item, filing new work, phase planning | `ROADMAP.md` + GitHub Issues | Monthly / live |
| Resuming session or re-orienting to project state | `STATUS.md` | Event-driven |
| Resuming THIS branch's session specifically | `.claude/sessions/<branch>.md` | Per-session |
| Executing a feature with a design | `docs/plans/<feature>.md` | Per-feature |
| Understanding subsystem behavior, debugging, patterns | `.claude/MEMORY.md` | Frequent |
| Architecture / module map detail | `docs/runway.md` | As-needed |
| React / Next.js performance | `.claude/skills/vercel-react-best-practices/` | As-needed |
| Cross-fork Vercel preview | `.claude/skills/canary/SKILL.md` | As-needed |
| Prod data writes | `.claude/skills/data-integrity-tp/SKILL.md` | As-needed |
| Visual QA against production | `.claude/skills/runway-visual-qa/SKILL.md` | As-needed |

## Commands

```bash
pnpm dev              # Dev server at localhost:3000
pnpm build            # Production build
pnpm test:run         # Tests (single run)
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm runway:smoke     # Playwright smoke tests against runway.startround1.com

# Runway database (separate Turso instance, requires RUNWAY_DATABASE_URL in .env.local)
pnpm runway:generate  # Generate migrations
pnpm runway:push      # Push schema to Turso (dev flow, sources .env.local)
pnpm runway:schema-push # Deploy-time schema push (prod-gated via VERCEL_ENV; runs first in pnpm build)
pnpm runway:studio    # Open Drizzle Studio
pnpm runway:pull      # Pull prod data to local
pnpm runway:gantt     # Render Gantt CLI
pnpm runway:sheet-sync # Sheet→Runway diff report (read-only, Phase 1a; fixtures via google-api skill)
```

## Working agreements

### Branch + PR

- All upstream PRs target `Hunt-Gather-Create:runway`, NEVER `main`. (D-06)
- Cross-repo issue auto-close: include `Fixes jasonburks23/_R1#<n>` in PR body when applicable. (D-07)
- Branch naming: `fix/<issue>-...`, `feat/<issue>-...`, `chore/...`.

### Post-build pipeline (run in order before pushing)

1. `/gsd:code-review` -- GSD structured review (bugs, security, quality); alias `/code-review` for DRY, prop drilling, hooks/context, test coverage
2. `/update-docs` — sync `/docs` if patterns/versions changed
3. `/pr-ready` — debug statements, unused imports, final cleanup
4. `/preflight` — build + grep gate + tests + lint
5. `/canary` — cross-fork Vercel preview (runway-targeted PRs only)
6. `/atomic-commits` — split tree into focused commits
7. Push + open PR (operator runs this; do NOT auto-push)

### Roles + safety

- TP coordinates and drafts; CC executes code. TP never writes code.
- All Runway prod writes go through `data-integrity-tp` skill. No ad-hoc mutations from CC or operator. (D-10)
- Tests are part of each build step, not a separate step at the end.
- Don't enter plan mode as TP — write pre-plans as `docs/plans/<feature>.md` for CC handoff.
- Don't auto-push to upstream.

### AI

- Default model: Claude Haiku. Sonnet only on explicit operator request. (D-05)
- Always implement prompt caching. Cap tool usage with `maxUses`. Track tokens via `recordTokenUsage()`.

## Memory rules

`@.claude/MEMORY.md` is the KNOWLEDGE layer (observed patterns, gotchas). Locked decisions go in `DECISIONS.md`, not MEMORY.

When you discover a non-obvious pattern or gotcha:
- Add it to MEMORY under existing Scripts / Patterns / Gotchas headings (1-2 lines each).
- If it's a LOCKED architectural decision, add a `DECISIONS.md` entry instead and reference it.
- Remove entries that become outdated.

## Plan execution

Read `docs/ai-development-workflow.md` before your first code change in any session. Tests are woven into each step. Cross-check enums, status values, and types across all files that reference them.
