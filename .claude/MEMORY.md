# Project Memory

Shared learnings and context that persist across sessions for all contributors.

## Scripts

- `scripts/worktree.sh <name>` - Create a worktree at `.worktrees/<name>` with branch `feature/<name>`, install deps, run migrations, launch Claude
- `scripts/worktree-clean.sh` - Dry-run check for worktrees with branches merged into main; use `--force` to remove them

## Patterns

<!-- Add project patterns, conventions, and architectural decisions here -->

## Gotchas

- Turbopack requires `.tsx` extension for any file containing JSX — `.ts` files with JSX fail with cryptic "Expected '>', got 'src'" errors

## Decisions

<!-- Add key technical decisions and their rationale here -->
