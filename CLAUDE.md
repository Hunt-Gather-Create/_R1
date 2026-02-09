# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Memory

@.claude/MEMORY.md

**Rules for updating project memory:**
- When you discover a non-obvious pattern, gotcha, or useful context about this codebase, add it to `.claude/MEMORY.md`
- Keep entries concise (1-2 lines each) — this file is loaded into every session
- Organize under the existing headings: Scripts, Patterns, Gotchas, Decisions
- Remove entries that become outdated or wrong
- This is shared team memory (checked into git), not personal notes

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

## AI Model Selection (CRITICAL)

**Always use Claude Haiku by default.** Only use more expensive models when explicitly requested by the user.

| Use Case | Model | Model ID |
|----------|-------|----------|
| Background tasks | Haiku | `claude-haiku-4-5-20251001` |
| AI task execution | Haiku | `claude-haiku-4-5-20251001` |
| Chat (default) | Haiku | `claude-haiku-4-5-20251001` |
| Complex reasoning (user requested) | Sonnet | `claude-sonnet-4-5-20251001` |

**Cost comparison (per 1M tokens):**
- Haiku: $0.25 input / $1.25 output
- Sonnet: $3.00 input / $15.00 output (12× more expensive)

**Rules:**
1. Default to Haiku for all AI features unless the user explicitly requests a different model
2. When implementing new AI features, use `claude-haiku-4-5-20251001`
3. Always implement prompt caching to reduce costs (see `src/lib/chat/index.ts` for patterns)
4. Limit tool usage with `maxUses` to prevent runaway agentic loops
5. Track token usage via `recordTokenUsage()` for cost monitoring

## React & Next.js Best Practices

**Always follow the Vercel React best practices** documented in `.claude/skills/vercel-react-best-practices/`. Reference `AGENTS.md` for detailed explanations and code examples.

### 1. Eliminating Waterfalls (CRITICAL)
- `async-defer-await` - Move await into branches where actually used
- `async-parallel` - Use Promise.all() for independent operations
- `async-dependencies` - Use better-all for partial dependencies
- `async-api-routes` - Start promises early, await late in API routes
- `async-suspense-boundaries` - Use Suspense to stream content

### 2. Bundle Size Optimization (CRITICAL)
- `bundle-barrel-imports` - Import directly, avoid barrel files (configured via `optimizePackageImports`)
- `bundle-dynamic-imports` - Use next/dynamic for heavy components
- `bundle-defer-third-party` - Load analytics/logging after hydration
- `bundle-conditional` - Load modules only when feature is activated
- `bundle-preload` - Preload on hover/focus for perceived speed

### 3. Server-Side Performance (HIGH)
- `server-auth-actions` - Authenticate server actions like API routes (use `requireWorkspaceAccess()`)
- `server-cache-react` - Use React.cache() for per-request deduplication
- `server-cache-lru` - Use LRU cache for cross-request caching
- `server-dedup-props` - Avoid duplicate serialization in RSC props
- `server-serialization` - Minimize data passed to client components
- `server-parallel-fetching` - Restructure components to parallelize fetches
- `server-after-nonblocking` - Use after() for non-blocking operations

### 4. Client-Side Data Fetching (MEDIUM-HIGH)
- `client-swr-dedup` - Use SWR for automatic request deduplication
- `client-event-listeners` - Deduplicate global event listeners
- `client-passive-event-listeners` - Use passive listeners for scroll
- `client-localstorage-schema` - Version and minimize localStorage data

### 5. Re-render Optimization (MEDIUM)
- `rerender-defer-reads` - Don't subscribe to state only used in callbacks
- `rerender-memo` - Extract expensive work into memoized components
- `rerender-memo-with-default-value` - Hoist default non-primitive props
- `rerender-dependencies` - Use primitive dependencies in effects
- `rerender-derived-state` - Subscribe to derived booleans, not raw values
- `rerender-derived-state-no-effect` - Derive state during render, not effects
- `rerender-functional-setstate` - Use functional setState for stable callbacks
- `rerender-lazy-state-init` - Pass function to useState for expensive values
- `rerender-simple-expression-in-memo` - Avoid memo for simple primitives
- `rerender-move-effect-to-event` - Put interaction logic in event handlers
- `rerender-transitions` - Use startTransition for non-urgent updates
- `rerender-use-ref-transient-values` - Use refs for transient frequent values

### 6. Rendering Performance (MEDIUM)
- `rendering-animate-svg-wrapper` - Animate div wrapper, not SVG element
- `rendering-content-visibility` - Use content-visibility for long lists (use `.issue-item` class)
- `rendering-hoist-jsx` - Extract static JSX outside components
- `rendering-svg-precision` - Reduce SVG coordinate precision
- `rendering-hydration-no-flicker` - Use inline script for client-only data
- `rendering-hydration-suppress-warning` - Suppress expected mismatches
- `rendering-activity` - Use Activity component for show/hide
- `rendering-conditional-render` - Use ternary, not && for conditionals
- `rendering-usetransition-loading` - Prefer useTransition for loading state

### 7. JavaScript Performance (LOW-MEDIUM)
- `js-batch-dom-css` - Group CSS changes via classes or cssText
- `js-index-maps` - Build Map for repeated lookups
- `js-cache-property-access` - Cache object properties in loops
- `js-cache-function-results` - Cache function results in module-level Map
- `js-cache-storage` - Cache localStorage/sessionStorage reads
- `js-combine-iterations` - Combine multiple filter/map into one loop
- `js-length-check-first` - Check array length before expensive comparison
- `js-early-exit` - Return early from functions
- `js-hoist-regexp` - Hoist RegExp creation outside loops
- `js-min-max-loop` - Use loop for min/max instead of sort
- `js-set-map-lookups` - Use Set/Map for O(1) lookups
- `js-tosorted-immutable` - Use toSorted() for immutability

### 8. Advanced Patterns (LOW)
- `advanced-event-handler-refs` - Store event handlers in refs
- `advanced-init-once` - Initialize app once per app load
- `advanced-use-latest` - useLatest for stable callback refs

## Plan Execution Workflow

When executing a plan that involves code changes:

### Before Starting

1. **Create a new branch** before making any code changes:
   - Use a descriptive branch name based on the task (e.g., `feature/add-user-auth`, `fix/login-bug`, `refactor/board-context`)
   - Run `git checkout -b <branch-name>` from the main branch
   - If already on a feature branch for this task, continue on that branch

### During Development

1. **Run code review frequently** by invoking `/code-review` to:
   - Catch DRY violations early (extract utilities and components)
   - Detect prop drilling (use Context and hooks instead)
   - Ensure proper hooks/context patterns
   - **Verify tests exist for all changes** (this is critical!)

### After Completing the Plan

1. **Update documentation** by invoking `/update-docs` to:
   - Check if code changes affect documented patterns
   - Update `/docs` knowledge base (AI SDK, UI components, MCP, skills)
   - Keep package versions and code examples in sync

2. **Run the PR readiness check** by invoking `/pr-ready` to:
   - Remove any debug statements (console.log, debugger)
   - Clean up unused imports and dead code
   - Final check for any remaining issues

3. **Address any critical issues** found by the checks before considering the task complete
