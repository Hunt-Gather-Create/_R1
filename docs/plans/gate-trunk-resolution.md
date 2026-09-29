# Gate trunk resolution: read the base off the PR, never assume a branch name

Author: Runway TP, 2026-09-23. Routed to Overwatch. The gate-1 subagent contract is Holdout's
document and the gate SOPs are not this seat's to edit, so this is a proposal with the exact
replacement text, not a change.

## The defect, and it is written down rather than remembered

`agencyos-holdout-qa/docs/proposals/gate-1-subagent-contract-v0.md` clause C3 reads, verbatim:

> ### C3. Gate vs ORIGIN/main, never a diverged local.
> The leg confirms the graded SHA is NOT-ancestor of origin/main (unmerged) and computes scope
> from the real merge-base against origin/main. It never grades against a stale or diverged
> local branch.

Two assumptions are baked into that sentence. Trunk is named `main`. And `origin` is the repo
that holds trunk. Both are false in `_R1`, at the same time.

`jasonburks23/_R1` is a fork of `Hunt-Gather-Create/_R1`. Its default branch is `runway`, not
`main`. PRs target the parent, so no merge ever advances the fork's `runway`. On 2026-09-23 it
sat 17 merges behind at `05d9567` while true trunk was `e8af9aa`.

The clause guards the wrong direction. It protects against a stale or diverged LOCAL branch and
treats `origin` as ground truth. Here `origin` is the stale thing and the local clone is fine.

## Why it survived, measured rather than assumed

Of the 17 repos in `Civilization-Skill-Suite`, 15 are not forks and use `main`. C3 is correct for
all 15. Three repos are forks: `_R1`, `buzz`, and `ZettelClip`. Only `_R1` also renames trunk, so
it is the one repo where both assumptions break together, and it is the repo that produced all
four findings. A clause that is right 15 times out of 17 collects no evidence against itself.

## What it cost, four findings in one week, one cause

1. QA-Scout-1's false 23-dash count on jasonburks23/_R1#153.
2. A false base-ancestry refusal on #184. The seat surfaced it rather than reporting through it,
   which is the only reason it was caught, and that was judgment, not a gate.
3. A gate-2 block on #160 claiming sixteen ungated tickets were stacked on the branch. All
   sixteen were already on trunk. Verified by ancestry, 16 on trunk and 0 not, with a negative
   control proving `git merge-base --is-ancestor` refuses a false claim.
4. A withdrawn alarm that a merged branch had been deleted without merging.

Three of the four were caught only because someone re-derived the number by hand afterwards.

## The fix: the PR already carries its own base

A gate does not have to know what trunk is called or which repo holds it. The pull request states
both, and states the exact commit:

```sh
gh pr view <N> --repo <base-repo> --json baseRefName,baseRefOid,isCrossRepository,headRefOid
```

On PR 195 that returns, measured 2026-09-23:

```
base branch = runway
baseRefOid  = a2fc90b
head        = e3d8520
crossRepo   = true
```

`baseRefOid` is the exact commit the branch was cut from, so scope is `git diff <baseRefOid>
<headRefOid>` with no ref resolution and no assumption. `isCrossRepository: true` is a
machine-readable statement that the head repo is not the base repo, which is the fork case, so
the gate does not have to remember that `origin` might be a fork. It can detect it.

Proven: `baseRefOid` a2fc90b is an ancestor of `upstream/runway`, so the PR-reported base lands
on true trunk.

## Proposed replacement text for C3

> ### C3. Gate against the base the PR declares, never an assumed branch name.
> The leg resolves trunk from the pull request itself, never from `origin/main` or any other
> guessed ref: `gh pr view <N> --repo <base-repo> --json baseRefName,baseRefOid,isCrossRepository`.
> Scope is computed from `baseRefOid`, the exact commit the head was cut from. The leg confirms
> the graded SHA is not an ancestor of the base branch in the BASE repo, and verifies merge state
> by CONTENT on that base branch, not by SHA ancestry alone, because squash and rebase land under
> a new SHA.
> When `isCrossRepository` is true the head repo is a fork and its `origin` is NOT trunk. A clone
> made for grading is taken from the BASE repo, with the base branch named explicitly, and the
> fork is added as a second remote carrying only the branch under review.
> The evidence envelope RECORDS the resolved base repo, base branch, and `baseRefOid`. A wrong
> trunk then appears as a wrong value on the page instead of an invisible assumption.
> Why it is a clause: `origin/main` is correct in 15 of 17 fleet repos and wrong in the one that
> is a fork with a renamed trunk, which is how it produced four false findings in a week while
> looking sound.

## The clone, for a fork PR

```sh
git clone --single-branch --branch <baseRefName> https://github.com/<base-repo>.git <dir>
cd <dir>
git remote add fork https://github.com/<head-owner>/<repo>.git
git fetch fork <branch-under-review>
git checkout -b <branch-under-review> fork/<branch-under-review>
```

`origin/<baseRefName>` is then true trunk, so the DEFAULT is correct and nothing has to be
remembered. The stale copy stays reachable as `fork/<baseRefName>`, labelled in a way no one
mistakes for trunk. Measured on `_R1`: 1.4 seconds, 5.6 MB.

## The two gaps this does not close

`--branch <baseRefName>` is load bearing. Without it the clone lands on the base repo's default
branch, which for `Hunt-Gather-Create/_R1` is `main`, not `runway`, and it does so silently. The
recorded `baseRefName` in the envelope is what makes that visible.

The fork's own trunk stays stale until someone fast forwards it. Nothing in this proposal depends
on that any more, which is the point, but a PR diff read in the GitHub web UI still does.

## Ask

Overwatch to route the C3 amendment to Holdout, who owns the contract, and to decide whether the
recorded-base requirement belongs in the gate SOPs as a fleet standard. Requiring the resolved
base in the envelope is the part that does not rely on memory: a seat can forget a rule, and the
report will still show the trunk it actually used.
