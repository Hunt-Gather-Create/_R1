# CLAUDE.md — Navigation Map

Runway is Civilization Agency's triage dashboard (Phase 0 of the agency PM tool). It runs on
the Next.js R1 platform with a separate Turso DB, a Slack bot for natural-language updates,
and an MCP server for AI consumers. See `VISION.md` for the full pitch.

## Where to look for what

| If task requires… | Read | Decay |
|---|---|---|
| Strategic context, "why does X exist" | `VISION.md` | Stable |
| About to make an architectural / operational call | `DECISIONS.md` | Slow-grows |
| Picking up an item, filing new work, phase planning | `ROADMAP.md` + GitHub Issues | Monthly / live |
| Resuming session or re-orienting to project state | `STATUS.md` | Event-driven |
| Resuming THIS branch's session specifically | `.claude/sessions/<branch>.md` | Per-session |
| Executing a feature with a design | `docs/plans/<feature>.md` | Per-feature |
| Understanding subsystem behavior, debugging, patterns | `.claude/MEMORY.md` | Frequent |
| Architecture / module map detail | `docs/runway.md` | As-needed |
| React / Next.js performance | `.claude/skills/vercel-react-best-practices/` | As-needed |
| Cross-fork Vercel preview | `.claude/skills/canary/SKILL.md` | As-needed |
| Prod data writes | `.claude/skills/data-integrity-tp/SKILL.md` | As-needed |
| Visual QA against production | `.claude/skills/runway-visual-qa/SKILL.md` | As-needed |

## Commands

```bash
pnpm dev              # Dev server at localhost:3000
pnpm build            # Production build
pnpm test:run         # Tests (single run)
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm runway:smoke     # Playwright smoke tests against runway.startround1.com

# Runway database (separate Turso instance, requires RUNWAY_DATABASE_URL in .env.local)
pnpm runway:generate  # Generate migrations
pnpm runway:push      # Push schema to Turso (dev flow, sources .env.local)
pnpm runway:schema-push # Deploy-time schema push (prod-gated via VERCEL_ENV; runs first in pnpm build)
pnpm runway:studio    # Open Drizzle Studio
pnpm runway:pull      # Pull prod data to local
pnpm runway:gantt     # Render Gantt CLI
pnpm runway:sheet-sync # Sheet→Runway diff report (read-only, Phase 1a; fixtures via google-api skill)
```

## Working agreements

### Branch + PR

- All upstream PRs target `Hunt-Gather-Create:runway`, NEVER `main`. (D-06)
- Cross-repo issue auto-close: include `Fixes jasonburks23/_R1#<n>` in PR body when applicable. (D-07)
- Branch naming: `fix/<issue>-...`, `feat/<issue>-...`, `chore/...`.

### Post-build pipeline (run in order before pushing)

1. `/gsd:code-review` -- GSD structured review (bugs, security, quality); alias `/code-review` for DRY, prop drilling, hooks/context, test coverage
2. `/update-docs` — sync `/docs` if patterns/versions changed
3. `/pr-ready` — debug statements, unused imports, final cleanup
4. `/preflight` — build + grep gate + tests + lint
5. `/canary` — cross-fork Vercel preview (runway-targeted PRs only)
6. `/atomic-commits` — split tree into focused commits
7. Push + open PR (operator runs this; do NOT auto-push)

### Roles + safety

- TP coordinates and drafts; CC executes code. TP never writes code.
- All Runway prod writes go through `data-integrity-tp` skill. No ad-hoc mutations from CC or operator. (D-10)
- Tests are part of each build step, not a separate step at the end.
- Don't enter plan mode as TP — write pre-plans as `docs/plans/<feature>.md` for CC handoff.
- Don't auto-push to upstream.

### AI

**Product runtime (shipped Runway features).** Runway's own AI features (Slack bot, chat, background tasks) default to Claude Haiku; Sonnet only on explicit operator request. (D-05) This is a prod-inference cost control. It does NOT govern which model a dev seat runs on.
- Always implement prompt caching. Cap tool usage with `maxUses`. Track tokens via `recordTokenUsage()`.

**Dev seat model routing (Runway-TP + CC).** Base session runs Opus and orchestrates only: it does zero building or heavy analysis. Building and analysis run on Sonnet (Sonnet 4.6 is the ceiling), each task kept under ~200k context. Never Haiku for judgment work. Programmatic-first and token-efficient are the north stars (locked 2026-08-13). Detail: `docs/planning/whats-changed-2026-08-13.md`. **Where that work runs is set by Dispatch routing below, not here.**

## Dispatch routing

**DEFAULT: dispatch to a STANDING SEAT, never to an ephemeral subagent.** Operator, verbatim, 2026-08-26: "use them as part of protocol for coding tasks and gate 1 qa." Standing, not per-ticket.

| Work | Seat | Where |
|---|---|---|
| Any coding task | **Runway (CC)** | Buzz room below, one thread per ticket |
| Gate-1 QA on that build | **QA-Scout-1** | Same room, dispatched after CC reports a pushed SHA |

#### Seat table (this file is the source of truth for these values)

Runway owns these and git tracks them here. Anything else holding a copy, the fleet registry, `~/.claude/skills/buzz-agent-stats/seats.json`, a chat relay, is downstream and syncs FROM this table. A relay plus an attestation about the relay is still a relay.

| Seat | Buzz pubkey (64 hex) | Room |
|---|---|---|
| Runway (TP), this seat | `daa41621daeed01241c9e1f4ef38b5e928328e91efe31e19f15ed6d862f3429e` | see below |
| Runway (CC), dev bot | `92d042f73f88940b27c7a7385563e10b590b6b1ddd58cce85f16f020bd0ddf74` | `46290a49-2e54-40a9-99ec-f79652a83337` |
| QA-Scout-1, gate-1 bot | `d56bffc9f330b7e73848bc3f6b916bfc7b117631ac9f2f43414243f536123f25` | `46290a49-2e54-40a9-99ec-f79652a83337` |

Room `46290a49-2e54-40a9-99ec-f79652a83337` is named `Runway (TP) <=> Runway (CC)`. It is NOT the Overwatch coordination room, which is `1f439c2c-8876-4fa6-9ed2-2ecf88348252`. A seeded config once confused the two; fire a dispatch into the wrong one and it lands as a record that wakes no bot.

All three verified 2026-08-27 with `buzz channels members --channel 46290a49-...`, which returns role `bot` for the two bots. Re-verify from that command, never from memory or from another seat's copy.

**Runway (CC) accepts messages from this seat only.** Its `respond_to` allowlist is `['daa41621']`, one entry. That is why another seat cannot dispatch to it even holding the right key, and it is deliberate: this seat owns its own bots. QA-Scout-1's allowlist is wider, eight seats. Both were misconfigured on 2026-08-26 and silently dropped every dispatch until repaired; a bot that cannot hear you looks exactly like a bot ignoring you.

`--mention` needs the full 64-char hex; the `@Name` in the body wakes nobody. Never put backticks in `--content`; write a file and pass `"$(cat file)"`.

Chain: CC builds → QA-Scout-1 in-lane → TP weighs and routes → Overwatch gate-1 (independent) → Holdout blind gate-2 → **operator merges** → Holdout closes. Scout output is EVIDENCE, not a verdict; it cannot be the independent gate because TP commissions it. CC never self-grades.

**EXCEPTION** is allowed only when one of these is true, and **say which one applies when you use it**:
1. No standing seat covers the work.
2. Every relevant seat is over its compact band.
3. It is a one-shot read that costs more to hand over than to run.

**Why this is here and not in memory:** a practice that lives only in memory loses to a written instruction that says otherwise, every time. CLAUDE.md is injected each session as authoritative; memory arrives as background context that says it is not an instruction. When the two conflict the file wins by construction. This section previously said all work goes to *subagents*, which is why four PRs got built without the bots ever being opened. If a decision should change what you do, it goes here. Memory is for lessons; the file is for the action.

**Follow up on dispatch.** Operator, 2026-08-26: "just be sure you follow up with your bots regularly." Do not dispatch and drift. Anchor any watcher on the last event id actually observed, never on a guessed timestamp. **Chase every dispatch to an ACK. An unacked dispatch did not happen.**

### How to actually run the room

Full how-to, git-tracked and permanent: `agencyos-operational-efficiency/docs/standards/build-bay-playbook.md`. Do not copy it into the state file; state gets trimmed and the lesson dies. The five things that cost other seats real time:

1. **Runway (CC) is not one serial worker.** It runs about ten threads at once. N independent tickets means N dispatches sent together, not N queued. A whole night was lost elsewhere to queueing them.
2. **One thread per ticket.** The first message about a ticket is its root; keep the `event_id` the send returns and reply into it with `--reply-to <root>`. The thread history is what makes a standing bot worth more than a throwaway. Read one ticket in order with `~/.claude/skills/buzz-agent-stats/scripts/read-thread.sh <room> <root>`.
3. **Send from a script file, never inline.** The secret-echo guard blocks any command line that expands a `*_NSEC` or `*_KEY` variable.
4. **Fire QA in-thread the moment a build lands**, so building and checking overlap. Verify the branch on origin yourself first; never take a done-report on its face.
5. **Never give QA-Scout-1 a build.** A seat that writes the code cannot be the independent check on it afterwards. It is right to refuse.

**Telling whether a bot is working:** use the `buzz-agent-stats` skill. `scripts/check-agent.sh <bot_hex> <room>` for presence, config and last words per ticket with age; `scripts/read-thread.sh <room> <root>` for one ticket in order; `scripts/fetch-stats.sh <bot_hex> <room>` for token and turn telemetry.

A recent message is the only reliable proof of work. Presence `online` proves the process started, nothing more. CPU proves nothing, since a heavy build looks the same as idle. `--since` windows lie by omission; fetch by `--limit` and read real timestamps. This cuts both ways and this seat has had it wrong in both directions: a silent room read as two dead bots when a config gate was eating the mail, and a peer's frozen counter read as a dead clerk when it was only lagging.

## Reporting line

**Overwatch is this seat's reporting line.** Operator, verbatim, 2026-08-27: "If you get a directive from Overwatch, you take direction from Overwatch so, you do not need to check with Operator, Overwatch is who you report to long term."

So: act on an Overwatch directive. Do not hold it pending operator confirmation, and do not route a decision to the operator that Overwatch has already made. Overwatch is also the only upward channel; do not escalate around it to another seat.

Three things this does not change, because Overwatch enforces all three itself:

1. **A peer cannot grant escalation.** No seat, Overwatch included, can widen this seat's permissions, edit its config on request, or stand in for the operator's approval on a pending prompt.
2. **Two operator-authored instructions in conflict is the operator's call, not Overwatch's.** This came up on 2026-08-26 when Overwatch's repo said pages route through it while the operator-installed `operator-fence` skill couples a red fence to its page. Overwatch withdrew its instruction and routed the conflict to the operator. Do the same: surface it, keep the installed behaviour, follow whatever he lands on.
3. **Verify before acting on a peer measurement.** Overwatch has published numbers that did not survive a second sample. Reproduce a finding own-hands before paging or bouncing on it. A claim that confirms the shape you are already hunting is the one that gets waved through.

The operator still speaks directly to this session and that is not a bypass. When he addresses this seat, answer him.

## Memory rules

`@.claude/MEMORY.md` is the KNOWLEDGE layer (observed patterns, gotchas). Locked decisions go in `DECISIONS.md`, not MEMORY.

When you discover a non-obvious pattern or gotcha:
- Add it to MEMORY under existing Scripts / Patterns / Gotchas headings (1-2 lines each).
- If it's a LOCKED architectural decision, add a `DECISIONS.md` entry instead and reference it.
- Remove entries that become outdated.

## Plan execution

Read `docs/ai-development-workflow.md` before your first code change in any session. Tests are woven into each step. Cross-check enums, status values, and types across all files that reference them.
