# _R1#120 pair reconstruction, run from _R1#121

Confirms the shape that motivated _R1#120: _R1#108 and _R1#112 each land
green alone and fail together, and nothing re-ran the guard suite against
the combination before both were on runway.

## How to reproduce

```
bash scripts/cross-pr-recheck/reconstruct-120-pair.sh
```

The script clones this repo into a throwaway `mktemp -d` directory, checks
out the merge-base both PRs share, applies each patch alone and then both
together, and runs the guard suite after each state. It never touches the
caller's own working tree.

## Result of the run captured for this report

```
112 alone exit code: 0 (0 means green)
108 alone exit code: 0 (0 means green)
both together exit code: 1 (0 means green)
Reproduced the _R1#120 shape: green, green, red.
```

`112 alone`: 11 tests, all passed.
`108 alone`: 38 tests, all passed.
`both together`: 41 tests, 39 passed, 2 failed.

The two failures, both on `src/app/api/runway/gantt-embed/route.ts:48`,
`process.env.NODE_ENV === "production"`:

- `token-compare guard: the guarded function has no reachable
  plain-equality return (#108)`
- `token-compare guard: token and apiKey may only co-occur inside
  timingSafeTokenMatch (#108 round 8)`

#112 added a real-route scan of `gantt-embed/route.ts` to the guard
suite as part of its own fix. #108 rewrote the guard's detectors in the
same file. Neither patch alone exercises the combination: #112 alone
scans the route file with the pre-#108 detectors, which do not flag this
line, and #108 alone rewrites the detectors but has no reason to scan
this particular route file yet, since #112 had not added that line yet.
Applied together, #108's rewritten detectors scan the route file #112
added to the suite, and the `NODE_ENV` gate on line 48, an unrelated
production safety check, not a token compare, trips both of them.

This is a guard suite false positive, not a security bypass. The point
of this reconstruction is not to fix the false positive, it is to prove
that a cross-PR re-run before both landed would have caught it, which is
the premise _R1#121 exists to give the fleet.

## Provenance of the two patches in this directory

Generated once, from commits that were still resolvable at generation
time, with the exact commands recorded in each patch's own script
header. The base commit, `d1c65ff5abe2aac9e00ecdf7436838b5a09a8e7f`, is
itself a squash-merge commit on runway history (PR #133), so it stays
reachable from runway indefinitely, unlike the two feature branch tips,
which can be deleted after merge. The two patches are stored here rather
than regenerated from the branch tips each time, so this reconstruction
does not depend on `fix/108-guard-reachability` or
`fix/112-gantt-embed-timing-safe` still existing on any remote.

| PR | merge commit | branch tip patched against base |
|---|---|---|
| #108 (`fix/108-guard-reachability`) | `fa6bd3f497bdc8c0521d8c958096f5e69f9a95d7` | `8d286197eff942856acf6cc57980730ca4356ebd` |
| #112 (`fix/112-gantt-embed-timing-safe`) | `bbf9958ab3eee71f3003ad3e0b6694e66979c173` | `0de6f1c77ee06f58d9dca888ee891ed82ae57292` |

Both branch tips share merge-base `d1c65ff5abe2aac9e00ecdf7436838b5a09a8e7f`
with the base commit, confirmed with `git merge-base` against each tip
before the patches were generated.
