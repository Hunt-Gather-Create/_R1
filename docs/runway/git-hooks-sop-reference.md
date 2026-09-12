# Git hooks SOP reference for Runway checkouts of `_R1`

Copyable reference. One doc. Every command below was run on 2026-09-11 and the outputs are pasted, not paraphrased. The standard this implements is `agency-os/docs/sops/git-hygiene-v2.md`, ratified 2026-07-28, owner OpEx. The fleet pointer is opeff `docs/standards/git-hooks-where-things-are.md`. The tracker is opeff#1008. Do not add rules here; add them to the SOP.

## 0. Where Runway stands today

| Checkout | core.hooksPath | Certifier status | Why |
|---|---|---|---|
| `/Users/jasonburks/Documents/_AI_/_R1` at `be7fc7c` | `scripts/hooks`, relative, local config | NOT-PROTECTED | Only `pre-push` exists. No `pre-commit`, no `commit-msg`. An em dash in new markdown commits clean today. |
| Throwaway clone of the same commit plus the vendoring commit in section 2 | absolute `<checkout>/.githooks` | PROTECTED | Measured, output in section 6. |

So the recipe works on `_R1`. What is missing is the vendoring commit landing on `Hunt-Gather-Create:runway`. That is a build for the Runway CC seat and a merge for the operator; the patch is ready at `.tp/vendor-fleet-git-hooks-2026-09-11.patch` in the TP checkout and is tracked on jasonburks23/_R1#178. Until it lands, every `_R1` checkout stays NOT-PROTECTED no matter what a seat runs locally, because clause 5 hashes the live hook against the default branch's blob.

## 1. What a seat installs, and from where, by blob id

Blob ids are `git hash-object` ids. Two files with the same blob id are byte-identical. Verify with `git ls-tree <ref> <path>` in the source repo and `git hash-object <path>` in the target.

| Target path in `_R1` | Blob id | Source | Job |
|---|---|---|---|
| `.githooks/pre-commit` | `14c9b4ecba384f248a0c730d71c4d1de77028e95` | agencyos-holdout-qa `origin/main:.githooks/pre-commit` | Refuses an em or en dash in newly added markdown lines. Refuses staged secret-shaped files. |
| `.githooks/commit-msg` | `72166b4645e10d219109ab13a5e353c489cbaf00` | opeff `origin/main:.githooks/commit-msg` | Blocks a closing keyword followed by a scope qualifier; warns on a bare closing keyword. |
| `.githooks/pre-push` | `dd8d1477e2b5ac065ab154fd8d8ecc9627cbb0e3` | Runway shim, six lines, text in section 2 | Execs Runway's real `scripts/hooks/pre-push`. See section 3. |
| `scripts/install-hooks.sh` | `e028b904be8139ba34f78d2d1879037fa861aef6` | opeff `origin/main:scripts/install-hooks.sh`, merged at `b842d25d` under opeff#997 | Writes an absolute `core.hooksPath` resolved from `--git-common-dir`. |
| `scripts/lib/commit-close-keyword.mjs` | `f23292b9d983e8651016a69c1fdc575afedbae7c` | opeff `origin/main:scripts/lib/commit-close-keyword.mjs` | Library the commit-msg hook imports. |

The certifier is not vendored. Run it from the opeff checkout: `scripts/git-hygiene-certify.mjs`, blob `51958a8cf08554dd20971b4ec28fe777b3ae6183` on opeff `origin/main` at `015d6121`, merged at `ac115dec` under opeff#996.

Runway's own files that stay where they are: `scripts/hooks/pre-push` blob `816edf7e`, `scripts/hygiene-guard.sh` blob `bdad9b75`, `scripts/hooks/install.sh` blob `81b9fd2c`. The old `scripts/hooks/install.sh` writes a relative pin and is superseded by the vendored installer; leave it in place until the CC ticket retires it.

## 2. The exact commands, in order

Run from the checkout root. `_R1` is the checkout path. `HQ` is a checkout of agencyos-holdout-qa, `OP` is a checkout of agencyos-operational-efficiency, both fetched.

```sh
# 2a. Vendor the five files by blob id. cat-file -p prints the exact bytes.
mkdir -p .githooks scripts/lib
git -C "$HQ" cat-file -p 14c9b4ecba384f248a0c730d71c4d1de77028e95 > .githooks/pre-commit
git -C "$HQ" cat-file -p 72166b4645e10d219109ab13a5e353c489cbaf00 > .githooks/commit-msg
git -C "$OP" cat-file -p e028b904be8139ba34f78d2d1879037fa861aef6 > scripts/install-hooks.sh
git -C "$OP" cat-file -p f23292b9d983e8651016a69c1fdc575afedbae7c > scripts/lib/commit-close-keyword.mjs
cat > .githooks/pre-push <<'SHIM'
#!/bin/sh
# Runway's real pre-push lives in scripts/hooks/pre-push (test suite plus the
# hygiene guard, _R1#107 and _R1#167). This shim exists so the fleet-standard
# hooks dir .githooks carries all three required hook types and the real hook
# still runs. stdin (the pushed refs) passes through exec untouched.
exec "$(git rev-parse --show-toplevel)/scripts/hooks/pre-push" "$@"
SHIM
chmod +x .githooks/pre-commit .githooks/commit-msg .githooks/pre-push scripts/install-hooks.sh

# 2b. Prove the bytes. Every id must match the table in section 1.
for f in .githooks/pre-commit .githooks/commit-msg .githooks/pre-push scripts/install-hooks.sh scripts/lib/commit-close-keyword.mjs; do
  printf '%s %s\n' "$(git hash-object "$f")" "$f"
done

# 2c. Stage by NAME and commit. Never git add -A.
git add -- .githooks/pre-commit .githooks/commit-msg .githooks/pre-push scripts/install-hooks.sh scripts/lib/commit-close-keyword.mjs
git commit -m "chore(hooks): vendor fleet git hooks and installer per git-hygiene SOP, refs opeff#1008"

# 2d. Wire this checkout. Once per checkout and once per worktree that commits.
sh scripts/install-hooks.sh

# 2e. Runway only, fork checkouts: tell the hygiene guard which remote is trunk. See section 3.
git config hygiene.remote upstream
git config hygiene.trunk runway

# 2f. Certify. Exit 0 and STATUS: PROTECTED, or it is not done.
node "$OP/scripts/git-hygiene-certify.mjs" "$(pwd)"

# 2g. Refuse one commit by hand. \xe2\x80\x94 is the em dash; it is written as
# an escape here so this very doc does not trip the hook when it is committed.
printf '# scratch\n\nThis line has an em dash \xe2\x80\x94 on purpose.\n' > scratch-refusal-probe.md
git add -- scratch-refusal-probe.md
git commit -m "scratch: expected to be refused"; echo "exit $?"
git reset -- scratch-refusal-probe.md && rm -f scratch-refusal-probe.md
```

Step 2c commits with whatever hooks were wired before, which on a fresh clone is none. That is expected: the installer cannot run before the files exist. Step 2d is what turns the gate on.

## 3. Three things that are different on `_R1`

**The pre-push is Runway's own.** `scripts/hooks/pre-push` runs the Vitest suite and then `scripts/hygiene-guard.sh`, the fossil guard from _R1#167. The fleet's portable pre-push is a drift warning only. So `.githooks/pre-push` is a shim that execs the real hook. Measured: a dry-run push through the shim printed `pre-push: checking for fossil state` and then `hygiene-guard: clean`, so the shim reaches the guard and stdin passes through.

**A fork checkout must name its trunk.** `_R1` checkouts have two remotes: `origin` is the fork `jasonburks23/_R1` and `upstream` is `Hunt-Gather-Create/_R1`. The guard defaults to `origin/runway`, which on the fork is 47 commits behind and predates the guard. Without step 2e a push is refused with:

```
hygiene-guard BLOCK: could not resolve an install point: no commit on origin/runway adds 'scripts/hygiene-guard.sh'. Not treating every branch as pre-dating install. No disposability check ran.
pre-push: HYGIENE GUARD REFUSED. Push blocked.
```

That refusal is correct behavior, not a bug: the guard will not measure against a trunk it cannot see itself on. Step 2e fixes it. Measured 2026-09-11 on the TP checkout, first push after B2.

**The installer flips mode bits on four scripts.** `scripts/install-hooks.sh` runs `chmod +x scripts/*.mjs` before it writes the pin. On `_R1` that turns `scripts/build-with-migrations.mjs`, `scripts/runway-deploy-target.mjs`, `scripts/runway-schema-parity-check.mjs` and `scripts/runway-schema-push.mjs` from 100644 to 100755 in the working tree. None of the four has a shebang. Expect four mode-only lines in `git status` after 2d. jasonburks23/_R1#178's call: do not commit the mode flips, since Overwatch measured they are not load bearing for the gate. Reset them after install with `git checkout -- scripts/*.mjs`.

Two escape hatches, and their reach. `RUNWAY_SKIP_PREPUSH=1` skips the test suite step only; the hygiene guard still runs. `git push --no-verify` walks past everything and is not permitted for any Runway seat. `git commit --no-verify` is the line the pre-commit prints; the same rule applies.

## 4. The ONE commit the hook must refuse

A markdown file whose newly added lines contain an em dash. The pre-commit checks only added lines in `*.md`, so existing content never blocks a commit. Command in step 2g. Expected result: `git commit` exits 1, HEAD does not move, the scratch file stays staged until you unstage it.

Refusal text, verbatim, measured 2026-09-11:

```
pre-commit BLOCK (fleet voice): em/en dash in newly added markdown. Use hyphen, period, comma, colon, semicolon.
+This line has an em dash — on purpose.
Bypass only if certain: git commit --no-verify
```

The certifier's clause 1 runs this same probe with its own scratch file and expects exit 1. Clause 2 then commits a clean scratch file and expects exit 0, and undoes it with `reset --soft`.

## 5. The certifier's BEFORE output on the live TP checkout

```
REPO: /Users/jasonburks/Documents/_AI_/_R1
  clause1 (refusal proven): measured=true refused=false exit=0
  clause2 (reciprocal proven): measured=true succeeded=true exit=0
  clause3 (reachability): hooksPath=scripts/hooks origin=/Users/jasonburks/Documents/_AI_/_R1/.git/config conditional=false
  clause4 (hook types at effective path /Users/jasonburks/Documents/_AI_/_R1/scripts/hooks): {"pre-commit":false,"commit-msg":false,"pre-push":true}
  clause5 (live content scripts/hooks/pre-commit): match=null scripts/hooks/pre-commit does not exist in the working tree at the effective hooksPath
  clause7 (timing): durationMs=null invalid=true
  status --porcelain before/after byte-identical: true
  STATUS: NOT-PROTECTED
```

Read clause 1: the em dash commit landed. That is the hole. The certifier undid its own scratch commit; HEAD stayed at `be7fc7c`.

## 6. The certifier's PROTECTED output

Measured in a throwaway local clone of `_R1` at `be7fc7c` plus the section 2 vendoring commit, after `sh scripts/install-hooks.sh`. `<checkout>` stands in for the clone path.

```
REPO: <checkout>
  clause1 (refusal proven): measured=true refused=true exit=1
  clause2 (reciprocal proven): measured=true succeeded=true exit=0
  clause3 (reachability): hooksPath=<checkout>/.githooks origin=<checkout>/.git/config conditional=false
  clause4 (hook types at effective path <checkout>/.githooks): {"pre-commit":true,"commit-msg":true,"pre-push":true}
  clause5 (live content .githooks/pre-commit): match=true 
  clause7 (timing): durationMs=614 invalid=false
  status --porcelain before/after byte-identical: true
  STATUS: PROTECTED
```

Exit code 0. Every clause matched. `status --porcelain` was byte-identical before and after, so the certifier left nothing behind.

## 7. What "done" means for a Runway checkout

1. The vendoring commit is on `Hunt-Gather-Create:runway`.
2. `sh scripts/install-hooks.sh` has been run in that checkout and in every worktree of it that commits.
3. `hygiene.remote` and `hygiene.trunk` are set on any checkout whose `origin` is the fork.
4. The certifier prints `STATUS: PROTECTED` on that checkout path, and the run is reported on opeff#1008 with the path, the before status, the after status, and the refused commit.

The installer proves wiring. The certifier proves firing. Both, or it is not done.
