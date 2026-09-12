# Git SOP gate coverage plan

Status: draft for Overwatch to pick from. Read-only research. No git commands were run that change anything.

## What this doc is for

The fleet git hygiene SOP lives at `Civilization-Skill-Suite/agency-os/docs/sops/git-hygiene-v2.md`. It sets the rules for keeping repos clean: commit often, dispose of dead branches, keep worktrees short lived, and never leave a dirty working tree at handoff.

The SOP has one automated gate today: a pre-push hook called `hygiene-guard.sh`, at `_R1/scripts/hygiene-guard.sh`. A pre-push hook is a script git runs right before it sends commits to GitHub. If the script says no, the push stops. This guard checks whether the branch or worktree being pushed is already fully merged into trunk, the shared main branch everyone trusts. If it is, the guard blocks the push and prints a disposal command, like `git branch -D <name>`.

That gate only wakes up when someone pushes from a local checkout, a folder on a laptop with a full copy of the repo and its history. It misses three shapes of mess this doc covers. For each one, this doc gives three options: a primary pick and two alternates.

## Background: what we know is true today

- GitHub issue jasonburks23/agencyos-operational-efficiency#1008 is the tracker thread for this whole effort. Read it with `gh issue view 1008 --repo jasonburks23/agencyos-operational-efficiency --comments`.
- A fleet census in that issue, corrected four times by three different seats before it settled, found **342 of 562 local branches fleet-wide, 60 percent, are already ancestors of trunk** and therefore invisible to the guard's disposal check.
- The same census found bot clones under `~/.buzz/REPOS` are far worse than operator working copies. Example: `~/.buzz/REPOS/civ-substrate` had 152 of 179 local branches invisible, 84 percent, spread across 192 registered worktrees sharing one branch list.
- The guard's blind spot has a root cause, not just a number. At `hygiene-guard.sh` line 1205, the guard only checks a branch further if it is "ahead" of trunk by at least one commit: `[ "$_ahead" -gt 0 ] || return 1`. A branch that was merged into trunk with a real merge commit, not squashed, becomes an ancestor of trunk. Ancestors show zero commits ahead, so the check returns before either fossil detector below it ever runs. The guard's own header comment, around line 1138, calls this a deliberate, defensible tradeoff, but it means: **in any repo where merges create merge commits, the disposal path can never fire on those branches. The guard reports clean forever.**
- Two other tools already exist and are worth reusing instead of building from scratch:
  - `install-hooks.sh`, opeff repo, `scripts/install-hooks.sh` on `origin/main`, wires a single checkout's `core.hooksPath` to the shared hooks folder. It must be run once per checkout. It does not run on clone, and it does not reach a checkout nobody has run it in.
  - `git-hygiene-certify.mjs`, same repo, same path, proves hooks actually fire, not just that they exist. Run alone it certifies one repo. Run with `--fleet` it walks the whole machine for every folder named `.git`, groups worktrees back to their shared repo using `git rev-parse --git-common-dir`, and picks one representative checkout per repo using the GitHub origin name, never a folder name someone could rename.
  - `fleet-health-check.mjs`, opeff repo, `scripts/fleet-health-check.mjs`, already runs at every Ops heartbeat with zero AI model calls. It already has drift detectors named things like GH01, ORPHAN01, ORPHAN02, and STALECO01 for stale checkouts. I could not read the STALECO01 detector's own logic in the time this doc took, so treat "does it already cover gap 3" as an open question, not a settled fact.

## Gap 1: merged branches left on GitHub

The guard only reads `refs/heads`, the list of local branches on one checkout. It never looks at what is sitting on GitHub itself, called a remote branch. A branch merged through a pull request stays on GitHub forever unless something deletes it.

### Option A, primary: turn on "automatically delete head branches"

GitHub has a per-repo setting, under Settings then General, that deletes a branch automatically the moment its pull request merges.

- **Catches:** every branch merged through the normal pull request flow, no matter which merge strategy GitHub used, squash, merge commit, or rebase.
- **Misses:** branches merged outside a pull request, for example a direct push merge from the command line. Does nothing for the local copies still sitting on someone's laptop.
- **Cost:** zero build cost. It is a checkbox per repo. No ongoing run cost.
- **Owner:** the operator owns GitHub repo settings per this repo's `CLAUDE.md`.
- **Risk:** very low. GitHub only deletes after a real merge, and a deleted branch is recoverable from the pull request page for a good while afterward. No chance of a false refusal, since this is cleanup, not a gate that can block real work.
- **Recommendation:** turn this on fleet-wide now. It is nearly free and closes most of the gap by itself.

### Option B, alternate: a new detector in fleet-health-check.mjs

Add a check, something like GH-MERGED-BRANCHES, that asks GitHub directly which branches belong to a merged pull request and flags any that still exist on the remote past some grace period, for example seven days.

- **Catches:** the same set as option A, plus it gives a visible before-and-after count for repos where the operator has not yet flipped the setting, or does not want automatic deletion.
- **Misses:** non-pull-request merges, same as option A.
- **Cost:** moderate. Needs new code and tests in an existing, well-tested file, reusing the heartbeat schedule that already exists.
- **Owner:** Ops, which already owns `fleet-health-check.mjs`.
- **Risk:** a branch kept on purpose after merge, for reference, could get flagged. The SOP already has language for this: a branch is either provably on main, intentionally in flight, or flagged for disposition, so a keeper convention already exists to lean on.
- **Recommendation:** good complement to option A, not a replacement. Build it if the operator wants a visible report before trusting automatic deletion everywhere.

### Option C, alternate: extend the guard with a remote-branch arm plus scheduled fetch

Run `git fetch --prune` on a schedule, then extend `hygiene-guard.sh` or a sibling script to run the same ahead-check against `refs/remotes/origin` instead of only `refs/heads`.

- **Catches:** remote branches that are ancestors of trunk.
- **Misses:** the exact same squash-merge blind spot as the local guard, since it reuses the same ahead-check logic. A squashed branch never becomes an ancestor, so this option would still miss it.
- **Cost:** higher than option B. Touches a load-bearing, heavily hardened script that already has a long list of known edge cases documented in its own comments.
- **Owner:** Initiative 5 authors and maintains the SOP's shared hook pack; Ops would run the schedule.
- **Risk:** changing a script this careful is itself a risk. A mistake here could reopen an edge case the guard's authors already spent real effort closing.
- **Recommendation:** skip unless option A and B both turn out to be insufficient. It shares option A and B's blind spot on non-pull-request merges anyway.

## Gap 2: loose commits and uncommitted files

The SOP's Step 6 says a working tree must be clean at handoff, or its dirty state must be written down and explained. Today this is a rule a person is expected to follow, not something a machine checks. The tracker's own B2 reports in issue #1008 found real cases: one checkout had 74 unpushed commits sitting since 2026-08-30, another had 50 untracked files three days old.

### Option A, primary: a Stop hook that checks git status at session end

A Stop hook is a script the harness runs automatically when a session ends. Wire one that runs `git status --porcelain`, a command that prints nothing when the tree is clean and one line per changed or untracked file otherwise. If it is not clean, the hook prints a reminder to name the dirty state, matching what Step 6 already asks for by hand.

- **Catches:** the exact moment Step 6 already cares about, session end, for every seat that has the hook installed.
- **Misses:** a session that crashes or gets killed without a normal Stop event. Also does not judge whether a written explanation is honest or good enough, only whether one exists.
- **Cost:** low. One small script, one line in each seat's settings file.
- **Owner:** each seat owns installing this in its own settings, per the seat-owns-its-own-checkouts rule.
- **Risk:** low. It can only report, not block, so it cannot cause a false refusal.
- **Recommendation:** build this first. It is cheap and it matches the SOP's own trigger point exactly.

### Option B, alternate: a daily scheduled sweep across every clone

A cron or launchd job, the two standard ways to run something on a timer on a Mac, that reuses the certifier's fleet enumeration method, origin URL plus `--git-common-dir`, to find every checkout on the box and run `git status --porcelain` in each one, once a day.

- **Catches:** dirty trees left behind by a crashed or abandoned session, which option A alone would miss.
- **Misses:** nothing option A catches that this would not also catch eventually, but it is slower, once a day instead of at the exact moment of handoff.
- **Cost:** moderate. Needs a small new script, but can borrow the enumeration code that already exists in the certifier rather than writing it again.
- **Owner:** Ops runs the schedule; Overwatch audits the results, matching how it already audits the SOP's other sweeps.
- **Risk:** low, report only.
- **Recommendation:** good second layer once option A exists. Catches what a Stop hook cannot.

### Option C, alternate: fold a dirty-tree check into the certifier's weekly run

The certifier already checks eight numbered clauses about whether hooks are wired and firing. Add a ninth clause that reads `git status --porcelain` and reports dirty as a finding, run on a weekly schedule.

- **Catches:** the same as option B, on a weekly instead of daily cadence.
- **Misses:** anything a week-old check would miss that a daily or per-session check would not.
- **Cost:** low, since the certifier already has the fleet-walking code and already prints a per-repo report.
- **Owner:** Initiative 5 owns the certifier's clauses.
- **Risk:** low, report only.
- **Recommendation:** fine if a week is an acceptable delay. Option B is closer to daily visibility for about the same build cost.

## Gap 3: clones nobody pushes from

The guard is a pre-push hook. It only runs when someone pushes. Bot clones under `~/.buzz/REPOS` mostly never push, since the bots that use them read code rather than commit it. The census found these clones are the dirtiest population in the fleet, 78 percent of their local branches invisible to the guard, against 21 percent for operator working copies that get looked at by a person.

### Option A, primary: a daily scheduled run of the guard in check mode

Run `hygiene-guard.sh` once a day, in a read-only mode that reports findings without blocking anything, against every clone found by the certifier's own enumeration method, origin URL plus `--git-common-dir`. This is the exact discovery method the definitive census in issue #1008 used to find the 342-of-562 number, so reusing it means the daily run measures the same population the tracker already trusts.

- **Catches:** stale branches sitting in bot clones that never push, the population the census found is worst.
- **Misses:** the guard's own squash-merge blind spot still applies here, same as gap 1.
- **Cost:** moderate. The guard was not written to run without real pre-push stdin, the ref-update data git normally feeds it, so a check mode needs either a small guard change or a wrapper script that feeds it synthetic input.
- **Owner:** Initiative 5 for the guard change, Ops for running the schedule.
- **Risk:** low, since check mode never blocks or deletes, it only reports. Real risk sits downstream, in whoever acts on the report, and the SOP's existing four-check safety gate already governs that.
- **Recommendation:** build this. It directly targets the worst-measured population in the fleet.

### Option B, alternate: extend the certifier's `--fleet` mode

The certifier already walks every clone on the box weekly, or on whatever schedule Ops sets, and already proves hooks fire. Add the same check-mode disposal logic from option A as a new clause in that existing walk, instead of writing a second walking script.

- **Catches:** the same population as option A.
- **Misses:** the same blind spot as option A.
- **Cost:** lower than option A, since the fleet-walking code is already built and already tested against real worktree edge cases, four defects were found and fixed in that enumeration code during opeff#996.
- **Owner:** Initiative 5 owns the certifier.
- **Risk:** low, same as option A.
- **Recommendation:** strong alternate. Mainly a build-cost call between writing a new small script, option A, versus growing an already-complex one, option B.

### Option C, alternate: check whether fleet-health-check.mjs's STALECO01 already does this

`fleet-health-check.mjs` already has a detector named STALECO01, "stale-checkout refusal," described in `docs/proposals/opeff722-fleet-health-stale-checkout-design.md` in the opeff repo. I did not have time to read that detector's actual logic closely enough to say whether it already covers this gap or covers something adjacent, like checkouts that have fallen behind rather than ones nobody pushes from.

- **Catches:** unknown until read. Possibly this exact gap already, in part.
- **Misses:** unknown until read.
- **Cost:** if it already covers this, the cost is zero, just point at it. If it does not, building option A or B stands.
- **Owner:** Ops owns `fleet-health-check.mjs`.
- **Risk:** the real risk here is building a second implementation of something that already exists. The guard's own file header warns about exactly this mistake, opeff#870, two independent implementations with nothing comparing their verdicts.
- **Recommendation:** read STALECO01 before building anything for gap 3. This is the one item in this doc that needs a follow-up read, not a build decision, before Overwatch picks between A and B.

## What stays a rule, not a gate

Some of the SOP cannot be turned into an automated check, and should not be forced into one.

- **Whether a written dirty-tree explanation is honest and sufficient.** A machine can tell you a tree is dirty. Only a person can judge whether the reason given for it makes sense.
- **Whether a branch flagged by any of the above is actually safe to delete.** The SOP's Step 5 already says this twice: a directory or branch can be correctly identified and still be load-bearing, something someone still needs. Every option in this doc is a finding, never a disposal. The SOP's own four-check safety gate, plus its whether-then-which discriminator, decides disposal, and that stays a human or TP judgment call.
- **The occupant precondition**, never disposing a worktree while its session is still using it. This needs a live signal that a session has actually ended, not just a git-state reading.
- **Naming an owner when cleanup cannot happen.** The SOP already says silence is not allowed here. That is a habit for a person to keep, not something a script can enforce from outside.

## Decision table

| Gap | Primary | Alternate A | Alternate B |
|---|---|---|---|
| 1. Merged branches left on GitHub | Turn on "automatically delete head branches" per repo | New detector in `fleet-health-check.mjs` reading PR merge state | Extend `hygiene-guard.sh` with a remote-branch arm plus scheduled `fetch --prune` |
| 2. Loose commits and uncommitted files | Stop hook running `git status --porcelain` at session end | Daily scheduled sweep across every clone, reusing the certifier's enumeration | Ninth clause added to the certifier's weekly `--fleet` run |
| 3. Clones nobody pushes from | Daily scheduled run of the guard in check mode, same enumeration method as the definitive census | Fold the same check-mode logic into the certifier's `--fleet` walk | Read `fleet-health-check.mjs`'s STALECO01 detector first, it may already cover this |

## Verified after drafting, by the TP, 2026-09-11 21:40Z

- GitHub "automatically delete head branches" is OFF on both `Hunt-Gather-Create/_R1` and `jasonburks23/_R1`, read from `gh api repos/<repo> --jq .delete_branch_on_merge`. So gap 1 is live today.
- The line 1205 short circuit is real: `[ "$_ahead" -gt 0 ] || return 1` in `scripts/hygiene-guard.sh` at `be7fc7c`. The guard's only ancestor check, `_ancestor_check`, is used for held refs at lines 809 and 824, never for disposal. Its header, rule 2, says disposability is content presence not ancestry, by design.
- Ran the guard's cost twice today: a `git push --delete` of one branch runs the full Vitest suite, about 25 seconds on this repo and four minutes on opeff. Any scheduled check-mode run must call the guard script directly, not through the pre-push hook, or it pays the suite every time.

## Still open

- STALECO01 in `fleet-health-check.mjs` line 4487 is "refuse to certify from a stale checkout", opeff#722. It checks that the checkout running the certifier is current, not whether other clones hold fossils. So gap 3 alternate B does not already cover gap 3; it would be a new detector.
- No scheduled job against `~/.buzz/REPOS` clones was found, but not every launchd or cron entry on the box was checked.
