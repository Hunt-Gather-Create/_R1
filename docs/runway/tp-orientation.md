# Runway TP orientation: the reference layer moved out of CLAUDE.md

CLAUDE.md holds only the rules that must win over memory and fire without a lookup. This file holds the why, the history, and the how-to that used to sit beside them. Read it when a rule in CLAUDE.md needs its reasoning, or on the first session in a new seat. Moved out 2026-09-13, following the Ops seat's split under opeff#580.

## Navigation map

| If the task needs | Read |
|---|---|
| Strategic context, why X exists | `VISION.md` |
| An architectural or operational call | `DECISIONS.md` |
| Picking up an item, filing work, phase planning | `ROADMAP.md` and GitHub Issues on jasonburks23/_R1 |
| Re-orienting to project state | `STATUS.md` |
| Executing a feature with a design | `docs/plans/<feature>.md` |
| Subsystem behavior, debugging, patterns | `.claude/MEMORY.md` |
| Architecture and module map | `docs/runway.md` |
| The reasoning behind any rule in CLAUDE.md | this file |
| React and Next.js performance | `.claude/skills/vercel-react-best-practices/` |
| Cross-fork Vercel preview | `.claude/skills/canary/SKILL.md` |
| Prod data writes | `.claude/skills/data-integrity-tp/SKILL.md` |
| Visual QA against production | `.claude/skills/runway-visual-qa/SKILL.md` |
| Git hooks, the refused commit, the certifier | `docs/runway/git-hooks-sop-reference.md` |

## Commands

```bash
pnpm dev              # Dev server at localhost:3000
pnpm build            # Production build. Connects to two live Turso databases; do not run casually.
pnpm test:run         # Tests, single run
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm runway:smoke     # Playwright smoke tests against runway.startround1.com

# Runway database, separate Turso instance, needs RUNWAY_DATABASE_URL in .env.local
pnpm runway:generate  # Generate migrations
pnpm runway:push      # Push schema to Turso, dev flow, sources .env.local
pnpm runway:schema-push # Deploy-time schema push, prod-gated via VERCEL_ENV, runs first in pnpm build
pnpm runway:studio    # Open Drizzle Studio
pnpm runway:pull      # Pull prod data to local
pnpm runway:gantt     # Render Gantt CLI
pnpm runway:sheet-sync # Sheet to Runway diff report, read-only
```

## Post-build pipeline, in order, before a push

1. `/gsd:code-review`, alias `/code-review`
2. `/update-docs` if patterns or versions changed
3. `/pr-ready`
4. `/preflight`: build, grep gate, tests, lint
5. `/canary` for runway-targeted PRs
6. `/atomic-commits`
7. CC pushes to the fork through the real hook and opens the PR; the operator merges.

## Why the rules live in CLAUDE.md and the lessons live here

A practice that lives only in memory loses to a written instruction that says otherwise, every time. CLAUDE.md is injected each session as authoritative; memory arrives as background context that says it is not an instruction. When the two conflict the file wins by construction. The dispatch section of CLAUDE.md once said all work goes to subagents, and four PRs got built without the bots ever being opened. If a decision should change what you do, it goes in CLAUDE.md. A lesson goes in Hemingway. A why goes here.

## The cross-repo close keyword

`Fixes jasonburks23/_R1#<n>` in a PR body is the intent, not the closing step. It fires on some merges and not others. Five shipped tickets sat open this way in August, jasonburks23/_R1#113, and seven more on 2026-09-11 and 12. After a merge, check the issue and close it by hand with the merge commit cited.

## Capping the agent loop, not the tool

`maxUses` is a parameter on Anthropic's own built-in tools and is only valid there; see `anthropic.tools.webSearch_*` in `src/app/api/brand/research/route.ts`. The AI SDK's `tool()` helper does not expose it, so the custom tools in `bot-tools.ts` cannot take it. Cap with `stopWhen: [stepCountIs(N)]`, as `src/lib/slack/bot.ts` does. An older rule said to cap tool usage with `maxUses`, which cannot be done for custom tools and produced jasonburks23/_R1#34 asking for work that cannot be done.

## Dispatch routing, the why

Operator, verbatim, 2026-08-26: "use them as part of protocol for coding tasks and gate 1 qa." Standing seats, not per-ticket subagents. Operator, 2026-08-26: "just be sure you follow up with your bots regularly." Do not dispatch and drift. Anchor any watcher on the last event id actually observed, never on a guessed timestamp. An unacked dispatch did not happen.

`etc/fleet-seat-registry.json` at agencyos-operational-efficiency is the source of truth for the three pubkeys and the room. Anything else holding a copy, `~/.claude/skills/buzz-agent-stats/seats.json`, this file, a chat relay, is downstream and syncs from it. A relay plus an attestation about the relay is still a relay. Re-verify with `buzz channels members --channel 46290a49-2e54-40a9-99ec-f79652a83337`, which returns role `bot` for the two bots; never from memory or from another seat's copy. A seeded config once confused the CC room with the Overwatch room; a dispatch fired into the wrong one lands as a record that wakes no bot.

Runway CC accepts messages from this seat only; its `respond_to` allowlist has one entry. That is deliberate: this seat owns its own bots. QA-Scout-1's allowlist is wider, eight seats. Both were misconfigured on 2026-08-26 and silently dropped every dispatch until repaired. A bot that cannot hear you looks exactly like a bot ignoring you.

## How to actually run the room

Full how-to, git-tracked and permanent: `agencyos-operational-efficiency/docs/standards/build-bay-playbook.md`.

**CC is serial, and that is a choice.** Measured 2026-09-02 by asking it directly. Every ticket that session went through its full lifecycle, worktree through push through report, before it opened the next one. It has a subagent tool and has never used it, and it declined to claim a number it had not observed. An older line here said CC runs about ten threads at once; that was never measured and survived because everyone repeated it. Serial is how CC keeps its RED-then-GREEN proofs in one unbroken thread. If that is ever tested, re-measure and rewrite the CLAUDE.md line with the evidence.

**One thread per ticket.** The first message about a ticket is its root; keep the `event_id` the send returns and reply into it with `--reply-to <root>`. Read one ticket in order with `~/.claude/skills/buzz-agent-stats/scripts/read-thread.sh <room> <root>`.

**Send from a script file, never inline.** The secret-echo guard blocks any command line that expands a `*_NSEC` or `*_KEY` variable. Since 2026-09-13 a second guard refuses a hand-typed clock time in a send; route through `~/.claude/buzz-send.sh`, which stamps `{{UTC}}` at send time.

**The gate clone points at upstream, never at the fork.** Every gate dispatch carries this block verbatim, and the reason is that the right answer has to be the default one. A gate seat builds a fresh throwaway clone to review in a clean room. If it clones `jasonburks23/_R1`, the only trunk it can see is the fork's `runway`, which no merge ever updates, because our PRs land on `Hunt-Gather-Create/_R1:runway`. The fork's copy was 17 merges stale on 2026-09-23. Nothing about that is visible from inside such a clone: there is no `upstream` remote to compare against, so a careful seat reading the only branch in front of it still reports the wrong base.

That single cause produced four findings in one week: QA-Scout-1's false 23-dash count on #153, a false base-ancestry refusal on #184, a gate-2 block on #160 claiming sixteen ungated tickets were stacked on the branch when all sixteen were already on trunk, and a withdrawn alarm that a merged branch had been deleted without merging. Three of those were caught only because someone re-derived the number own-hands. Naming `upstream/runway` by hand in each dispatch was the earlier fix and it failed three times, because it asks a seat to remember a thing that costs effort while the wrong answer costs none.

Clone upstream, then pull only the branch under review off the fork:

```sh
git clone --single-branch --branch runway https://github.com/Hunt-Gather-Create/_R1.git <dir>
cd <dir>
git remote add fork https://github.com/jasonburks23/_R1.git
git fetch fork <branch-under-review>
git checkout -b <branch-under-review> fork/<branch-under-review>
```

Now `origin/runway` IS trunk, so the default is correct and `git merge-base origin/runway HEAD` returns the real base. The stale copy is still reachable as `fork/runway`, labelled in a way no one mistakes for trunk. Measured 2026-09-23: the clone takes 1.4 seconds and 5.6 MB, so cost is not a reason to skip it. `--single-branch` leaves no `origin/HEAD`, which is harmless because the checkout already sits on `runway`.

Two things this does NOT fix, so do not let it read as a full cure. A clone of upstream sees upstream's default branch `main`, not `runway`, unless `--branch runway` is passed, and a gate that omits it lands on the wrong trunk with no warning at all. And the fork's own `runway` stays stale until someone fast-forwards it; nothing here depends on that any more, which is the point, but a PR diff read in the GitHub web UI still does.

**Fire QA in-thread the moment a build lands**, so building and checking overlap. Verify the branch on origin yourself first; never take a done-report on its face. Never give QA-Scout-1 a build; a seat that writes the code cannot be the independent check on it, and it is right to refuse.

**Envelope headers.** PROTOCOL Rule 23, Overwatch ruling 2026-09-05, opeff#920. Nine legal states: `CLAIMED`, `BUILDING`, `G1_QUEUED`, `G1_BOUNCE`, `G2_QUEUED`, `G2_BOUNCE`, `MERGE_OWED`, `MERGED`, `CLOSED`. Asserting a state: `@Name [_R1#N | G1_BOUNCE]`. Asserting none: `@Name [_R1#N]`, no pipe and no word; a bracket with a pipe reads as a state claim, which is how 87 of one seat's headers and 19 of this seat's parsed as malformed while looking fine. Do not map free text onto the nearest legal word: `PASS` is not `MERGED`, `DONE` is not `CLOSED`. `MERGED` and `CLOSED` never occur in this room because merge is the operator's and close is Holdout's; do not manufacture a closing envelope to feed a parser. Going forward only; do not retrofit old headers.

**Telling whether a bot is working.** Use the `buzz-agent-stats` skill: `scripts/check-agent.sh <bot_hex> <room>` for presence, config, and last words with age; `scripts/read-thread.sh` for one ticket in order; `scripts/fetch-stats.sh` for token and turn telemetry. A recent message is the only reliable proof of work. Presence `online` proves the process started, nothing more. CPU proves nothing. `--since` windows lie by omission; fetch by `--limit` and read real timestamps. This seat has had it wrong in both directions: a silent room read as two dead bots when a config gate was eating the mail, and a peer's frozen counter read as a dead clerk when it was only lagging.

## Reporting line, the history

Operator, verbatim, 2026-08-27: "If you get a directive from Overwatch, you take direction from Overwatch so, you do not need to check with Operator, Overwatch is who you report to long term."

The conflict case: on 2026-08-26 Overwatch's repo said pages route through it while the operator-installed `operator-fence` skill couples a red fence to its page. Overwatch withdrew its instruction and routed the conflict to the operator. Two operator-authored instructions in conflict is the operator's call.

Verify before acting on a peer measurement. Overwatch has published numbers that did not survive a second sample. Reproduce a finding own-hands before paging or bouncing on it. A claim that confirms the shape you are already hunting is the one that gets waved through.

## Memory rules, this repo's local knowledge store

`.claude/MEMORY.md` is the knowledge layer, observed patterns and gotchas; `DECISIONS.md` holds
locked architectural calls, not `MEMORY.md`. When a non-obvious pattern or gotcha turns up: add it
to `MEMORY.md` under the existing Scripts, Patterns, or Gotchas headings, one to two lines each;
if it is a locked decision, add a `DECISIONS.md` entry instead and reference it; remove entries
that go stale. This is separate from Hemingway, the fleet's shared memory tool.

## Git hygiene, where the detail lives

The recipe, the refused commit, and the certifier output: `docs/runway/git-hooks-sop-reference.md`. The plan behind the three gate gaps and the tickets that close them: `docs/plans/git-sop-gate-coverage-plan.md`. Every ref retired in the 2026-09-11 and 12 cleanup, with its sha: `docs/git-archive/INDEX.txt`. The fleet standard: `agency-os/docs/sops/git-hygiene-v2.md`.

## Where things were before

Nine-layer planning structure, PR #105 on 2026-05-24: CLAUDE.md is layer 0, VISION.md layer 1, DECISIONS.md layer 2, `.claude/MEMORY.md` layer 3, then STATUS.md, ROADMAP.md, docs/plans, docs/runway.md, and the skills. The per-fact auto-memory files that once sat beside this seat were migrated into Hemingway on 2026-09-11 and archived on 2026-09-13; the map is `.tp/HEMINGWAY-LEDGER-2026-09-11.tsv`.
