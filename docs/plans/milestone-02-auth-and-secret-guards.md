# Milestone 02 — Auth and secret guards: one-shot execution plan

**Status:** DRAFT. Awaiting Overwatch's one-shot practice input and the operator walk.
**Author:** Runway (TP), 2026-08-29.
**Unit of execution:** this milestone, planned end to end and dispatched as parallel threads
into the Runway build bay. Not one ticket at a time.
**Waiter:** this seat. `#111` refuses every push from the main checkout, so the roadmap and
decision commits written today are stuck behind it. A milestone with no waiter is not this
month's work; this one has one, and it is blocking.

---

## Done when

No route in `src/app/api/**/route.ts` compares a secret with plain equality. The guard finds
auth routes by discovery instead of reading a hand-maintained list. The CI gate and the local
pre-push gate each report red, green, and never-ran as three distinct states. Holdout has
verified on merged main.

## Why this milestone runs before 01 Schedule Sync

Two reasons, both concrete rather than preference.

`#111` refuses every push from the main repo checkout. The guard walks the filesystem instead
of the git index, so it scans 19 gitignored migration scripts and fails on 81 call sites inside
them. Until it lands, every push from the main checkout needs `--no-verify`, which means the
gate is off for everyone who is not working in a worktree.

`#112` is a live defect in production. A shared secret compared with plain `!==` on an
attacker-controlled header. It is a timing leak and not a bypass, so it is not a fire, but the
fix is three lines and it has been sitting outside the guard's list the entire time we were
writing the guard.

01 Schedule Sync resumes the moment this milestone closes.

---

## Collision map

This is the part that decides the dispatch shape. Two threads on the same file at the same
time is a merge conflict I planned rather than discovered.

| File | Tickets that touch it |
|---|---|
| `src/lib/runway/token-compare-guard.test.ts` | #112, #109, #110 |
| `src/lib/runway/source-coverage.test.ts` | #111 |
| `src/app/api/runway/gantt-embed/route.ts` | #112 |
| `scripts/hooks/pre-push`, CI workflow | #107 |
| `proxy.ts` at the repo root | #88 |
| no code | #90 |

**The guard test file is the contention point.** Three tickets rewrite it, so those three are
strictly serial. Everything else is genuinely independent.

`#107` is listed separately from `#111` on purpose, and CC found the collision is worse than
different-files suggests. `package.json`'s `test:run` is bare `vitest run` with no path filter,
so the pre-push hook always runs the whole suite including `source-coverage.test.ts`. Any
worktree cut before `#111` lands inherits a red suite for a reason unrelated to `#107`, which is
precisely the false signal `#107` exists to fix. Sequenced after `#111`, and now for a
verified reason rather than a cautious one.

**CC checked this table against `upstream/runway` at `d1c65ff` and confirmed all five scopes.**
One correction, which was mine: `#88` is not `src/middleware.ts`. That file does not exist in
this tree. Next 16 renamed it and the file is `proxy.ts` at the repo root. The table above is
corrected. CC also flagged that `#88`'s ticket text might be stale for the same reason; I
checked and it is not, the body already says `proxy.ts` at line 5 and uses "middleware" only as
the concept word for `authkitMiddleware`. `#88` stays independent of everything in wave 1.

---

## Dispatch waves

### Wave 1 — three threads, fired together

| Ticket | Scope | Acceptance |
|---|---|---|
| #111 | Scan the git index, not the filesystem. `git ls-files` over `SCAN_DIRS`. | Plant a file matching an ignored glob containing a bare `createWeekItem({})` and assert the guard does **not** flag it. Then confirm the pre-push hook passes from the **main checkout**, not from a worktree. That distinction is the whole bug. |
| #112 | Add `gantt-embed` to `KNOWN_AUTH_ROUTES` **first**, watch the guard go red, **then** fix the route with `timingSafeTokenMatch`, watch it go green. | The red state must be observed and reported. A guard entry added after the fix proves nothing about whether the guard would have caught it. |
| #88 | JSON `/api/*` requests must not bypass session enforcement in authkit middleware. | A request with a JSON content-type and no session is rejected. Show the pre-fix request succeeding. |

Fire all three at once. **The reason is not the one this seat has been giving.**

`CLAUDE.md` states that CC "runs about ten threads at once" and that N tickets means N
dispatches, not N queued. Overwatch reports that the near-identical claim in its own always-
loaded file was root-caused as false today: an unverified property of a live instrument,
written down and then believed by everyone who read it. Its builder works its lanes in order.

Asked directly, CC gave the honest answer rather than the flattering one: **it cannot observe
its own cross-thread scheduling.** Within one turn it is strictly serial. Whether the harness
runs three ticket roots as three concurrent copies or queues them into one session is a
property of the dispatch layer that CC has no instrument to see. It declined to extend a fact
it does have, that it can fan out to subagents inside a turn, into a claim about how top-level
threads are scheduled.

So the ten-threads line is unverified, in this file and in the fleet's. **The correct reason to
fire all three at once holds either way: a ticket with a live thread knocks, and a ticket
without one does not exist to an event-driven bot.** Parallel dispatch beats serial dispatch
even when execution serializes, because the alternative is that ticket two does not exist until
ticket one finishes.

**Wave 1 is also the experiment.** Three roots inside one minute, then compare CC's reply
timestamps: interleaved means concurrent, start-to-finish in order means serial. That settles
the claim for the cost of watching a clock. The result goes to the operator, since correcting
`CLAUDE.md` is his call and not a peer's.

### Wave 2 — two threads, each gated on its wave-1 predecessor

| Ticket | Waits on | Scope |
|---|---|---|
| #109 | #112 landed | Delete `KNOWN_AUTH_ROUTES`. Discover routes by "reads a secret-shaped env var". Measured on today's tree: 3 true positives, 0 false positives, 0 false negatives. It would have caught #112. |
| #107 | #111 landed | Make red, green, and never-ran render distinctly in the PR gate. |

### Wave 3 — one thread

| Ticket | Waits on | Scope |
|---|---|---|
| #110 | #109 landed | A value rebound through a wrap and compared inside a helper needs local dataflow, not subtree taint. The largest ticket in the milestone and the only one that is genuinely hard. |

### Not a build

| Ticket | Owner |
|---|---|
| #90 | Operator. Secret rotation is an operations task and this seat cannot hold the credentials. |
| #108 | Already built, frozen at `8d286197`, with Overwatch for gate-1. Needs nothing from CC. |

---

## Gate chain, unchanged

CC builds → QA-Scout-1 in-lane gate-1 → TP weighs and routes → Overwatch gate-1, independent →
Holdout blind gate-2 → **operator merges** → Holdout closes.

Scout output is evidence, not a verdict. CC never self-grades. QA-Scout-1 never receives a build
it wrote, and it is right to refuse one.

Fire QA in the same ticket thread the moment a build lands, so building and checking overlap.
Verify the branch exists on origin own-hands first. A done-report is not evidence.

## Closing step, per #113

The `Fixes jasonburks23/_R1#<n>` keyword is the intent, not the closing step. After each merge,
verify the issue actually closed. Five tickets sat open for weeks this way.

## Dispatch shape, from Overwatch's answer

Every brief carries all six of these. CC cannot read GitHub issues at all, so a brief that
references a ticket by number without carrying its content gets refused, correctly.

1. **The decision is already made.** Where a builder could reasonably choose, choose. Offering
   three options is how you get a round trip, or all three built.
2. **Measurements in the brief, not just the ticket.** Exact file, exact line, exact current
   value, and how it was measured.
3. **Scope exclusions stated as loudly as inclusions.** Builders expand scope to be helpful.
4. **A done-when the defect cannot produce.** Not "tests pass": a green suite is producible by
   a broken system. Ask whether the evidence could still be produced if the bug were still
   there. `#111`'s acceptance turns on this, since green in a worktree is exactly what the bug
   produces.
5. **The anti-vacuity line, every time.** Test the call site, not the function. The dominant
   gate-1 failure in this fleet is a perfect, fully tested helper that nothing calls.
6. **The hazard line.** If a verification step can touch a real credential, database, or host,
   say so and name the isolated way to run it. A command whose safety depends on a prefix will
   be run without the prefix. Runway's prod database is one env var away from every migration
   script in the tree, and this seat has no hazard line anywhere today.
7. **The reply-opener.** Every message the bot sends back opens with `@Runway (TP)`, including
   the ACK. Operator instruction. Without it the messages do not render as addressed and the
   room reads as dead from his side, which happened during wave 1 across 35 messages and four
   builds. A seat that looks idle gets treated as idle.
8. **The voice rule.** No em dashes, no en dashes, no parentheses, anywhere a person can read.
   That scope explicitly includes **code comments**, commit messages, docs and ticket text. The
   only carve-out is AI-to-AI messages on Buzz. End the sentence or use a comma; a hyphen or a
   parenthesis substituted for a dash is the same tell wearing a different hat.
   Added 2026-08-29 after QA-Scout-1 caught eight em dashes across two otherwise clean branches.
   **That was a defect in this brief, not in the build.** The rule had never appeared in any
   dispatch I sent, so the bot could not have known it.

9. **The premise recheck, and it runs first.** Before building anything, the bot re-verifies the
   ticket's central claim against the code as it exists today, and reports CONFIRMED, CHANGED or
   GONE. A ticket whose premise is GONE gets closed, not built.
   Operator ruling 2026-08-29: tickets in this backlog were written weeks apart and things move
   fast, so a written finding is a claim about a past tree, not a fact about the current one.
   Cost that bought it: #88 and #118 both rested on #52's observation that the authkit login layer
   waves JSON requests through. Reading shipped authkit 2.13.0 showed its auth gate has no
   Accept-header branch at all. The one Accept check sits inside `isInitialDocumentRequest`,
   reached only when `eagerAuth` is on, and `eagerAuth` is set nowhere in our source. I had
   repeated the dead premise to the operator twice as fact before reading the package.
   This part is cheap and it runs before the expensive part, which is the whole argument for it.


10. **No git in the shared checkout, and check each command succeeded.** Every git operation
   belongs in the bot's own worktree or a disposable clone. `/Users/jasonburks/Documents/_AI_/_R1`
   is shared by several seats and holds this seat's own branch.
   Cost that bought it: CC ran `git checkout -b /bad-name upstream/runway` which failed on the
   leading slash, then ran `git merge --no-commit --no-ff origin/fix/116-sweep-negative-equality`
   in the same breath. The merge ran on whatever branch was already checked out, which was mine.
   It self-reported before continuing and aborted cleanly; nothing was lost, verified own-hands.
   Two rules, not one. A chained failure does not leave you somewhere safe, it leaves you
   somewhere unknown, so verify each command before running the next. And note the shape: the
   merge did not fail loudly. It SUCCEEDED, on the wrong branch, conflicts auto-resolved, a file
   staged. It looked like a working result. That is the same defect class as a guard that passes
   while pointed at the wrong repository.


## Two properties of the bay, learned 2026-08-29 at cost

**A dispatch can be delivered twice while being sent once.** Verified: event
`30d81bee` appears exactly once on the relay, and CC's second turn was handed that same event id
and timestamp, byte identical. The duplication happens between the relay and the agent runtime,
and neither seat can see into that layer.

The consequence is about ticket shape, not about the bug. `#111` survived because it is a no-op
on re-entry. **`#112` would not have.** Its acceptance is order-dependent: add the route to the
guard list first, observe the red, only then fix. A silent replay lands on a tree where the fix
already exists, so the red can never be observed, and the replay produces a green that proves
nothing while looking exactly like proof.

**Any ticket whose evidence is a before-state is unsafe under silent redelivery.** That is a
large class: every mutation proof and every non-vacuity control in this milestone. The mitigation
is not a code change. It is that a bot arriving at a finished ticket must verify, not redo, and
must say the ticket arrived twice. That turns a silent replay into an arriving message.

**A bot's turn context is a snapshot, so a standing rule cannot reach an in-flight turn.** The
handle rule was sent at 16:16:42Z. CC applied it on its next message at 16:24:10Z, then appeared
to drop it at 16:40 and 16:43. It had not. Those messages came from the replayed turn, whose
context held only the original 15:31:43Z dispatch. From inside that turn the rule did not exist.

**An in-flight turn is not governed by anything sent while it runs.** Not a correction, not a
stop, not a scope change. If a bot must be stopped mid-ticket, a message may do nothing until
that turn ends.

This interacts with the inline-content rule above. A brief that says "you need to fetch nothing"
is also saying "do not look for what changed since." That is correct for ticket content, because
CC cannot read GitHub at all. It is wrong for standing rules, and the fix is not to tell briefs
to fetch room history, which reintroduces the problem inline content solved. Know the property
instead.

## Tracking, from the same source

A recent message is the only reliable signal. Presence lies and CPU lies. Chase every dispatch
to an ACK; silence past 30 to 45 minutes gets investigated rather than assumed heads-down.
Require a fixed report shape, so a degraded report is visible as one: branch, tip SHA,
merge-base, `--numstat` diffstat, the mutation run with control before and after, and the exact
test command. Keep "built and waiting" a distinct state from "building".

There is no token telemetry gauge for a bot. Anyone who says there is, is wrong.
