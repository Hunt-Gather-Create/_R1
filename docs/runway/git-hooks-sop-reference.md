# Git hooks SOP reference for Runway checkouts of `_R1`

Copyable reference. One doc. Revised 2026-09-27 after PR Hunt-Gather-Create/_R1#201 moved the pre-commit onto the fleet's central voice core. Every command below was run on 2026-09-27 and the outputs are pasted, not paraphrased. The standard this implements is `agency-os/docs/sops/git-hygiene-v2.md`, owner OpEx. The fleet pointer is opeff `docs/standards/git-hooks-where-things-are.md`. The tracker is opeff#1008. Do not add rules here; add them to the SOP.

## 0. Where Runway stands today

The hooks are on `Hunt-Gather-Create:runway`. A seat does not vendor anything; it clones, wires, and certifies. Measured on the TP checkout at `0204e40`: `STATUS: PROTECTED`, output in section 6.

Two things changed on 2026-09-27 that a seat will notice:

1. The pre-commit no longer carries its own dash rule. It runs the fleet's central voice core from a read-only mirror on the seat's machine, then the secret-file arm, then `_R1`'s own code-file arm. See section 3.
2. The central core scans `*.md`, `*.txt`, `*.json`, `*.yaml` and `*.yml` files WHOLE, not just added lines. A commit that touches any such file still carrying an em, en, bar or minus dash anywhere is refused, even if the commit did not add it. On 2026-09-27, 78 tracked files were in that state. 74 of them are verbatim captures, prod snapshots, pinned skill copies and quoted text, that must never be cleaned; they are pinned by hash in the repo-root `CAPTURE-MANIFEST.json`, merged as `_R1#193` at `a4ce4df`, under the capture roots opeff#1392 added to the core. The other four were prose and have been cleaned: `.github/workflows/pr-tests.yml` in PR 206, and `docs/runway.md`, this doc and `.claude/sessions/runway-tp.md` in PR 207.

A pinned file is exempt only while its bytes match its manifest hash. To change one, first land a commit that updates its hash in `CAPTURE-MANIFEST.json`, reviewed, then commit the file. The core reads the manifest from HEAD, so the two cannot share a commit. Never `--no-verify`.

## 1. What is on trunk, by blob id

Blob ids are `git hash-object` ids, read with `git rev-parse upstream/runway:<path>` at `0204e40`. Two files with the same blob id are byte-identical.

| Path in `_R1` | Blob id | Job |
|---|---|---|
| `.githooks/pre-commit` | `7998366a8fd132a6a73554f064c49097ae1c9a11` | Runs the central core, fail closed if missing. Refuses staged secret-shaped files. Then runs `voice-lint-local.sh`, fail closed if missing. |
| `.githooks/voice-lint-local.sh` | `fa35a1b529ee1ef31f26b0b9a5d03ccc37286912` | `_R1`'s own arm: refuses a dash on an added line in `*.ts`, `*.tsx`, `*.js`, `*.mjs` or `*.sh`. Moved verbatim from `_R1#184`. |
| `.githooks/commit-msg` | `72166b4645e10d219109ab13a5e353c489cbaf00` | Fleet file. Blocks a closing keyword followed by a scope qualifier; warns on a bare closing keyword. |
| `.githooks/pre-push` | `dd8d1477e2b5ac065ab154fd8d8ecc9627cbb0e3` | Runway shim. Execs `scripts/hooks/pre-push`. See section 3. |
| `scripts/install-hooks.sh` | `e028b904be8139ba34f78d2d1879037fa861aef6` | Fleet installer, byte-identical to opeff's. Writes an absolute `core.hooksPath` resolved from `--git-common-dir`. |
| `scripts/lib/commit-close-keyword.mjs` | `f23292b9d983e8651016a69c1fdc575afedbae7c` | Library the commit-msg hook imports. |
| `scripts/hooks/pre-push` | `109e9efe60fb794b4750f235bfd6c943653506e0` | Runway's real pre-push: the full Vitest suite, then the hygiene guard. |
| `scripts/hygiene-guard.sh` | `0d198020d8c0c310c18c853e058101382b3b3a87` | The fossil guard from `_R1#167`. |

The pre-commit is no longer the fleet blob `14c9b4ec`. Do NOT restore `.githooks/pre-commit` from that blob or from any other repo: doing so drops the central core and the `*.ts` arm silently. The certifier is not vendored; run it from the opeff checkout, `scripts/git-hygiene-certify.mjs`, blob `c2033b2e8986c3386912a476593068d120e71920` on opeff `origin/main` on 2026-09-27.

The central core lives at `$HOME/.local/agencyos/main/agencyos-operational-efficiency/hooks/voice-lint-core.sh`, a mirror of opeff main refreshed by launchd. It is not in this repo.

## 2. The exact commands for a new checkout, in order

Run from the checkout root. `OP` is a checkout of agencyos-operational-efficiency.

```sh
# 2a. Clone the PARENT, not the fork, so origin/runway is the real trunk.
git clone --branch runway https://github.com/Hunt-Gather-Create/_R1.git _R1
cd _R1
git remote add fork https://github.com/jasonburks23/_R1.git

# 2b. Wire the hooks. Once per checkout; a worktree inherits the checkout's pin.
sh scripts/install-hooks.sh

# 2c. Put back the mode bits the installer flips. See section 3.
git checkout -- scripts/*.mjs

# 2d. Only if origin is the fork: tell the hygiene guard which remote is trunk.
git config hygiene.remote upstream
git config hygiene.trunk runway

# 2e. Confirm the central core is reachable. The pre-commit refuses every commit without it.
test -r "$HOME/.local/agencyos/main/agencyos-operational-efficiency/hooks/voice-lint-core.sh" && echo "core present"

# 2f. Certify. Exit 0 and STATUS: PROTECTED, or it is not done.
node "$OP/scripts/git-hygiene-certify.mjs" "$(pwd)"

# 2g. Refuse one commit by hand. The printf writes the em dash from its UTF-8
# bytes, so this doc carries no dash character and passes its own hook.
printf 'This line has an em dash \xe2\x80\x94 on purpose.\n' > scratch-refusal-probe.md
git add -- scratch-refusal-probe.md
git commit -m "scratch: expected to be refused"; echo "exit $?"
git reset -- scratch-refusal-probe.md && rm -f scratch-refusal-probe.md
```

If `origin` is the fork instead, step 2d is required and step 2a's remote names are swapped. Cloning the parent is preferred; the fork's `runway` is not advanced by merges and misled five findings in one week.

## 3. What is different on `_R1`

**The pre-commit runs three arms, in this order.** The central core in a child shell, so the core's own exit cannot skip what follows; the secret-file arm; then `voice-lint-local.sh` through `sh`. Each fails closed. A seat can test the core-missing case by pointing `HOME` at an empty directory: the commit is refused and the message names the path.

**The central core is only on seat machines.** GitHub Actions runners have no mirror. So the tests in `scripts/hooks/pre-commit.test.ts` that exercise the real core skip in CI with a printed reason, "no live agencyos mirror", and the tests of `_R1`'s own arms run everywhere against a stub core. Overwatch ruled this the fleet design on opeff#1347 on 2026-09-27.

**The pre-push is Runway's own.** `scripts/hooks/pre-push` runs the full Vitest suite and then `scripts/hygiene-guard.sh`. `.githooks/pre-push` is a shim that execs it. Every push therefore runs the full suite.

**A fork checkout must name its trunk.** The guard defaults to `origin/runway`. On the fork that ref is not advanced by merges, and without step 2d a push is refused with `hygiene-guard BLOCK: could not resolve an install point`. That refusal is correct: the guard will not measure against a trunk it cannot see itself on.

**The installer flips mode bits.** `scripts/install-hooks.sh` runs `chmod +x` on `scripts/*.mjs`. Four of those files are tracked 100644 and have no shebang, so `git status` shows four mode-only lines after 2b. Per `_R1#178`, do not commit the flips; step 2c resets them. The installer is the fleet blob, so narrowing its chmod is an opeff change, not an `_R1` one.

**No escape hatches.** `git commit --no-verify` and `git push --no-verify` are not permitted for any Runway seat. `RUNWAY_SKIP_PREPUSH=1` is not permitted either, load included, per Overwatch on 2026-09-26: if the suite cannot complete, wait and retry, or report blocked. The hooks still print "Bypass only if certain: git commit --no-verify" in three places; that text is out of date and is tracked for removal.

## 4. The commits the hook must refuse, and what it prints

Measured 2026-09-27 in a scratch repo with trunk's `.githooks` at `0204e40` installed. Both exit 1 and HEAD does not move. The hooks echo the offending line, which contains the real dash; it is shown here as `<U+2014>` so this doc can be committed under its own hook.

A markdown file containing an em dash, refused by the central core:

```
VOICE-FAIL: forbidden dash, U+2013, U+2014, U+2015 or U+2212, in probe.md
  line 1: This line has an em dash <U+2014> on purpose.
Commit blocked [opeff#1347 voice-lint-core]: Civilization voice, no em, en, bar or minus dashes.
Fix: rewrite each flagged sentence with a period, comma, colon or semicolon. Do not swap in a hyphen or any other stand-in character. opeff#1349.
```

A TypeScript file with an em dash on an added line, refused by `voice-lint-local.sh`:

```
pre-commit BLOCK (fleet voice): em/en dash in newly added *.ts. Use hyphen, period, comma, colon, semicolon.
+// a comment <U+2014> here
Bypass only if certain: git commit --no-verify
```

The two messages disagree: the core forbids a hyphen as a stand-in and the local arm suggests one, and the local arm suggests a bypass that is not permitted. Follow the core's instruction. The local arm's text is tracked for correction.

The certifier's clause 1 runs a markdown probe of its own and expects exit 1. Clause 2 commits a clean scratch file, expects exit 0, and undoes it with `reset --soft`.

## 5. The certifier on the live TP checkout, 2026-09-27

Run against `/Users/jasonburks/Documents/_AI_/_R1` at `0204e40`, certifier blob `c2033b2e`. `git status --porcelain` was empty before and after, and HEAD did not move.

```
REPO: /Users/jasonburks/Documents/_AI_/_R1
  clause1 (refusal proven): measured=true refused=true exit=1
  clause2 (reciprocal proven): measured=true succeeded=true exit=0
  clause3 (reachability): hooksPath=/Users/jasonburks/Documents/_AI_/_R1/.githooks origin=/Users/jasonburks/Documents/_AI_/_R1/.git/config conditional=false
  clause4 (hook types at effective path /Users/jasonburks/Documents/_AI_/_R1/.githooks): {"pre-commit":true,"commit-msg":true,"pre-push":true}
  clause5 (live content .githooks/pre-commit): match=true 
  clause5 (live content scripts/install-hooks.sh): match=true 
  clause7 (timing): durationMs=453 invalid=false
  status --porcelain before/after byte-identical: true
  STATUS: PROTECTED
```

A gate on PR 201 reported clause 5 as CANNOT-MEASURE in a fresh throwaway clone. That result did not reproduce on this checkout, where clause 5 matched for both files. If a fresh clone shows it, record the clone's `core.hooksPath` and branch alongside the output.

## 6. History

Before 2026-09-11 the TP checkout had only a pre-push, and an em dash in new markdown committed clean; the certifier read NOT-PROTECTED. The fleet hooks were vendored under `_R1#178`. On 2026-09-27 PR 201 replaced the vendored pre-commit with the central-core loader described above. The earlier version of this doc, which told a seat to vendor the fleet pre-commit blob `14c9b4ec`, is superseded: following it now would silently remove the central core and the `*.ts` arm.

## 7. What "done" means for a Runway checkout

1. `sh scripts/install-hooks.sh` has been run in that checkout.
2. `hygiene.remote` and `hygiene.trunk` are set if `origin` is the fork.
3. The central core is reachable at the mirror path.
4. The certifier prints `STATUS: PROTECTED` on that checkout path.

The installer proves wiring. The certifier proves firing. Both, or it is not done.
