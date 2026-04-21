# PR #86 — Llama Iteration Playbook

**For TP use after PR opens.** Handle Llama's findings autonomously, fire CC sub-agents for fixes, re-trigger review.

---

## Llama pattern (observed from prior PRs)

Llama posts a structured review as a GitHub PR review. Format:
- TL;DR recommendation: `Approve` / `Comment` / `Request Changes`
- Priority table: P1 (bug/critical) / P2 (maintainability) / P3 (nit)
- Per-finding: file + line + category + impact summary

Time to post: typically 5-15 min after PR open.
Re-review triggers: push new commits OR comment `@llamapreview review`.

---

## Decision matrix per finding priority

### P1 (bug / security / data-loss risk)

**TP response:** fix immediately.
- Spawn CC sub-agent with isolation:worktree off `feature/runway-pr86-base`
- Prompt includes: exact Llama quote, file + line, fix expectation, "co-locate test with fix"
- After fix + QA, merge to base, push, re-trigger Llama

### P2 (maintainability / error handling / logging)

**TP response:** fix unless clearly out of PR scope.
- Bundle multiple P2s into a single CC sub-agent if possible (fewer context switches)
- Same merge-and-re-trigger flow as P1

### P3 (nit / style)

**TP response:** evaluate + batch.
- If quick (1-2 lines): bundle with P2 fixes
- If cosmetic: note in PR comment that it's deferred to follow-up

---

## Common Llama patterns (from prior PRs)

Prior PRs surfaced these — anticipate:

1. **Regex hyphen in char class** — `[0-9\-]` not `[0-9-]`. Usually in sanitizers.
2. **`console.error(err.message)` not full stack** — preserve stack trace.
3. **Missing transaction wrap** — multi-step DB mutations without `db.transaction()`.
4. **Centralize FK pattern** — any DB FK deletion pattern should live in a shared doc.
5. **Switch-case handler drift** — new enum value without matching case somewhere else.

---

## Fire pattern for CC fix agent

```markdown
You are a Llama Fix Agent for PR #86.

**SAFETY + EFFICIENCY PREAMBLES** (full text)

## STEP 0 — base correction
[standard STEP 0 block]
Branch: `feature/runway-pr86-llama-fix-<N>`

## Finding
Llama flagged [P1/P2] at `<file>:<line>`:
> <exact quote>

## Fix
<exact fix description — what to do, not how>

## Test
Co-locate test in same commit. Assert against the behavior Llama flagged.

## Quality
`pnpm test:run && pnpm build && pnpm lint` must pass.

## DO NOT
- push, gh pr, destructive git
- fix anything outside Llama's flagged scope

## Output
Commit SHA, files touched, test count, preflight result.
```

---

## Re-review trigger

After fix commits merged to base and pushed:
```bash
gh pr comment <PR_NUMBER> --body "@llamapreview review — addresses findings F1, F2, F3 in commits <sha1>, <sha2>"
```

---

## Halt rules

- Llama finds something TP can't autonomously resolve (architectural decision, operator judgment call) → pause, log, wait for operator
- 3+ iteration rounds with no convergence → pause, operator reviews
- Security or data-loss finding that might have affected prod (we already applied data migrations) → pause, halt, operator decides
