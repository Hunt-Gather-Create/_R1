# AI Development Workflow

How AI sessions (Claude Code, Copilot, etc.) must work in this codebase. This is not optional guidance. It is the explicit, end-to-end process that every AI session follows when building features, fixing bugs, or making any code changes.

## Why This Document Exists

This codebase has quality standards defined across multiple sources: `CLAUDE.md`, four skill files (`/code-review`, `/pr-ready`, `/atomic-commits`, `/update-docs`), 28+ co-located test files, and established commit conventions. Each source defines part of the standard. No single source states the full workflow.

AI sessions read all sources, check boxes, and still miss the synthesized standard. This has happened repeatedly: sessions read "tests are co-located as `*.test.ts`" as a description of convention rather than a requirement to produce test files. Sessions treat quality gates as end-of-task reminders rather than continuous process steps. Sessions read 80+ React best practice rules without checking any against actual code.

This document closes that gap by stating the full workflow once, explicitly.

---

## The Workflow

### Phase 1: Orientation (Before Writing Code)

1. **Read `CLAUDE.md`** — architecture, commands, testing stack, security patterns, React best practices
2. **Read all skill files** in `.claude/skills/` — understand the full methodology of each, not just the name
3. **Read relevant `docs/*.md`** — understand what's documented so you know what to update later
4. **Read the codebase patterns** — look at how existing code handles the same kind of thing you're about to build. Find the closest analogue and match its patterns (auth, error handling, file organization, naming)
5. **Identify the implicit standards** — what does the combination of all sources demand? Tests alongside code. Quality checks during development. Documentation updates at the end. If you can't state the full workflow from memory after reading, you haven't internalized it

### Phase 2: Planning

1. **Create or continue on a feature branch** — `feature/<descriptive-name>`
2. **Write the plan** — what you'll build, in what order, what tests each piece needs
3. **Tests are part of each step, not a separate step.** If you're building `operations.ts`, the plan includes `operations.test.ts` in the same step. Not "Step 7: write tests for everything"
4. **Cross-check data consistency** — types, enums, status values, schema definitions. Verify they match across all files that reference them before you start
5. **Get user alignment** on the plan before writing code

### Phase 3: Build (Iterative)

For each logical piece of work:

1. **Write the test file first** (or simultaneously with the source file)
   - Co-locate: `src/lib/foo.ts` gets `src/lib/foo.test.ts`
   - Test pure functions directly without mocking (per CLAUDE.md)
   - Use `describe` blocks, factory helpers for mock data
   - Cover edge cases: null, empty, error states
   - Security-critical code (auth, signature verification) must have thorough tests

2. **Write the source code**
   - Match existing codebase patterns for the same kind of thing
   - Follow React best practices from CLAUDE.md — these are checkable rules, not background reading:
     - Use ternary for conditional rendering, not `&&`
     - Components under 150 lines
     - Extract business logic to custom hooks
     - Use `Promise.all()` for independent async operations
     - Import directly, avoid barrel files
   - No unused imports, no dead code, no debug statements in committed code
   - Validate inputs with Zod on API boundaries
   - Auth on every endpoint (match Tim's patterns)

3. **Run tests** — `pnpm test:run` to verify your changes pass

4. **Run `/code-review`** — all 5 steps, not cherry-picked:
   - Step 1: DRY analysis
   - Step 2: Prop drilling detection
   - Step 3: Hooks & context review
   - Step 4: Test coverage check
   - Step 5: Interactive fixes

   Do this after each logical piece, not once at the end.

5. **Fix everything the review finds before moving to the next piece**

### Phase 4: Completion

1. **Run `/update-docs`** — check if changes affect any `docs/*.md` file. Update them. If a new system was added (like Runway's Slack integration), it may need a new doc file.

2. **Run `/pr-ready`** — all 7 steps:
   - Step 1: Identify files
   - Step 2: Debug statement check (console.log, debugger, TODO/FIXME)
   - Step 3: DRY analysis
   - Step 4: React component structure (150-line max, single responsibility)
   - Step 5: Prop drilling detection
   - Step 6: Quality checks (unused imports, dead code, `any` types)
   - Step 7: Offer fixes

3. **Fix all critical issues** before considering the task complete

4. **Commit atomically** using `/atomic-commits`:
   - One logical change per commit
   - Each commit must build and lint independently
   - Conventional commit style: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`
   - Dependency order: deps -> schema -> types -> shared utilities -> implementation -> tests -> cleanup
   - Co-authored-by line on every commit

5. **Verify** — `pnpm build` succeeds, `pnpm test:run` passes, `pnpm lint` clean

---

## Common Failure Modes

These are real failures that have occurred in this codebase. Check yourself against each one.

### "I'll write tests later"
Tests are not a separate step. If your plan has a "write tests" step at the end, your plan is wrong. Rewrite it with tests woven into each build step.

### "I read the rules"
Reading is not synthesizing. If you read `/code-review` and came away with "check for DRY violations" instead of "run a 5-step methodology after each logical change," you read the title and skipped the content. If you read CLAUDE.md's React best practices and didn't check a single one against your actual code, you skimmed.

### "I'll run the quality gates before the PR"
Quality gates run during development, not at the end. CLAUDE.md says "Run `/code-review` frequently to catch issues early." The `/code-review` skill says "Run it after implementing a new feature, when a file grows beyond 150 lines, before running `/pr-ready`." These are continuous, not final.

### Cherry-picking from skills
`/code-review` has 5 steps. `/pr-ready` has 7 steps. You run all of them or you haven't run the skill. Spotting DRY issues you already know about is not a code review.

### "The code works, ship it"
Working code that duplicates logic, lacks tests, has unused imports, and bypasses the project's architectural patterns is not done. Functionality is necessary but not sufficient.

### Inconsistent data across files
Types defined in one file, status values in another, enum-like strings in a third. Cross-check them. If a bot prompt lists `sent-to-client` as a valid status but the type system doesn't include it, that's a bug you introduced by writing files in isolation.

---

## Key Files Reference

| File | What It Defines |
|------|-----------------|
| `CLAUDE.md` | Architecture, commands, testing stack, security, React best practices, AI model selection, Plan Execution Workflow |
| `.claude/skills/code-review/SKILL.md` | 5-step code review methodology |
| `.claude/skills/pr-ready/SKILL.md` | 7-step PR readiness check |
| `.claude/skills/atomic-commits/SKILL.md` | Atomic commit strategy and execution |
| `.claude/skills/update-docs/SKILL.md` | Documentation update process |
| `docs/*.md` | Knowledge base that must stay in sync with code |

---

## Enforcement

This codebase has no CI/CD pipeline, no pre-commit hooks, and no automated test gates. Quality is enforced entirely by convention — by following this workflow. That makes discipline more important, not less. There is no safety net. If you skip a step, nobody catches it until a human reviews the code and finds the problems.
