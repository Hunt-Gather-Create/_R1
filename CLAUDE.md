# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # Start dev server at localhost:3000
pnpm build            # Production build
pnpm test             # Run tests in watch mode
pnpm test:run         # Run tests once
pnpm lint             # ESLint
pnpm format           # Prettier formatting

# Database
pnpm db:generate      # Generate migrations from schema changes
pnpm db:migrate       # Run migrations (drizzle-kit push)
pnpm db:studio        # Open Drizzle Studio GUI
```

## Testing

**Stack:** Vitest, @testing-library/react, happy-dom

**Test location:** Co-located with source files as `*.test.ts` (e.g., `src/lib/utils.test.ts`)

**Running tests:**

- `pnpm test` - Watch mode for development
- `pnpm test:run` - Single run for CI

**Patterns:**

- Use `describe` blocks to group related tests
- Create factory helpers (e.g., `createIssue()`) for mock data
- Test pure functions in `src/lib/` directly without mocking

## Architecture

### Data Flow

```
User Action → Component → BoardContext (optimistic update) → Server Action → Database → revalidatePath()
```

The app uses React 19's `useOptimistic` for instant UI feedback while server actions run in the background.

### Key Contexts

- **AppShell** (`src/components/layout/AppShell.tsx`) - Global UI state: current view, sidebar, detail panel, command palette
- **BoardProvider** (`src/components/board/context/BoardProvider.tsx`) - Board data, issue CRUD with optimistic updates, selected issue
- **IssueContext** (`src/components/board/context/IssueContext.tsx`) - Lower-level issue reducer and optimistic actions

### Component Hierarchy

```
AppShell (UI state)
  └── BoardProvider (data + operations)
        └── MainContent
              ├── BoardView / ListView (view rendering)
              ├── IssueDetailPanel (side panel)
              └── CommandPalette
```

### Database Schema

Main tables: `boards`, `columns`, `issues`, `labels`, `issueLabels`, `cycles`, `comments`, `activities`

- Issues belong to columns (kanban lanes)
- Issues have many-to-many relationship with labels via `issueLabels`
- Activities track all changes for audit history

### Server Actions

Located in `src/lib/actions/`:

- `board.ts` - `getOrCreateDefaultBoardWithIssues()`
- `issues.ts` - `createIssue()`, `updateIssue()`, `deleteIssue()`, `moveIssue()`, label/comment operations

### Design Tokens

`src/lib/design-tokens.ts` defines constants used throughout:

- `STATUS` - backlog, todo, in_progress, done, canceled
- `PRIORITY` - 0 (urgent) to 4 (none)
- `VIEW` - board, list, timeline
- `SHORTCUTS` - keyboard shortcuts (Cmd+K, C, [, etc.)

### Drag and Drop

Uses @dnd-kit with custom collision detection in `src/lib/collision-detection.ts`. The `columnAwareCollisionDetection` function prioritizes column drops over item sorting.

### Type Definitions

`src/lib/types.ts` - Key types are inferred from Drizzle schema:

- `BoardWithColumnsAndIssues` - Full board with nested columns and issues
- `IssueWithLabels` - Issue with its labels array
- `CreateIssueInput` / `UpdateIssueInput` - Mutation input types

## Plan Execution Workflow

When executing a plan that involves code changes:

### Before Starting

1. **Create a new branch** before making any code changes:
   - Use a descriptive branch name based on the task (e.g., `feature/add-user-auth`, `fix/login-bug`, `refactor/board-context`)
   - Run `git checkout -b <branch-name>` from the main branch
   - If already on a feature branch for this task, continue on that branch

### After Completing the Plan

1. **Update documentation** by invoking `/update-docs` to:
   - Check if code changes affect documented patterns
   - Update `/docs` knowledge base (AI SDK, UI components, MCP, skills)
   - Keep package versions and code examples in sync

2. **Run the PR readiness check** by invoking `/pr-ready` to:
   - Remove any debug statements (console.log, debugger)
   - Identify and fix DRY violations
   - Check React component structure
   - Detect prop drilling issues
   - Clean up unused imports and dead code

3. **Address any critical issues** found by the checks before considering the task complete
