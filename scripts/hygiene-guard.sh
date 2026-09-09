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
# Usage: sh hygiene-guard.sh [repo-path] [remote-name]
#   repo-path    defaults to the current directory. Passed so this can be
#                tested against a repo other than the one it's invoked in;
#                a real pre-push invocation never needs to pass it, git already
#                runs the hook with cwd inside the repo being pushed.
#   remote-name  defaults to "origin".
#
# Exit 0: clean, nothing disposable found.
# Exit 1: REFUSE. Either trunk could not be resolved, or a fossil branch or
#         worktree was found. This is the guard's ONLY verdict channel --
#         read the exit code, not the printed text (control D5). Unlike
#         opeff's own check-shared-checkout.mjs (SC01), whose declared return
#         type is {severity: 'ok'|'warning'} and structurally cannot report a
#         blocking condition, this guard has a genuine failing path, and its
#         failing path is exercised and proven below, not merely declared.
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

# --- content-presence primitive: reverse-apply, never --is-ancestor ---------
_is_content_present() {
  # $1 = candidate ref, $2 = trunk ref. Returns 0 if every change $1 makes
  # relative to its merge-base with $2 is already present in $2's tree.
  _ref=$1
  _trunk=$2

  # Cheap discriminator, checked first, short-circuits before the expensive
  # reverse-apply below. A fossil had work that is now in trunk; a fresh
  # branch never had work. An empty diff cannot tell the two apart on its
  # own: a brand-new branch just created off trunk has an empty diff against
  # its own merge-base for the same reason a fossil does. Commits-ahead can.
  _ahead=$(_g rev-list --count "$_trunk..$_ref" 2>/dev/null)
  [ -n "$_ahead" ] && [ "$_ahead" -gt 0 ] || return 1

  _base=$(_g merge-base "$_ref" "$_trunk" 2>/dev/null)
  _base_status=$?
  [ "$_base_status" -eq 0 ] && [ -n "$_base" ] || return 1

  _scratch=$(mktemp -d 2>/dev/null) || return 1
  _patch="$_scratch/patch.diff"
  _index="$_scratch/index"

  _g diff "$_base" "$_ref" >"$_patch" 2>/dev/null

  if [ ! -s "$_patch" ]; then
    rm -rf "$_scratch"
    return 0 # empty diff: nothing to reverse-apply, content is present
  fi

  GIT_INDEX_FILE="$_index" _g read-tree "$_trunk" 2>/dev/null
  _read_status=$?
  if [ "$_read_status" -ne 0 ]; then
    rm -rf "$_scratch"
    return 1
  fi

  # Writes nothing to the working tree. GIT_INDEX_FILE pointed at the
  # scratch index is the whole point: a caller's real staged changes are
  # never touched by this check.
  GIT_INDEX_FILE="$_index" _g apply --cached --reverse --check "$_patch" 2>/dev/null
  _apply_status=$?
  rm -rf "$_scratch"
  [ "$_apply_status" -eq 0 ] && return 0
  return 1
}

# --- cheap dirty check, always run before the expensive content check -------
_count_dirty() {
  # $1 = worktree path. Prints the count of git status --porcelain entries.
  git -C "$1" status --porcelain 2>/dev/null | awk 'NF{c++} END{print c+0}'
}

# --- enumerate worktrees. git-common-dir, never directory position ---------
_common_dir=$(_g rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
if [ -z "$_common_dir" ]; then
  _block "could not resolve --git-common-dir for $_REPO. Cannot enumerate worktrees safely."
  exit 1
fi

_wt_porcelain=$(mktemp 2>/dev/null)
git -C "$_common_dir" worktree list --porcelain >"$_wt_porcelain" 2>/dev/null

_wt_records=$(mktemp 2>/dev/null)
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
_wt_map=$(mktemp 2>/dev/null)
: >"$_wt_map"
while IFS="$_TAB" read -r _path _branch _prune; do
  [ -z "$_prune" ] || continue
  [ -n "$_branch" ] || continue
  [ "$_path" = "$_main_path" ] && continue
  printf '%s\t%s\n' "$_branch" "$_path" >>"$_wt_map"
done <"$_wt_records"

# --- walk every local branch, decide disposability ---------------------------
_branches=$(mktemp 2>/dev/null)
_g for-each-ref --format='%(refname:short)' refs/heads/ >"$_branches" 2>/dev/null

while IFS= read -r _branch; do
  [ -n "$_branch" ] || continue
  [ "$_branch" = "$TRUNK_BRANCH" ] && continue

  _wt_path=$(awk -F"$_TAB" -v b="$_branch" '$1==b{print $2; exit}' "$_wt_map")

  if [ -n "$_wt_path" ]; then
    _dirty=$(_count_dirty "$_wt_path")
    if [ "$_dirty" -gt 0 ]; then
      if _is_content_present "$_branch" "$TRUNK_REF"; then
        _block "worktree DISPOSABLE-BUT-DIRTY: $_branch ($_wt_path) already in $TRUNK_REF, holds $_dirty uncommitted change(s). No removal command. Its owner decides."
      fi
      continue
    fi
  fi

  if _is_content_present "$_branch" "$TRUNK_REF"; then
    if [ -n "$_wt_path" ]; then
      _block "worktree already in $TRUNK_REF: $_branch ($_wt_path). Disposal: git worktree remove --force $_wt_path"
    elif [ "$_branch" = "$_main_branch" ]; then
      _block "branch already in $TRUNK_REF (checked out in the main worktree): $_branch. Disposal: git checkout $TRUNK_BRANCH && git branch -D $_branch"
    else
      _block "branch already in $TRUNK_REF: $_branch. Disposal: git branch -D $_branch"
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
