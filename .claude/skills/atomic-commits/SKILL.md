---
name: atomic-commits
description: Break down staged or unstaged changes into logical atomic commits, each with a focused purpose and clear message.
argument-hint: [--staged | --all]
---

Split the current working tree changes into clean, atomic commits — each one focused on a single logical change.

## Scope

Determine which changes to process:

- If `$ARGUMENTS` contains `--staged`, only consider staged changes (`git diff --cached`)
- If `$ARGUMENTS` contains `--all`, consider all changes including untracked files (`git diff` + `git ls-files --others --exclude-standard`)
- Default (no arguments): consider all tracked changes, both staged and unstaged (`git diff HEAD`)

## Step 1: Analyze All Changes

1. Run `git status` to get an overview
2. Run `git diff HEAD --stat` to see which files changed and by how much
3. Run `git diff HEAD` to read the full diff
4. If there are untracked files and `--all` was passed, read those files too

Build a mental model of every change in the working tree.

## Step 2: Identify Logical Change Groups

Categorize every hunk and file change into logical groups. Each group should represent **one cohesive purpose**. Common groupings:

| Group Type | Examples |
|------------|----------|
| **Feature** | New component, new API endpoint, new utility function |
| **Bug fix** | Fix a specific bug (include related test fix) |
| **Refactor** | Rename, extract function, restructure — no behavior change |
| **Style/format** | Whitespace, formatting, linting fixes |
| **Tests** | New or updated tests (unless tightly coupled with a feature) |
| **Config** | Package.json, tsconfig, ESLint, env changes |
| **Schema/migration** | Database schema changes and generated migrations |
| **Types** | Type definition additions or changes |
| **Docs** | Documentation, comments, README updates |
| **Deps** | Dependency additions, removals, or version bumps |
| **Cleanup** | Remove dead code, unused imports, deprecated features |

### Grouping Rules

1. **A file can be split across groups** — different hunks in the same file may belong to different logical commits
2. **Related changes stay together** — a new function and its tests go in the same commit (unless the test file is large and standalone)
3. **Schema + migration are one commit** — never separate a schema change from its migration
4. **Import changes follow their usage** — adding an import belongs with the code that uses it
5. **Minimum viable commit** — each commit should build and pass lint on its own (no broken intermediate states)

## Step 3: Determine Commit Order

Order commits so that:

1. **Dependencies come first** — package.json/lock changes before code that uses new deps
2. **Schema before code** — database changes before code that relies on them
3. **Types before implementation** — type definitions before code that uses them
4. **Refactors before features** — restructuring before new functionality that builds on it
5. **Core before consumers** — utilities/libs before components that use them
6. **Tests with or after their subject** — never before the code they test

## Step 4: Present the Plan

Show the user the proposed commit sequence:

```
## Atomic Commit Plan

### Commit 1: <type>: <description>
Files:
  - `path/to/file.ts` (specific hunks: lines X-Y)
  - `path/to/other.ts` (entire file)
Changes: <brief summary of what this commit does>

### Commit 2: <type>: <description>
Files:
  - `path/to/file.ts` (specific hunks: lines A-B)
Changes: <brief summary>

...

### Summary
- Total commits: N
- Order: deps → schema → types → refactor → feature → tests → cleanup
```

### Commit Message Format

Use conventional commit style:

```
<type>: <concise description>

<optional body explaining why, not what>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Types: `feat`, `fix`, `refactor`, `style`, `test`, `config`, `schema`, `docs`, `deps`, `chore`

## Step 5: Get User Approval

Ask the user:
1. **"Proceed with this plan?"** — execute all commits as proposed
2. **"Modify the plan"** — let them adjust groupings, ordering, or messages
3. **"Merge some commits"** — combine groups if they prefer fewer commits

Wait for confirmation before making any commits.

## Step 6: Execute Commits

For each commit in the plan:

1. **Reset the staging area**: `git reset HEAD` (only before the first commit if things are staged)
2. **Stage precisely**:
   - For entire files: `git add <file>`
   - For specific hunks: `git add -p <file>` is interactive, so instead use `git diff > /tmp/patch.diff`, then craft patches and apply with `git apply --cached`
   - For new files: `git add <file>`
3. **Verify staging**: Run `git diff --cached --stat` to confirm only the intended changes are staged
4. **Commit**: Create the commit with the planned message using a HEREDOC:
   ```bash
   git commit -m "$(cat <<'EOF'
   <type>: <description>

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```
5. **Verify**: Run `git log --oneline -1` to confirm

### Handling Partial File Staging

When a file needs to be split across commits, use this approach:

1. Save the full diff for the file: `git diff HEAD -- <file> > /tmp/full.patch`
2. For each commit involving this file, stage only the relevant hunks using `git add -p` or by crafting a targeted patch
3. If interactive staging is needed, explain to the user which hunks to accept (s/y/n at each prompt)

**Important**: If precise hunk staging is too complex for a particular split, tell the user and suggest they manually stage with `git add -p` for that specific file, then you'll continue with the remaining commits.

## Step 7: Final Summary

After all commits are created, show:

```
## Commits Created

1. abc1234 feat: add user avatar component
2. def5678 test: add avatar component tests
3. ghi9012 refactor: extract image utility from profile

Run `git log --oneline -N` to review.
```

## Edge Cases

- **No changes**: If the working tree is clean, report that and exit
- **Single logical change**: If everything belongs in one commit, say so and create a single well-messaged commit
- **Merge conflicts in staging**: If partial staging creates issues, fall back to whole-file staging and explain the trade-off
- **Pre-commit hooks**: If a commit fails due to hooks, fix the issue and retry (create a NEW commit, never amend a previous one)
