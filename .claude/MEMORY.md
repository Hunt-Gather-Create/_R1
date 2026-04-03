# Project Memory

Shared learnings and context that persist across sessions for all contributors.

## Scripts

- `scripts/worktree <name>` - Create a worktree at `.worktrees/<name>` with branch `feature/<name>`, install deps, run migrations, launch Claude
- `scripts/worktree-clean` - Dry-run check for worktrees with branches merged into main; use `--force` to remove them

## Patterns

- Auth pattern: all server action mutations use `requireWorkspaceAccess(workspaceId, minimumRole?)` — cached per-request via React.cache()
- Issue status change auto-moves issue to corresponding column (handled in `updateIssue`)
- Subtasks are 1-level only (no nested subtasks), and subtasks move with their parent on column change
- Batch query optimization throughout — uses `inArray()` + Maps for O(1) lookups to prevent N+1
- Chat messages stored in R2 (JSON), not in the database
- Two-step file upload: presigned URL from `/api/attachments/upload`, then confirm via `/api/attachments/confirm`
- AI skills are lazy-loaded: listed by name/description in system prompt, full content fetched on-demand via `load_skill` tool

## Gotchas

- Turbopack requires `.tsx` extension for any file containing JSX — `.ts` files with JSX fail with cryptic "Expected '>', got 'src'" errors

## Decisions

- Workspaces (renamed from "boards") are the top-level container — everything is workspace-scoped
- Role hierarchy: viewer(0) < member(1) < admin(2) — enforced in `requireWorkspaceAccess`
- AI defaults to Haiku everywhere with prompt caching — Sonnet only on explicit user request
- Token usage tracked per-workspace for cost monitoring (tokenUsage table)
- Knowledge base uses wiki-link graph between documents (knowledgeDocumentLinks table)
- Brand guidelines stored as JSON in brands table, extracted via Inngest background job
