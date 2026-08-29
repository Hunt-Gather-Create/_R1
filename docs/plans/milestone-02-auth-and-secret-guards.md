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

## Tracking, from the same source

A recent message is the only reliable signal. Presence lies and CPU lies. Chase every dispatch
to an ACK; silence past 30 to 45 minutes gets investigated rather than assumed heads-down.
Require a fixed report shape, so a degraded report is visible as one: branch, tip SHA,
merge-base, `--numstat` diffstat, the mutation run with control before and after, and the exact
test command. Keep "built and waiting" a distinct state from "building".

There is no token telemetry gauge for a bot. Anyone who says there is, is wrong.
