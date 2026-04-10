# brain-RULES.md
## Round One: Project Management + Resource View
**Civilization Agency — Internal Build**
*Last updated: April 7, 2026*

---

## Operator Working Preferences

Jason is a non-developer builder who thinks visually and strategically. He builds with AI as his development engine and uses voice, audio transcripts, and brain dumps as primary inputs. He works fast and iterates. He needs things explained plainly — no assumed knowledge on dev conventions, git, or terminal commands.

**How Jason works:**
- Leads with vision, then refines toward requirements
- Prefers one clarifying question at a time, with suggested answers
- Wants to be told when something is wrong before it becomes a problem
- Runs his thought partner in Claude Code with `--dangerously-skip-permissions` — the TP has freedom to deploy agents and sub-agents, but must always pass the safety preamble and efficiency preamble when doing so (see below)
- Does not want to be a manual babysitter for agent-to-agent prompts — prefers giving Claude permissions and letting it run, with the preambles as guardrails
- Will say "button up" or "wrap up" as a signal to: update brain docs, make sure everything is committed, and follow Tim's push process (atomic commits → `/push` → PR → merge → pull main)
- Processes well through audio and conversation; transcripts are valid inputs
- Uses Claude Code for both thought partnering and build execution — not exclusively claude.ai

**Safety preamble (pass to all sub-agents and deployed agents):**
> You are operating as a sub-agent on a production codebase. Before making any destructive change, deleting files, or modifying shared configuration, stop and confirm with the operator. Do not assume. Do not guess at intent. If something is ambiguous, surface it before acting.

**Efficiency preamble (pass to all sub-agents and deployed agents):**
> Work in focused, atomic steps. Complete one thing fully before moving to the next. Commit after each logical unit of work. Keep files under the line limit. Do not refactor things that weren't asked to be refactored. Stay in scope.

**How Claude should work with Jason:**
- Always explain git operations in plain English before executing — what it does, why, what could go wrong
- Never assume Jason knows a terminal command, git concept, or dev convention
- When something has two valid approaches, name both and give a plain-language recommendation
- Flag potential problems early rather than waiting until they're blockers
- Keep brain docs current — they are Jason's memory across sessions
- On "button up" or "wrap up": update brain docs, confirm all changes are committed with atomic commits, run `/push`, create PR, and confirm it's ready to merge before ending the session

---

## Build Methodology (Tim's Approach — Adopted for This Project)

This is the build process Tim Warren uses, which Jason is adopting. It is the standard for this project.

### The Stack (Non-Negotiable)

- **Foundation:** _R1 fork, built on Tim's AI Starter
- **Hosting:** Vercel
- **Database:** Turso (not Superbase — Superbase breaks at the parallel work tree step)
- **Frontend:** React, Tailwind, shadcn/ui
- **Package manager:** `pnpm` instead of `npm` — it caches packages outside the project so installs are faster. When you see `pnpm run dev` instead of `npm run dev`, that's why.
- **Auth:** Already built into AI Starter
- **Commits:** Atomic commits — one logical change per commit, clear message, feat/fix/chore prefix. This is non-negotiable.
- **Quality:** Test-driven development, security checks, component size limits — all enforced by AI Starter best practices

### The Wedge for This Project

The wedge concept (the first thing that has to exist before anything else can be built) applies here, but it's different from a greenfield project because _R1 already has foundational scaffolding. The wedge here is discovery and planning, not initial setup.

**The correct sequence before any feature development:**

1. **Finish competitive research** — complete the landscape section of the vision doc. Understand what Monday, Asana, and the third PM tool do well and where they break. Do the same for resourcing tools. This informs the gap analysis.

2. **Review inspiration** — go through all of Allison's slides in `/sources/inspiration`. Understand how her brain works with these views. This informs the canvas requirements.

3. **INIT across _R1** — run a full codebase discovery session in Claude Code. Read the existing data model, AI integrations, component structure, and database schema. Produce a clear map of what exists.

4. **Gap analysis** — compare what _R1 has against what the vision doc requires. What's already there? What needs to be built? What needs to be modified? What conflicts with the vision? This becomes the input for planning.

5. **4-pass user story session** — before `/plan`, run the 4-pass method to convert the gap analysis and vision into user stories with acceptance criteria, organized into epics. Full method in `brain-SESSION-START.md` §5. Output goes to `/docs/stories.md`.

6. **`/plan` from the stories** — run plan mode with the story set and gap analysis as input. Explicitly instruct: *"Produce a milestone plan where each milestone maps to an epic. Break epics into work-tree-safe modules without file conflicts. Make dependencies between milestones explicit. Identify what can run in parallel."* Output goes to `/docs/build-plan.md`.

7. **Sub-plan in each work tree** — when executing a module, spin up a work tree using `./scripts/create workspace.sh feature-name`, then run `/plan` again inside that work tree session. Each work tree receives the vision doc, its epic's stories and acceptance criteria, and the full build plan for dependency awareness.

This sequence replaces the typical wedge. The foundation exists. The work is understanding it, finding the gaps, and planning precisely before building.

### The Full Build Sequence (Post-Wedge)

**Step 1: Top-level `/plan`.**
With vision doc, gap analysis, story set (`/docs/stories.md`), and inspiration in context, run `/plan`. Produce a milestone-level plan where each milestone maps to an epic from the story doc. Keep the top-level plan at milestone altitude — roughly: Phase 0 POC, Core PM enhancements, Canvas Layer, Resourcing Layer, Portfolio View. Dependencies between milestones must be explicit. Things that can run in parallel must be identified. Output to `/docs/build-plan.md`.

**Step 2: Identify what can run in parallel.**
Before spinning up work trees, confirm which modules won't touch the same files. When in doubt, ask Claude to confirm. Merge conflicts are avoidable with upfront thinking. Tim's max is four parallel work trees. Two is typical. Start with one or two until the process is comfortable.

**Step 3: Create work trees.**
For each parallel module, create a work tree:
```
cd scripts
./create workspace.sh feature-name
```
In plain English: this creates a fresh, fully set-up copy of the codebase in its own folder. It has its own Claude Code session, its own context, and works on one feature in isolation. Work trees are islands — they don't communicate with each other.

**Step 4: Sub-plan inside each work tree.**
In each work tree's Claude Code session, run `/plan` again. This breaks the module down into its own steps, tasks, and sub-tasks. Execute against this sub-plan.

**Step 5: Compact aggressively.**
Compact after finishing a feature. Compact after fixing a bug. Compact any time you're shifting trains of thought. Context thresholds:
- **60%** — start thinking about wrapping up
- **70%** — definitely wrapping up
- **80%** — should already be done; auto-compaction could hit at any moment

To check: `/context`. To compact: `/compact`.

Plan mode tracks task completion natively through compaction. Brain docs are for vision and cross-session context — not mid-build progress tracking.

**Step 6: Test, feedback, fix.**
When coding is done, run `/compile` then test in the browser. Come back with feedback. Fix bugs. Compact after every bug fix — fresh context is worth the 60 seconds.

**Step 7: `/push` when a module is done.**
When a feature is complete and tested, run `/push`. This stages changes, writes atomic commit messages, pushes to GitHub, and creates a PR. Review the PR in the main thread, merge into main, kill the work tree terminal, pull the updated main branch, and create a new work tree off updated main for the next feature.

**The "button up" / "wrap up" checklist:**
1. Update brain docs (vision doc if intent changed, rules if process changed, session-start with current state)
2. Confirm all changes have atomic commits — no uncommitted work left
3. Run `/push` to create PR
4. Confirm PR is ready to merge
5. Compact the session

---

## Git: Plain English Guide

Git is version control. In plain English: it tracks every change made to the code, lets you roll back if something breaks, and lets multiple people (or multiple agents) work on the same codebase without overwriting each other.

### The concepts you need

**Repository (repo):** The project folder that Git is tracking. The _R1 fork is the repo.

**Branch:** A parallel version of the codebase where you can make changes without affecting the main version. Think of it like a copy of the project you can safely experiment on. When you're done, you merge it back.

**Main branch:** The stable, production-ready version of the code. Never work directly on main. Always work on a branch and merge in when done.

**Work tree:** A separate folder that contains a branch of the repo, fully set up and ready to run. Tim's `create workspace.sh` script creates these automatically. Each work tree is one branch, one feature, one Claude Code session.

**Commit:** Saving a snapshot of your current changes with a message describing what you did. Atomic commits mean one logical change per commit, with a clear message. Format: `feat: add client creation form` or `fix: resolve dependency cascade bug`. This is how Tim's process works and it's non-negotiable.

**Pull request (PR):** A formal request to merge your branch into main. It lets you review the changes before they become permanent. `/push` creates this automatically.

**Merge:** Combining your branch's changes into main. After merging, the feature is in the stable codebase.

**Rebase:** Updating your branch with the latest changes from main before merging. Keeps history clean. Do this before creating new work trees: pull main, rebase if needed, then create the new work tree off the updated main.

**Merge conflict:** When two branches changed the same part of the same file in different ways and Git can't automatically decide which version to keep. You have to resolve it manually. This is why work trees are isolated to features that don't touch the same files — upfront planning prevents most conflicts.

### Tim's Git Workflow — Step by Step

1. All feature work happens on a branch, never directly on main
2. Create a work tree for each feature using `./scripts/create workspace.sh feature-name`
3. Work in that work tree — sub-plan, build, test, compact as needed
4. When the feature is done and tested, run `/push` — atomic commits, PR created automatically
5. Review the PR in the main Claude Code thread
6. Merge the PR into main
7. Kill the work tree terminal
8. In the main thread: pull down the updated main, rebase if needed
9. Create a new work tree off the updated main for the next feature
10. Repeat

### Claude Code commands — plain English

| Command | What it does |
|---|---|
| `/plan` | Activates plan mode — a PM/product owner agent that asks questions then produces a structured execution plan with milestones, tasks, and dependencies |
| `/compact` | Compresses current context and starts fresh — use aggressively |
| `/context` | Shows how full the context window is as a percentage |
| `/code-review` | Runs the 5-step code review skill |
| `/pr-ready` | Runs the 7-step PR readiness check |
| `/atomic-commits` | Breaks changes into logical atomic commits |
| `/update-docs` | Checks if code changes need documentation updates |
| `Shift+Tab` | Cycles between modes (plan mode, bypass permissions mode, etc.) |
| `pnpm dev` | Starts the local dev server so you can see the app in a browser while building |
| `pnpm build` | Production build — catches TypeScript errors, broken imports |
| `pnpm test:run` | Runs all tests once |
| `pnpm lint` | ESLint check |

---

## Skills (Built and Backlog)

Built skills live in `.claude/skills/`. They load on demand, not at session start.

**Built:**
- `/code-review` — 5-step code review (DRY, prop drilling, hooks/context, test coverage, interactive fixes)
- `/pr-ready` — 7-step PR readiness check (debug statements, DRY, component structure, prop drilling, quality, fixes)
- `/atomic-commits` — break changes into logical atomic commits, each builds independently
- `/update-docs` — check if code changes require documentation updates in `/docs`

**Backlog:**
- `/wrap-up` — update brain docs, confirm commits, push, create PR, compact
- `/hand-off` — summarize session state for pickup in a new session

---

## Key Decisions (Don't Re-Litigate)

| Decision | Choice | Why |
|---|---|---|
| Technical foundation | _R1 fork (AI Starter base) | Stack alignment, existing scaffolding, Tim's battle-tested approach |
| Database | Turso | Superbase breaks at parallel work tree step |
| Resourcing model | Percentage-based, milestone-tied, flexible mixed model | Task-level hourly tracking is the Workday mistake |
| Dependency behavior | Offered, not automatic | The PM decides whether to cascade — "art not science" |
| Canvas element types | Connected + free-floating both first-class | Allison uses both; requiring a project hook kills the storytelling use case |
| Open Brain vs this | Separate projects | Open Brain is personal task wrangling. This is agency PM tooling. Do not conflate. |
| Thought partner environment | Claude Code with skip permissions | Not exclusively claude.ai — Claude Code is faster and the TP can deploy agents from there |
| Pre-build sequence | Research → Inspo review → INIT → Gap analysis → /plan → work trees | _R1 has a foundation; discovery before building is non-negotiable |

---

## Lessons and Rules

*This section grows as we build. Every mistake, constraint, or hard-won lesson goes here.*

### RULE: Explain git before executing
**Symptom:** Jason doesn't know what a git operation does and can't catch errors.
**Root cause:** Assumed knowledge of git conventions.
**Rule:** Before any git operation, explain in one sentence what it does and what could go wrong. Jason should be able to repeat back what the operation does before it runs.

### RULE: Vision doc is the intent layer — don't put build process there
**Symptom:** Vision doc becomes cluttered with methodology.
**Root cause:** Mixing intent (what we're building) with process (how we're building it).
**Rule:** Product intent goes in the vision doc. Build process goes in rules. Cross-reference, don't duplicate.

### RULE: Pass preambles to every deployed agent
**Symptom:** Sub-agents make destructive or out-of-scope changes without checking.
**Root cause:** No guardrails passed at dispatch.
**Rule:** Every agent or sub-agent deployed by the thought partner must receive both the safety preamble and efficiency preamble at dispatch. No exceptions.

### RULE: Atomic commits are non-negotiable
**Symptom:** Large, messy commits that are hard to roll back or review.
**Root cause:** Batching unrelated changes into a single commit.
**Rule:** One logical change per commit. Clear prefix (feat/fix/chore). If you can't describe the commit in one short sentence, it's not atomic enough — split it.

---

### RULE: TP pre-plans, CC executes — never cross the line
**Symptom:** TP entered plan mode, built a plan, then immediately created a branch and launched agents to write code.
**Root cause:** Plan approval was treated as execution approval.
**Rule:** TP designs the work (brainstorm, research, architecture, edge cases). The output is a pre-plan document. CC receives that pre-plan, enters /plan mode, formalizes it against the actual code, and executes after operator approval. TP never writes code, creates branches, or launches build agents.

### RULE: Pre-plan structure for CC handoff
**Process:** TP builds a pre-plan with phased checkpoints. Each phase has mechanical checks (tests, build, lint) baked in. CC is told to STOP after each phase and wait for operator review. Behavioral verification (live testing, edge case proofs) is held out — TP runs it after CC delivers. This prevents CC from optimizing for passing checks rather than doing the right fix. See `reference_preplan_prompt.md` in memory for the full template.

### RULE: Quality gate skills are operator-invoked only
**Symptom:** CC runs /code-review on its own output and optimizes for passing rather than quality.
**Root cause:** Tim set `disable-model-invocation: true` on skill files for this reason.
**Rule:** `/code-review`, `/atomic-commits`, `/pr-ready` are run by Jason, never by CC. CC prompts end with `pnpm test:run`, `pnpm build`, `pnpm lint` only. CC can READ skill files to learn quality standards, but never invoke them.

---

*Rules file status: Fourth draft, April 9, 2026. Added TP/CC separation rules, pre-plan process, and quality gate ownership. Full audit of this file + brain-SESSION-START + CLAUDE.md planned before Phase 1.*
