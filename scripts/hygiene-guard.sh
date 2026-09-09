#!/bin/sh
# hygiene-guard.sh -- pre-push hygiene guard for _R1#167. This is the one
# implementation, wired directly by scripts/hooks/pre-push. An earlier pass
# on this ticket shipped a second, TypeScript, implementation alongside this
# one with nothing comparing their verdicts, which is the exact class of
# defect opeff#870 names: two independent implementations, no detector for
# drift between them. Deleted rather than reconciled: one implementation
# means one gate covers what ships.
#
# Refuses the next push when the repo it runs in currently holds a local branch
# or a registered worktree whose content is already fully present in trunk. The
# seat that must clean up a merged branch or worktree is usually not the seat
# that merged it, and nothing else wakes that seat up. This guard fires on the
# push that happens to come next, from whoever runs it, which is the one
# property that reliably catches the leftover.
#
# POSIX sh. No Node, no pnpm, no TypeScript, no repo-specific paths or
# assumptions beyond a "trunk" concept and a remote. That portability is
# incidental to why it was picked, not the reason: it is wired here because
# it is the shipped artifact, with no Node dependency for a pre-push hook to
# fail on if `node` is absent from a contributor's PATH.
#
# Usage: sh hygiene-guard.sh [repo-path] [remote-name] [guard-path]
#   repo-path    defaults to the current directory. Passed so this can be
#                tested against a repo other than the one it's invoked in;
#                a real pre-push invocation never needs to pass it, git already
#                runs the hook with cwd inside the repo being pushed.
#   remote-name  defaults to "origin".
#   guard-path   defaults to "scripts/hygiene-guard.sh". This repo's path,
#                relative to repo root, to THIS script's own tracked file.
#                It is how the guard finds its own install point in trunk
#                history (see "SCOPE: ONLY BRANCHES CREATED AFTER INSTALL"
#                below). A deployment that drops this file at a different
#                path (for example opeff's .githooks/) must pass that path
#                here, or every branch reads as pre-dating install.
#
# Exit 0: clean, nothing disposable found.
# Exit 1: REFUSE. Trunk could not be resolved, the install point could not
#         be resolved, or a fossil branch or worktree was found (governed
#         ones only -- see below). This is the guard's ONLY verdict channel
#         -- read the exit code, not the printed text (control D5). Unlike
#         opeff's own check-shared-checkout.mjs (SC01), whose declared return
#         type is {severity: 'ok'|'warning'} and structurally cannot report a
#         blocking condition, this guard has a genuine failing path, and its
#         failing path is exercised and proven below, not merely declared.
#
# SCOPE: ONLY BRANCHES CREATED AFTER INSTALL ARE GOVERNED (Overwatch ruling,
# _R1#167). A guard that demands a backlog cleanup as its entry fee is not
# enforceable -- fifteen old merged branches means fifteen cleanups before a
# seat can push once, and that is how a guard gets bypassed on day one. So a
# branch is only checked for disposability if it forked from trunk AT OR
# AFTER the commit that first added this guard's own script to trunk.
#
# The install point is NOT a side marker file. A marker file a seat can `rm`
# is a skip flag with extra steps, and this guard ships no skip flag of its
# own on purpose (see below). Instead the install point is derived: the
# first commit in TRUNK's own history that adds guard-path. That commit is
# part of trunk's committed history -- forging it requires rewriting shared
# trunk history, which is already a different, much louder problem than
# deleting a file. If that commit cannot be found (guard-path was never
# added to trunk, or trunk history for it is unavailable, e.g. a shallow
# clone that doesn't reach it), the guard REFUSES and says so. It never
# silently treats "can't find the install point" as "every branch predates
# it" -- that would produce a guard that always exits 0, which reads
# identically to a guard with nothing to catch (control D9, see the transcript).
#
# Two design choices are load-bearing, not incidental:
#
# 1. TRUNK IS RESOLVED FROM THE REPO, refs/remotes/<remote>/HEAD, with a live
#    `git remote show <remote>` fallback, NEVER the literal string "main". A
#    guard that silently compares against a stale or wrong branch name still
#    exits zero, which is worse than a guard that refuses to run at all: the
#    failure to detect goes unnoticed. If trunk cannot be resolved at all, this
#    guard exits nonzero rather than guessing (control D1 -- see below).
#
# 2. DISPOSABILITY IS DECIDED BY CONTENT PRESENCE, NOT ANCESTRY. A branch
#    merged into trunk via squash has no ancestor relationship to trunk at
#    all; `git merge-base --is-ancestor` exits 1 on it even though every
#    change it makes is in trunk. So that check is never used here. Content
#    presence is decided by reverse-applying the branch's diff onto trunk's
#    tree in a scratch index: if trunk already contains every change the
#    branch makes, the reverse-apply is clean. The FORWARD form -- apply the
#    diff, then compare the resulting tree hash to trunk's -- is deliberately
#    NOT used: a patch that fails to apply at all leaves the scratch index
#    untouched, so its tree hash still equals trunk's BY CONSTRUCTION, and a
#    failed apply and a no-op apply become indistinguishable. Only the reverse
#    form's own exit code, never a tree-hash comparison, tells the two apart.
#
# A worktree that is content-present in trunk but ALSO holds uncommitted
# changes (git status --porcelain is non-empty) is reported as
# DISPOSABLE-BUT-DIRTY, with the uncommitted-entry count, and gets NO removal
# command. It still causes a refusal: the repo still needs a human decision
# about state a content check can never see. A worktree record git itself
# already marks prunable (its directory is gone) is always reported with
# `git worktree prune`, unconditionally: there is no working tree left to
# lose, so the dirty check does not apply to it.
#
# No skip flag of its own. `git push --no-verify` exists at the git level and
# this guard is not pretending otherwise, but it ships no HYGIENE_GUARD_SKIP=1
# equivalent. A documented skip is exactly how the fleet's one prior
# tree-state check ended up enforcing nothing but a warning.
#
# Every exit-code check below reads a command's OWN $? directly, never the
# exit status of the last stage of a pipe it was fed through. `cmd | head`
# then `$?` reads head's exit status, not the command's; see the mutation
# floor in the control transcript for a live demonstration of exactly that
# failure mode.

set -u

_REPO="${1:-$(pwd)}"
_REMOTE="${2:-origin}"
_GUARD_PATH="${3:-scripts/hygiene-guard.sh}"

_g() {
  # Run git in the target repo. -C, not cd, so this script's own cwd is
  # never mutated by a caller invoking it repeatedly.
  git -C "$_REPO" "$@"
}

_fail=0
_block() {
  echo "hygiene-guard BLOCK: $*" >&2
  _fail=1
}
_info() {
  echo "hygiene-guard: $*"
}

# --- resolve trunk, from the repo, never a literal branch name --------------
_resolve_trunk() {
  # Prints "<branch-name>" on stdout; returns 0 on success, 1 if unresolved.
  _sym=$(_g symbolic-ref --quiet "refs/remotes/$_REMOTE/HEAD" 2>/dev/null)
  _sym_status=$?
  if [ "$_sym_status" -eq 0 ] && [ -n "$_sym" ]; then
    printf '%s\n' "$_sym" | sed "s#^refs/remotes/$_REMOTE/##"
    return 0
  fi

  _shown=$(_g remote show "$_REMOTE" 2>/dev/null)
  _shown_status=$?
  if [ "$_shown_status" -eq 0 ]; then
    _branch=$(printf '%s\n' "$_shown" | sed -n 's/^ *HEAD branch: *//p' | head -1)
    if [ -n "$_branch" ] && [ "$_branch" != "(unknown)" ]; then
      printf '%s\n' "$_branch"
      return 0
    fi
  fi

  return 1
}

TRUNK_BRANCH=$(_resolve_trunk)
_trunk_status=$?
if [ "$_trunk_status" -ne 0 ] || [ -z "$TRUNK_BRANCH" ]; then
  _block "could not resolve trunk from refs/remotes/$_REMOTE/HEAD or 'git remote show $_REMOTE' in $_REPO. Not guessing a branch name. No disposability check ran."
  exit 1
fi
TRUNK_REF="$_REMOTE/$TRUNK_BRANCH"

# --- refuse on a shallow clone rather than resolve a fabricated install ----
# DEFECT 3 (_R1#167 G1_BOUNCE 4): in a --depth 1 clone, the grafted boundary
# commit is parentless, so the install-point walk below matches guard-path
# on the GRAFT, not on the real add commit further back that the shallow
# history can't reach. That is worse than the documented "can't find it,
# refuse" fallback: it does not fail to find an install point, it finds a
# WRONG one and continues to govern every branch against it. Detected and
# refused explicitly, before the walk ever runs, rather than trusted to
# surface as a side effect of the walk failing (it doesn't fail; it lies).
_is_shallow=$(_g rev-parse --is-shallow-repository 2>/dev/null)
_shallow_status=$?
if [ "$_shallow_status" -ne 0 ]; then
  _block "could not determine shallow-clone status for $_REPO (git rev-parse --is-shallow-repository failed, exit $_shallow_status). Not assuming a full clone. No disposability check ran."
  exit 1
fi
if [ "$_is_shallow" = "true" ]; then
  _block "refusing: $_REPO is a shallow clone. Install-point resolution walks trunk history for '$_GUARD_PATH' and a shallow clone can silently resolve a grafted boundary commit as if it were the real add commit. No disposability check ran."
  exit 1
fi

# --- resolve install point: first commit on trunk to add guard-path --------
_resolve_install_sha() {
  # Prints the SHA of the earliest commit in TRUNK_REF's history that adds
  # _GUARD_PATH, on stdout. Returns 1 if no such commit exists (guard-path
  # was never added to trunk). Piped through tail, so this function's own
  # exit status is tail's, not git log's -- safe here only because the
  # shallow-clone case that would otherwise make this walk resolve a wrong
  # SHA is refused above before this ever runs, and on a full clone a
  # failed `git log` here produces no output, which the empty-string check
  # below already treats as unresolved and refuses on (fail closed either
  # way). --diff-filter=A catches the ADD; a file later renamed away and
  # back is not a case this guard needs to handle, since guard-path names
  # THIS script's own current location.
  _sha=$(_g log "$TRUNK_REF" --diff-filter=A --format=%H -- "$_GUARD_PATH" 2>/dev/null | tail -1)
  [ -n "$_sha" ] || return 1
  printf '%s\n' "$_sha"
}

INSTALL_SHA=$(_resolve_install_sha)
_install_status=$?
if [ "$_install_status" -ne 0 ] || [ -z "$INSTALL_SHA" ]; then
  _block "could not resolve an install point: no commit on $TRUNK_REF adds '$_GUARD_PATH'. Not treating every branch as pre-dating install. No disposability check ran."
  exit 1
fi

# --- governance: is a branch's fork point at or after INSTALL_SHA? ---------
_branch_governed() {
  # $1 = candidate ref, $2 = trunk ref. Returns 0 if the branch forked from
  # trunk at or after INSTALL_SHA (governed: check it for disposability),
  # 1 if it forked before (ungoverned: skip entirely, dirty or not, fossil
  # or not -- a guard that binds retroactively is the enforceability defect
  # this scoping exists to fix). A branch with genuinely no merge-base at
  # all (git merge-base's documented exit 1, unrelated histories) is
  # treated as ungoverned, same conservative direction as "predates
  # install": this guard's job is prevention going forward, not
  # adjudicating unrelated histories.
  #
  # ONE CONTRACT (Overwatch actuator, _R1#167, applied fleet-wide across
  # this script, not just here): every git invocation whose failure could
  # change the verdict has its exit status checked, and an unresolvable
  # state REFUSES rather than silently reads as a value. A gate degrades
  # toward refuse, never toward permit. Before this fix, ANY merge-base
  # failure -- corrupted ref, missing object, or any other instrument
  # failure, not just "no common ancestor" -- read as "ungoverned" and
  # skipped the branch with no report to anyone, which TP's own fault
  # injection proved collapses the entire guard to a false "clean" the
  # moment merge-base breaks for any reason. git merge-base's own
  # documented exit codes distinguish the two cases: exit 1 with no output
  # means genuinely no common ancestor (a real, expected negative);
  # anything else (128 for a bad revision, or any other nonzero) is the
  # tool failing to answer the question at all. Only exit 1 with empty
  # output is treated as ungoverned; every other nonzero refuses the whole
  # run, naming the branch and the command that failed.
  _ref=$1
  _trunk=$2
  _fork=$(_g merge-base "$_ref" "$_trunk" 2>/dev/null)
  _fork_status=$?
  if [ "$_fork_status" -eq 1 ] && [ -z "$_fork" ]; then
    return 1
  fi
  if [ "$_fork_status" -ne 0 ] || [ -z "$_fork" ]; then
    rm -f "$_wt_records" "$_wt_map" "$_branches"
    _block "could not determine $_ref's fork point against $_trunk (git merge-base exited $_fork_status, not the documented 'no common ancestor' exit of 1). Not treating an instrument failure as ungoverned. No disposability check ran."
    exit 1
  fi

  _g merge-base --is-ancestor "$INSTALL_SHA" "$_fork" 2>/dev/null
  _anc_status=$?
  if [ "$_anc_status" -gt 1 ]; then
    rm -f "$_wt_records" "$_wt_map" "$_branches"
    _block "could not determine whether $_ref's fork point ($_fork) is governed (git merge-base --is-ancestor exited $_anc_status, not 0 or 1). Not treating an instrument failure as ungoverned. No disposability check ran."
    exit 1
  fi
  [ "$_anc_status" -eq 0 ]
}

# --- detector A: git cherry, patch-id equivalence -----------------------
# opeff#870-class miss found by QA-Scout-1 on _R1#167 gate 1: several
# branches that each append to the SAME file, squash-merged into trunk in
# sequence, all fully present in trunk, but reverse-apply (detector B below)
# only catches the LAST one. Once trunk grows past an earlier fossil's
# append point, that fossil's diff carries a hunk whose trailing-context
# boundary no longer exists in trunk, so `git apply --reverse --check` fails
# on a change that genuinely is already there. `git cherry` doesn't diff
# against a tree at all: it compares each commit's PATCH-ID (a hash of the
# diff's content, insensitive to where in the file it now lands) against
# every commit already in trunk's history. That makes it blind to trunk
# having grown past the original hunk boundary, which is exactly the case
# reverse-apply misses.
_is_cherry_fossil() {
  # $1 = candidate ref, $2 = trunk ref. Returns 0 if every commit unique to
  # $1 has a patch-id equivalent already in $2 (git cherry prints "- <sha>"
  # for those). Returns 1 if $1 has at least one commit with no equivalent
  # (a "+ <sha>" line). Caller must already have confirmed $1 is ahead of
  # $2 -- a zero-commit branch produces no cherry output at all, which is
  # indistinguishable from "all equivalent" by output alone.
  #
  # git cherry's own exit status is 0 for any completed comparison,
  # regardless of whether it finds "+" or "-" lines or no lines at all; it
  # is nonzero only when it genuinely fails to run (bad revision, and the
  # like). So unlike a detector with a documented negative exit code,
  # ANY nonzero exit here is an instrument failure, never a valid "no"
  # answer. Refuse rather than silently fall through to detector B as if
  # this detector had legitimately found nothing.
  _ref=$1
  _trunk=$2
  _out=$(_g cherry "$_trunk" "$_ref" 2>/dev/null)
  _cherry_status=$?
  if [ "$_cherry_status" -ne 0 ]; then
    rm -f "$_wt_records" "$_wt_map" "$_branches"
    _block "could not run git cherry for $_ref against $_trunk (exit $_cherry_status). Not treating an instrument failure as detector A finding nothing."
    exit 1
  fi
  printf '%s\n' "$_out" | grep -q '^+' && return 1
  return 0
}

# --- detector B: reverse-apply against trunk's tree, never --is-ancestor --
# `git merge-base --is-ancestor` exits 1 on a squash-merged branch, since
# squash never creates a real ancestor edge; that check is never used for
# content-presence here. This reverse-applies the branch's diff onto
# trunk's tree in a scratch index instead: if trunk already contains every
# change, the reverse-apply is clean. It catches a squash of MULTIPLE
# commits into one diff (a single patch-id, which detector A cannot match
# against trunk's separately-committed history) -- the case detector A was
# chosen for, and the reason neither detector replaces the other. The
# FORWARD form (apply the diff, compare resulting tree hash to trunk's) is
# deliberately NOT used: a patch that fails to apply at all leaves the
# scratch index untouched, so its tree hash still equals trunk's BY
# CONSTRUCTION, making a failed apply indistinguishable from a no-op one.
# Only the reverse form's own exit code tells the two apart.
_is_reverse_apply_fossil() {
  # $1 = candidate ref, $2 = trunk ref. Returns 0 if every change $1 makes
  # relative to its merge-base with $2 is already present in $2's tree.
  #
  # ONE CONTRACT (Overwatch actuator, _R1#167): every git call below has
  # its exit status checked. merge-base's exit 1 with empty output is its
  # documented "no common ancestor" negative and is trusted; every other
  # failure, from merge-base, diff, read-tree, or apply, refuses the whole
  # run rather than silently reporting "not present" and letting the
  # branch through unflagged, or (for apply's DEFECT 1 case) reporting
  # "present" and handing out a destructive disposal command. TP's own
  # fault injection proved diff failing turns an empty patch file into a
  # false "content present" for FOUR shapes that must stay silent
  # (mode-only, rename-only, whitespace-only, CRLF-only, binary-only), so
  # instrument failure here must never be read as the DEFECT 4 empty-diff
  # case below, which requires a genuinely successful, genuinely empty diff.
  _ref=$1
  _trunk=$2

  _base=$(_g merge-base "$_ref" "$_trunk" 2>/dev/null)
  _base_status=$?
  if [ "$_base_status" -eq 1 ] && [ -z "$_base" ]; then
    return 1 # documented "no common ancestor": a real negative, not a failure
  fi
  if [ "$_base_status" -ne 0 ] || [ -z "$_base" ]; then
    rm -f "$_wt_records" "$_wt_map" "$_branches"
    _block "could not determine $_ref's merge-base with $_trunk (git merge-base exited $_base_status). Not treating an instrument failure as not-present."
    exit 1
  fi

  _scratch=$(mktemp -d 2>/dev/null) || {
    rm -f "$_wt_records" "$_wt_map" "$_branches"
    _block "could not create a scratch directory to check $_ref's content presence."
    exit 1
  }
  _patch="$_scratch/patch.diff"
  _index="$_scratch/index"
  _apply_stderr="$_scratch/apply.stderr"

  _g diff "$_base" "$_ref" >"$_patch" 2>/dev/null
  _diff_status=$?
  if [ "$_diff_status" -ne 0 ]; then
    # Exit status checked directly (not piped): a failed diff must not be
    # read as an empty, all-present patch (DEFECT 4's own shortcut, right
    # below, requires a genuinely successful empty diff, not a failed one).
    rm -rf "$_scratch"
    rm -f "$_wt_records" "$_wt_map" "$_branches"
    _block "could not diff $_ref against its merge-base $_base with $_trunk (git diff exited $_diff_status). Not treating an instrument failure as not-present."
    exit 1
  fi

  if [ ! -s "$_patch" ]; then
    rm -rf "$_scratch"
    # DEFECT 4 (_R1#167 G1_BOUNCE 4): an empty diff between the branch and
    # its own merge-base with trunk means the branch's unique commits made
    # NO content change at all (e.g. `git commit --allow-empty`). That is
    # not evidence trunk already contains the branch's work -- there is no
    # work to compare. The old shortcut returned 0 here and the BLOCK line
    # said "already in $TRUNK_REF", which is false: nothing was ever
    # contributed. Treat it as not-content-present; ahead-count already
    # excludes the zero-commit fresh-branch case upstream of this call, and
    # a real zero-diff duplicate is detector A's job, not this shortcut's.
    # This shortcut is reached only when `git diff` above exited 0, so an
    # empty patch here is a genuine, trusted negative, never a failure.
    return 1
  fi

  GIT_INDEX_FILE="$_index" _g read-tree "$_trunk" 2>/dev/null
  _read_status=$?
  if [ "$_read_status" -ne 0 ]; then
    rm -rf "$_scratch"
    rm -f "$_wt_records" "$_wt_map" "$_branches"
    _block "could not read $_trunk into a scratch index to check $_ref (git read-tree exited $_read_status). Not treating an instrument failure as not-present."
    exit 1
  fi

  # Writes nothing to the working tree. GIT_INDEX_FILE pointed at the
  # scratch index is the whole point: a caller's real staged changes are
  # never touched by this check.
  #
  # DEFECT 1 (_R1#167 G1_BOUNCE 4), worst one: a branch whose only change
  # is a file mode flip (e.g. chmod +x, 100644 -> 100755) is genuine,
  # unmerged work. `git apply --check` WARNS about the mode divergence on
  # stderr and still exits 0, because the check is content-only by
  # default. Trusting the exit code alone called that a fossil and handed
  # the caller `git branch -D`. Content presence must fail toward
  # NOT-present: any stderr from this check, mode warning or otherwise,
  # means the exit code is not trusted for this input, so the branch is
  # reported as NOT content-present. A missed fossil leaves clutter; a
  # false refusal here deletes real work.
  #
  # Exit 1 (apply's documented "does not apply") is a genuine negative.
  # Anything higher is apply itself failing to evaluate the question,
  # which refuses rather than silently reporting not-present.
  GIT_INDEX_FILE="$_index" _g apply --cached --reverse --check "$_patch" 2>"$_apply_stderr"
  _apply_status=$?
  _apply_warnings=$(cat "$_apply_stderr" 2>/dev/null)
  rm -rf "$_scratch"
  if [ "$_apply_status" -eq 0 ] && [ -z "$_apply_warnings" ]; then
    return 0
  fi
  if [ "$_apply_status" -gt 1 ]; then
    rm -f "$_wt_records" "$_wt_map" "$_branches"
    _block "could not check whether $_ref reverse-applies onto $_trunk (git apply exited $_apply_status). Not treating an instrument failure as not-present."
    exit 1
  fi
  return 1
}

# --- combined content-presence check: ahead-count, then cherry, then ------
# --- reverse-apply, OR-combined. Each detector catches what the other ------
# --- misses; neither one false-positives on genuine unmerged work. ---------
_DETECTOR=""
_is_content_present() {
  # $1 = candidate ref, $2 = trunk ref. Sets _DETECTOR to the name of
  # whichever check fired, for the BLOCK line -- a combined boolean that
  # doesn't say which detector caught it hides a detector silently going
  # dark, which is the exact class of gap this fix exists to close.
  _ref=$1
  _trunk=$2
  _DETECTOR=""

  # Cheap discriminator, checked first, short-circuits before both detectors
  # below. A fossil had work that is now in trunk; a fresh branch never had
  # work. An empty diff (or no cherry output) cannot tell the two apart on
  # its own: a brand-new branch just created off trunk looks the same as a
  # fossil to either detector. Commits-ahead can (_R1#167 G1_BOUNCE).
  #
  # ONE CONTRACT (Overwatch actuator, _R1#167): TP's own fault injection
  # found this exact line is a global off-switch. The original code read
  # `git rev-list --count` failing (empty output, any exit status) the
  # SAME as "genuinely zero commits ahead" -- both make `[ -n "$_ahead" ]`
  # false, so both `return 1` (skip this branch, nothing to check). A
  # broken rev-list therefore silently skipped EVERY branch on EVERY call,
  # collapsing the whole guard to a false "clean" with real fossils sitting
  # in front of it -- worse than any single detector breaking, because this
  # check runs before either detector ever gets a chance. Empty output (or
  # a nonzero exit) is now treated as UNKNOWN, not zero: refuse, don't
  # silently skip. A genuinely-resolved, genuinely-zero count is still the
  # normal, silent "nothing to check yet" case.
  _ahead=$(_g rev-list --count "$_trunk..$_ref" 2>/dev/null)
  _ahead_status=$?
  if [ "$_ahead_status" -ne 0 ] || [ -z "$_ahead" ]; then
    rm -f "$_wt_records" "$_wt_map" "$_branches"
    _block "could not determine how many commits $_ref is ahead of $_trunk (git rev-list --count exited $_ahead_status). Not treating an instrument failure as a fresh, nothing-to-check branch."
    exit 1
  fi
  [ "$_ahead" -gt 0 ] || return 1

  # git cherry before reverse-apply: cheaper (no scratch index, no patch
  # file, no read-tree/apply forks) and it is the detector ruling-2's
  # timing number benefits most from short-circuiting on.
  if _is_cherry_fossil "$_ref" "$_trunk"; then
    _DETECTOR="git cherry (patch-id)"
    return 0
  fi

  if _is_reverse_apply_fossil "$_ref" "$_trunk"; then
    _DETECTOR="reverse-apply"
    return 0
  fi

  return 1
}

# --- cheap dirty check, always run before the expensive content check -------
# DEFECT 2 (_R1#167 G1_BOUNCE 4): the prior version piped `git status
# --porcelain` straight into awk. Piping means this function's exit status
# was always awk's, never git status's, so a worktree with a broken .git
# pointer (`fatal: not a git repository`, exit 128) was never distinguished
# from a clean one -- its stderr went to /dev/null and awk happily counted
# zero lines of an empty stream. The guard then read "0 uncommitted
# changes" as clean and, if content-present, printed `git worktree remove
# --force` for a worktree that in fact held real, unreadable content.
# _count_dirty now sets _DIRTY_STATE to one of clean, dirty, or unknown,
# and never pipes git status into anything: its own $? is read directly.
_DIRTY_STATE=""
_DIRTY_COUNT=0
_count_dirty() {
  # $1 = worktree path. Sets _DIRTY_STATE and _DIRTY_COUNT (globals, POSIX
  # sh has no multi-value return). unknown must be treated by the caller
  # exactly like DISPOSABLE-BUT-DIRTY: refuse, no removal command.
  _wt=$1
  _out=$(git -C "$_wt" status --porcelain 2>/dev/null)
  _status=$?
  if [ "$_status" -ne 0 ]; then
    _DIRTY_STATE="unknown"
    _DIRTY_COUNT=0
    return
  fi
  if [ -z "$_out" ]; then
    _DIRTY_STATE="clean"
    _DIRTY_COUNT=0
  else
    _DIRTY_STATE="dirty"
    _DIRTY_COUNT=$(printf '%s\n' "$_out" | grep -c .)
  fi
}

# --- enumerate worktrees. git-common-dir, never directory position ---------
_common_dir=$(_g rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
if [ -z "$_common_dir" ]; then
  _block "could not resolve --git-common-dir for $_REPO. Cannot enumerate worktrees safely."
  exit 1
fi

_wt_porcelain=$(mktemp 2>/dev/null) || { _block "could not create a temp file for worktree enumeration."; exit 1; }
git -C "$_common_dir" worktree list --porcelain >"$_wt_porcelain" 2>/dev/null
_wt_list_status=$?
if [ "$_wt_list_status" -ne 0 ]; then
  # Checked directly, not left to fall through: a failed listing must not
  # be read as "zero worktrees found."
  rm -f "$_wt_porcelain"
  _block "could not enumerate worktrees: 'git worktree list --porcelain' failed against $_common_dir (exit $_wt_list_status). Not treating a failed listing as zero worktrees. No disposability check ran."
  exit 1
fi
if [ ! -s "$_wt_porcelain" ]; then
  # ONE CONTRACT (Overwatch actuator): exit 0 with empty output is not the
  # same claim as "zero worktrees" -- `git worktree list` always reports at
  # least the main worktree the command is run from, so an entirely empty
  # listing at exit 0 is the tool failing to answer, not a real repo state.
  rm -f "$_wt_porcelain"
  _block "'git worktree list --porcelain' against $_common_dir returned nothing, even the main worktree. Not treating an empty listing as zero worktrees. No disposability check ran."
  exit 1
fi

_wt_records=$(mktemp 2>/dev/null) || { rm -f "$_wt_porcelain"; _block "could not create a temp file for worktree records."; exit 1; }
: >"$_wt_records"
_TAB=$(printf '\t')

_cur_path=""
_cur_branch=""
_cur_prune=""
_flush_wt_record() {
  if [ -n "$_cur_path" ]; then
    printf '%s\t%s\t%s\n' "$_cur_path" "$_cur_branch" "$_cur_prune" >>"$_wt_records"
  fi
  _cur_path=""
  _cur_branch=""
  _cur_prune=""
}
while IFS= read -r _line; do
  case "$_line" in
  "worktree "*)
    _flush_wt_record
    _cur_path=${_line#worktree }
    ;;
  "branch "*)
    _b=${_line#branch }
    _cur_branch=${_b#refs/heads/}
    ;;
  "prunable "*)
    _cur_prune=${_line#prunable }
    ;;
  "")
    _flush_wt_record
    ;;
  esac
done <"$_wt_porcelain"
_flush_wt_record
rm -f "$_wt_porcelain"

_main_path=$(head -1 "$_wt_records" | cut -f1)
_main_branch=$(awk -F"$_TAB" -v p="$_main_path" '$1==p{print $2; exit}' "$_wt_records")

# Report prunable records first: always safe to recommend, dirty check does
# not apply (there is no working tree left to lose).
while IFS="$_TAB" read -r _path _branch _prune; do
  [ -n "$_prune" ] || continue
  _block "worktree record already prunable: $_path ($_prune). Disposal: git worktree prune"
done <"$_wt_records"

# Map of non-prunable, non-main worktree paths keyed by branch.
_wt_map=$(mktemp 2>/dev/null) || { rm -f "$_wt_records"; _block "could not create a temp file for the worktree/branch map."; exit 1; }
: >"$_wt_map"
while IFS="$_TAB" read -r _path _branch _prune; do
  [ -z "$_prune" ] || continue
  [ -n "$_branch" ] || continue
  [ "$_path" = "$_main_path" ] && continue
  printf '%s\t%s\n' "$_branch" "$_path" >>"$_wt_map"
done <"$_wt_records"

# --- walk every local branch, decide disposability ---------------------------
_branches=$(mktemp 2>/dev/null) || { rm -f "$_wt_records" "$_wt_map"; _block "could not create a temp file for branch enumeration."; exit 1; }
_g for-each-ref --format='%(refname:short)' refs/heads/ >"$_branches" 2>/dev/null
_branches_status=$?
if [ "$_branches_status" -ne 0 ]; then
  # Same class as the worktree-list check above: a failed listing must
  # refuse, not silently process zero branches as a clean repo.
  rm -f "$_wt_records" "$_wt_map" "$_branches"
  _block "could not enumerate local branches: 'git for-each-ref refs/heads/' failed in $_REPO (exit $_branches_status). Not treating a failed listing as zero branches. No disposability check ran."
  exit 1
fi
if [ ! -s "$_branches" ]; then
  # ONE CONTRACT (Overwatch actuator): TP's own fault injection proved this
  # exact shape, `for-each-ref` exiting 0 with empty output, collapses the
  # guard to a false "clean". Unlike worktree list, an empty branch list at
  # exit 0 CAN be genuine (a repo where the only local branch is trunk
  # itself, filtered out below before ever reaching this loop's body -- see
  # "passes when the only branch is trunk itself"). Distinguish the two
  # with an independent query: trunk is a local branch too whenever it is
  # checked out, so if refs/heads/$TRUNK_BRANCH genuinely exists but
  # for-each-ref reported NOTHING, not even trunk's own name, for-each-ref
  # did not enumerate reliably.
  if _g rev-parse --verify --quiet "refs/heads/$TRUNK_BRANCH" >/dev/null 2>&1; then
    rm -f "$_wt_records" "$_wt_map" "$_branches"
    _block "'git for-each-ref refs/heads/' in $_REPO returned nothing, even though refs/heads/$TRUNK_BRANCH exists. Not treating an empty listing as zero branches. No disposability check ran."
    exit 1
  fi
fi

while IFS= read -r _branch; do
  [ -n "$_branch" ] || continue
  [ "$_branch" = "$TRUNK_BRANCH" ] && continue
  _branch_governed "$_branch" "$TRUNK_REF" || continue

  _wt_path=$(awk -F"$_TAB" -v b="$_branch" '$1==b{print $2; exit}' "$_wt_map")

  if [ -n "$_wt_path" ]; then
    _count_dirty "$_wt_path"
    case "$_DIRTY_STATE" in
      unknown)
        # DEFECT 2: git status itself failed (e.g. a corrupt or unreadable
        # .git pointer). Zero-dirty and cannot-measure-dirty must never
        # render identically. Refused exactly like DISPOSABLE-BUT-DIRTY: no
        # removal command, owner decides.
        _block "worktree UNKNOWN dirty-state: $_branch ($_wt_path) -- git status could not be read (corrupt or unreadable .git). No removal command. Its owner decides."
        continue
        ;;
      dirty)
        if _is_content_present "$_branch" "$TRUNK_REF"; then
          _block "worktree DISPOSABLE-BUT-DIRTY: $_branch ($_wt_path) already in $TRUNK_REF (detected via $_DETECTOR), holds $_DIRTY_COUNT uncommitted change(s). No removal command. Its owner decides."
        fi
        continue
        ;;
    esac
  fi

  if _is_content_present "$_branch" "$TRUNK_REF"; then
    if [ -n "$_wt_path" ]; then
      _block "worktree already in $TRUNK_REF (detected via $_DETECTOR): $_branch ($_wt_path). Disposal: git worktree remove --force $_wt_path"
    elif [ "$_branch" = "$_main_branch" ]; then
      _block "branch already in $TRUNK_REF (detected via $_DETECTOR, checked out in the main worktree): $_branch. Disposal: git checkout $TRUNK_BRANCH && git branch -D $_branch"
    else
      _block "branch already in $TRUNK_REF (detected via $_DETECTOR): $_branch. Disposal: git branch -D $_branch"
    fi
  fi
done <"$_branches"

rm -f "$_wt_records" "$_wt_map" "$_branches"

if [ "$_fail" -eq 0 ]; then
  _info "clean. No local branch or worktree is fully contained in $TRUNK_REF."
  exit 0
fi

echo "hygiene-guard: REFUSE. Fossil state found relative to $TRUNK_REF. See BLOCK line(s) above. Clean these up, then push again." >&2
exit 1
