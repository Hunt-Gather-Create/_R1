---
description: Compare current branch with a target branch, perform code review, and refactor based on best practices.
---

The user input to you can be provided directly by the agent or as a command argument - you **MUST** consider it before proceeding with the prompt (if not empty).

User input (target branch to compare against):

$ARGUMENTS

## Prerequisites

1. Parse the target branch from `$ARGUMENTS`. If empty or not provided, prompt the user for the branch name (commonly `main`, `staging`, or `develop`).

2. Run `git rev-parse --abbrev-ref HEAD` to get the current branch name.

3. Verify the target branch exists by running `git rev-parse --verify $TARGET_BRANCH`. If it doesn't exist, report the error and stop.

## Step 1: Gather Changes

1. Run `git diff $TARGET_BRANCH...HEAD --name-only` to get the list of changed files.

2. Run `git diff $TARGET_BRANCH...HEAD --stat` to get an overview of changes.

3. For each changed file, run `git diff $TARGET_BRANCH...HEAD -- <file>` to get the specific changes.

4. Create a summary of all changes organized by:
   - New files added
   - Modified files
   - Deleted files

## Step 2: Code Review Checklist

For each changed file, analyze against these criteria:

### Architecture & Organization (Astro + React Islands)

- [ ] **Route-specific components**: Components used only by a specific route should be in a `_components` folder within that page's directory (e.g., `src/pages/dashboard/_components/`)
- [ ] **Shared components**: Only truly reusable components belong in `src/components/`
- [ ] **React Islands**: Interactive components should be properly isolated as React islands with appropriate `client:*` directives
- [ ] **Astro vs React**: Static content uses Astro components; interactive content uses React components

### Component Structure

- [ ] **Component size**: Components should be under 150 lines. If larger, identify ways to break them up
- [ ] **Single responsibility**: Each component should do one thing well
- [ ] **Logic extraction**: Business logic should be in hooks (`useXxx`) or context providers, not inline in components
- [ ] **Props interface**: Props should be clearly typed and minimal

### Code Quality

- [ ] **DRY principle**: Check for code duplication across files. Extract shared logic into utilities or hooks
- [ ] **Unnecessary comments**: Remove comments that describe obvious code. Keep only comments that explain "why", not "what"
- [ ] **Dead code**: Remove unused imports, variables, functions, and commented-out code
- [ ] **Consistent naming**: Follow project conventions for naming files, components, hooks, and variables

### Project-Specific Patterns

- [ ] **RPC usage**: Client-server communication uses the typed RPC pattern (`useRpcQuery`, `useRpcMutation`)
- [ ] **AI Gateway**: AI calls go through the gateway pattern, never importing providers directly
- [ ] **Zod imports**: Zod is imported from `zod/v3`
- [ ] **Response utilities**: RPC handlers use `successJSONResponse` and `errorJSONResponse`

### TypeScript & Types

- [ ] **Type safety**: No `any` types without justification
- [ ] **Inferred types**: Prefer inferred types over explicit annotations when TypeScript can infer correctly
- [ ] **Zod schemas**: Use Zod for runtime validation in RPC handlers

### Performance (React)

- [ ] **Memoization**: `useMemo` and `useCallback` are used appropriately (not over-used)
- [ ] **Re-renders**: Components don't cause unnecessary re-renders
- [ ] **Bundle size**: No unnecessary dependencies imported

## Step 3: Generate Report

Create a structured report with:

1. **Summary**: Overview of changes and overall code quality assessment

2. **Issues Found**: List each issue with:
   - File path and line numbers
   - Issue category (from checklist above)
   - Severity: `critical`, `warning`, or `suggestion`
   - Description of the problem
   - Recommended fix

3. **Refactoring Opportunities**: Identify patterns that could be improved:
   - Components to split
   - Logic to extract into hooks
   - Duplicate code to consolidate
   - Files to relocate

## Step 4: Apply Refactoring (with user confirmation)

For each identified issue, ask the user if they want to apply the fix:

1. **For component splitting**:
   - Show the proposed new component structure
   - Create new files in appropriate locations
   - Update imports

2. **For logic extraction**:
   - Create new hooks in `src/lib/hooks/` or co-located with the component
   - Move logic and update the component

3. **For code deduplication**:
   - Create shared utilities or hooks
   - Update all instances to use the shared code

4. **For file relocation**:
   - Move files to correct directories (e.g., route-specific `_components/`)
   - Update all import paths

5. **For comment removal**:
   - Remove unnecessary comments while preserving meaningful documentation

## Step 5: Validation

After refactoring:

1. Run `pnpm build` to verify no build errors

4. Generate a final summary of all changes made

## Output Format

Present findings in this structure:

```
## Branch Comparison: [current-branch] vs [target-branch]

### Files Changed
- Added: X files
- Modified: Y files
- Deleted: Z files

### Code Review Summary

#### Critical Issues (must fix)
1. [Issue description] - `path/to/file.tsx:line`

#### Warnings (should fix)
1. [Issue description] - `path/to/file.tsx:line`

#### Suggestions (nice to have)
1. [Issue description] - `path/to/file.tsx:line`

### Refactoring Plan
1. [Refactoring action] - [Files affected]
2. ...

Would you like me to proceed with the refactoring? (yes/no/select specific items)
```
