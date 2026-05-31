# Project Memory

Observed patterns, gotchas, and "how X works" notes. Shared across sessions for all contributors.

For LOCKED architectural decisions, see `DECISIONS.md` at repo root.

## Scripts

- `scripts/worktree <name>` - Create a worktree at `.worktrees/<name>` with branch `feature/<name>`, install deps, run migrations, launch Claude
- `scripts/worktree-clean` - Dry-run check for worktrees with branches merged into upstream/runway; use `--force` to remove them

## Patterns

- Auth pattern: all server action mutations use `requireWorkspaceAccess(workspaceId, minimumRole?)` — cached per-request via React.cache()
- Issue status change auto-moves issue to corresponding column (handled in `updateIssue`)
- Subtasks are 1-level only (no nested subtasks), and subtasks move with their parent on column change
- Batch query optimization throughout — uses `inArray()` + Maps for O(1) lookups to prevent N+1
- AI skills are lazy-loaded: listed by name/description in system prompt, full content fetched on-demand via `load_skill` tool
- L1 status enum has 7 values incl. `canceled` (operations-utils.ts:1031); compat matrix locks `canceled × canceled` as the only valid pair (operations-utils.ts:1130); `CASCADE_STATUSES` omits `canceled` — L1 cancel does NOT auto-flip child L2s (see DECISIONS.md D-02). `updateProjectStatus` whitelists `newStatus` against the enum + runs compat check against the project's current category.

## Gotchas

- Turbopack requires `.tsx` extension for any file containing JSX — `.ts` files with JSX fail with cryptic "Expected '>', got 'src'" errors
- `proxy.ts` is the WorkOS auth middleware — add unauthenticated API paths there, not in next.config. See DECISIONS.md D-03 for why WorkOS env vars are intentionally unset on the runway deployment.
- Runway scripts need env vars exported from `.env.local` (drizzle-kit and tsx don't auto-load it)
- MCP SDK: use `WebStandardStreamableHTTPServerTransport` in Next.js routes, not the Node.js adapter
- Slack input-block elements (radio_buttons, checkboxes, plain_text_input inside an `input` block) cache their `initial_option` / `initial_options` / `initial_value` from the FIRST render of a given `block_id` and silently ignore subsequent `views.update` payloads that try to change the initial state. Workaround: gate the block on the disambiguation phase so it appears for the FIRST TIME after the user picks (Bug X1 fix at task.ts `date_type_block`); or rotate the `block_id` to force a fresh render. See `docs/plans/slack-modal-bug-x2-retainer-edit-fix.md` for the lead hypothesis on the open Bug X2 retainer-toggle case.
- Nested `overflow-y-auto` containers inside the page scroll trigger Chrome's scroll-anchoring on macOS — the section header outside the scrollport appears "pinned" while cards flow past as the inner scrollport drains momentum. Avoid `max-h-[Xvh] overflow-y-auto` wrappers around card grids on the runway dashboard; let the page scroll as one container. (Lesson learned 2026-05-07 from `today-section.tsx` + `day-column.tsx` cleanup.)
- End users say "Project" / "Task" — never "L1" / "L2". Internal helper / function / variable / file names can keep L1/L2 (those are JS identifiers). Anything that renders to user-facing text (chart headers, kind tags, ARIA labels, badge text) must use Project / Task. See DECISIONS.md D-16.
- Gantt embed must NOT import from `react-dom/server` anywhere reachable from the App Router — Next.js 16 Turbopack bans it via the `react-server` export condition. Use the RSC slot pattern (D-13).

## Common failure modes

- **"I'll write tests later"** — Tests are not a separate step. If your plan has a "write tests" step at the end, your plan is wrong. Rewrite it with tests woven into each build step.
- **"I read the rules"** — Reading is not synthesizing. If you read a skill file and came away with a summary instead of a multi-step methodology, you skimmed.
- **Cherry-picking from skills** — Each skill has a defined number of steps. `/code-review` has 5. `/pr-ready` has 7. Run all of them or you haven't run the skill.
- **"The code works, ship it"** — Working code that duplicates logic, lacks tests, has unused imports, and bypasses the project's architectural patterns is not done.
- **Inconsistent data across files** — Types defined in one file, status values in another, enum-like strings in a third. Cross-check them before considering anything complete.

## See also

- Architecture detail → `docs/runway.md`
- Locked decisions → `DECISIONS.md`
- Phase plan → `ROADMAP.md`
- Current state → `STATUS.md`
- Skill catalog (React/Next.js best practices, etc.) → `.claude/skills/`
