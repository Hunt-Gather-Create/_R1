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
# Usage: sh hygiene-guard.sh [repo-path] [remote-name] [guard-path] [hold-path] [trunk-branch]
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
#   hold-path    defaults to ".hygiene-hold". This repo's path, relative to
#                repo root, to the tracked hold list in trunk history (see
#                "HOLD LIST" below). A repo with no such file at that path
#                in trunk cannot push at all through this guard until one
#                is added, even an empty one -- fail-closed on purpose.
#                MUST be a regular file, never a symlink: `git show
#                ref:path` on a symlink returns the link text itself, not
#                the target's content, so a symlinked hold list reads as
#                unparseable data and this guard refuses (fails safe, but
#                the cause looks like a parser bug to whoever tries to
#                share one hold list across repos this way).
#   trunk-branch defaults to empty, meaning "resolve it from remote-name's
#                own HEAD", exactly as before this argument existed (_R1#171).
#                Pass a branch name (never a "<remote>/<branch>" ref) to
#                override that resolution outright -- needed by any fork
#                whose remote's default branch is not the same name as the
#                fork's own trunk (_R1: remote "upstream" defaults to
#                "main", trunk is "runway"). An explicit value that does not
#                resolve as "<remote-name>/<trunk-branch>" REFUSES; it never
#                falls back to HEAD-derived resolution, on the same
#                degrade-toward-refuse contract as every other input here.
#
# Stdin: this script now reads the pre-push ref-update stream from stdin
# ("<local ref> <local sha> <remote ref> <remote sha>", one line per ref
# being pushed -- see "FORCE-PUSH ORPHAN PROTECTION" below). A real
# pre-push invocation always has this connected, even to an empty stream;
# an interactive terminal on stdin is treated as a caller that forgot to
# wire it up and REFUSES rather than guessing "no ref updates". Piping
# nothing explicitly (`printf '' | sh hygiene-guard.sh ...`) is the
# genuine empty-push-spec case and proceeds.
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
#
# FORCE-PUSH ORPHAN PROTECTION (Overwatch ruling, _R1#167 G1_BOUNCE): the
# leftover-nag mechanism above and the hold list below are both gated on
# something being left BEHIND -- content already in trunk, or a ref being
# DELETED. A force-push moves a ref to a new commit and deletes no ref, so
# a disposability check never runs (nothing was left behind) and neither
# hold key sees a deletion to refuse. All three are working exactly as
# designed and all three are silent on a force-push that makes a held
# commit unreachable. This guard reads the pre-push ref-update stream on
# stdin (see "Stdin" above) and refuses any update that would make a
# held, resolvable object unreachable -- a deletion is just the special
# case whose new tip is nothing.
#
# This is a SEPARATE trigger from the leftover nag, with its own refusal
# reason, so a reader can tell which one fired. It is also held to a
# STRICTER posture: the leftover nag's worst failure mode leaves a stale,
# recoverable branch sitting around, so this file happens to fail closed
# there too, but that is this guard choosing to be stricter than the job
# requires. This trigger protects hand-authored work that cannot be
# reconstructed if lost, so it FAILS CLOSED, ALWAYS, on every instrument
# it depends on (stdin itself, git cat-file, git merge-base
# --is-ancestor) -- there is no flag, override, or exception on this side,
# and there must never be one added later.
#
# A THIRD instance of this same asymmetry (TP, _R1#167): a branch whose
# work LANDED and was then FURTHER EDITED on trunk afterward is not
# detected as a fossil, by construction. Both detectors below miss it --
# git cherry finds no patch-id equivalence because the patches genuinely
# differ once trunk moved on, and reverse-apply cannot apply because the
# surrounding context no longer matches. `git apply --3way` WOULD catch
# this shape, but it is deliberately not used: 3-way returns success on
# GENUINELY unmerged, hand-authored work too (measured: "Applied patch
# ... with conflicts", exit 0, on real unmerged content, not only on a
# landed-then-drifted leftover), so it would hand a caller `git branch -D`
# on content that exists nowhere else. Missing a drifted leftover costs
# clutter. Catching it with 3-way costs someone's work. Same asymmetry as
# the force-push trigger above: this guard is built to be wrong toward
# leaving a stale branch alone, never toward destroying real content.
#
# A FOURTH KNOWN LIMIT (TP/CC, _R1#167): a branch whose own content already
# landed in trunk, and which then merges trunk back into itself to stay in
# sync, is invisible to BOTH detectors below, not just one. `git cherry`
# reports a spurious '+' for the branch's own commit because the merge
# changes its patch-id (the same instability the force-push section above
# already lives with). Reverse-apply misses it too, for an unrelated reason:
# once the branch has merged trunk in, its merge-base with trunk moves to
# that merge, so the diff from merge-base to tip is empty, and this guard's
# own empty-diff-means-UNKNOWN rule (not IDENTICAL) reads that as
# not-a-fossil. That empty-diff rule is kept anyway, on purpose: it is what
# stops an empty diff from being misread as IDENTICAL, which is the
# safe-direction call this whole guard is built on. Losing it to catch this
# one shape would trade a DETECTOR that already errs toward missing a
# fossil for one that errs toward a wrong disposal, and that is a worse
# trade than the clutter this shape currently costs. This is a statement
# about the LEFTOVER-NAG DETECTOR ONLY -- the held-object check above does
# not share this posture and fails closed regardless, on every instrument
# it depends on, with no flag or exception (see the FORCE-PUSH ORPHAN
# PROTECTION section above; Overwatch's two-posture ruling, _R1#167). Same
# asymmetry as above: the cost of missing this is one stale branch someone
# has to clean up by hand, never a destructive command.

set -u

# GIT_TRACE and its siblings write trace output to stderr (Overwatch/TP
# finding, _R1#167 G1_BOUNCE): this guard used to treat ANY stderr from
# `git apply --check` as a verdict, so a developer's debug env var
# silently defeated the reverse-apply detector on every branch -- a real,
# multi-commit-squash fossil read as clean, exit 0, no BLOCK line. Fixed
# below by no longer reading apply's stderr for a verdict at all (see
# _mode_diverges), but this guard's OWN git calls must also never inherit
# trace/verbose settings from the invoking shell, on general principle and
# so the timing numbers stay stable. Unset the whole family once, here,
# before the first git call runs anywhere in this file, so no call site --
# inside _g or one of the handful that bypass it -- can forget to.
for _trace_var in GIT_TRACE GIT_TRACE_FSMONITOR GIT_TRACE_PACK_ACCESS \
  GIT_TRACE_PACKET GIT_TRACE_PACKFILE GIT_TRACE_PERFORMANCE GIT_TRACE_REFS \
  GIT_TRACE_SETUP GIT_TRACE_SHALLOW GIT_TRACE_CURL GIT_TRACE_CURL_NO_DATA \
  GIT_CURL_VERBOSE GIT_TRACE2 GIT_TRACE2_EVENT GIT_TRACE2_PERF \
  GIT_TRACE2_BRIEF GIT_TRACE2_CONFIG_PARAMS GIT_TRACE2_ENV_VARS \
  GIT_TRACE2_PARENT_SID; do
  unset "$_trace_var"
done

# A real pre-push invocation runs this script with GIT_DIR set in the
# environment to the pushing worktree's own gitdir (TP, _R1#175). GIT_DIR
# overrides every -C flag below, in _g and at the handful of call sites
# that bypass it, so without this the repo argument this script was told
# to inspect is advisory: git reads GIT_DIR's index/refs against whatever
# directory -C names, producing either a false clean (a real fossil in
# $_REPO goes unseen because GIT_DIR points elsewhere) or a block naming a
# ref that does not exist in $_REPO at all. GIT_WORK_TREE, GIT_INDEX_FILE
# and GIT_COMMON_DIR are the same class of leak and are scrubbed for the
# same reason, even though TP's env sweep found only GIT_DIR itself
# currently flips a verdict. Same placement and rationale as the
# GIT_TRACE family above: once, before the first git call anywhere in
# this file, so no call site can forget to.
for _repo_var in GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR; do
  unset "$_repo_var"
done

_REPO="${1:-$(pwd)}"
_REMOTE="${2:-origin}"
_GUARD_PATH="${3:-scripts/hygiene-guard.sh}"
_TRUNK_OVERRIDE="${5:-}"
# _MODE (opeff#1040): "push" (default) is everything this file did before
# this arg existed -- the pre-push stdin protocol, the local branch/worktree
# walk under refs/heads/. "remote-sweep" is a second, additive mode: it
# skips the pre-push-only machinery entirely and instead walks
# refs/remotes/$_REMOTE/, reporting the same content-presence verdict a
# scheduled, non-push caller can read (see the remote-sweep block below).
# Validated once _block exists, a few lines down, so a bad value gets the
# same BLOCK-and-refuse treatment as every other malformed input here.
_MODE="${6:-push}"

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

case "$_MODE" in
  push | remote-sweep) ;;
  *)
    _block "unrecognized mode '$_MODE' (6th argument); must be 'push' or 'remote-sweep'. Not guessing which one was meant."
    exit 1
    ;;
esac

# QA gap (_R1#167 G1_BOUNCE): a worktree path containing a space, entirely
# ordinary on macOS, made the printed `git worktree remove --force <path>`
# fail with exit 129 when pasted verbatim -- not destructive, but the
# guard's one job on that line is to hand a human a command that works.
# Single-quote the value, escaping any embedded single quote the standard
# POSIX-sh way: close the quote, emit an escaped literal quote, reopen it.
_shquote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# QA gap (_R1#167 G1_BOUNCE): a malformed hold-list entry's diagnostic
# printed the raw line, which reads as fine when the actual problem is a
# non-printing character attached to it (a trailing CR being the case QA
# found). `sed -n l` renders control characters as visible escapes and
# marks the true end of the line, so a hidden character shows up instead
# of accusing a field that looks correct.
_visible() {
  printf '%s' "$1" | sed -n 'l'
}

# Defined this early (not down by the worktree-enumeration code that used
# to be its only reader) because _check_orphaned_holds, called well before
# that section ever runs, also reads TAB-separated records and would
# otherwise reference this under `set -u` before it was ever assigned.
_TAB=$(printf '\t')

# Initialized empty here, unconditionally, so `set -u` never trips: a
# detector function's own failure-cleanup path (_is_cherry_fossil,
# _is_reverse_apply_fossil, _branch_governed) references these four
# unconditionally on an instrument-failure exit, and MODE=remote-sweep
# below skips every push-mode block that would otherwise mktemp them a
# real path. Push mode overwrites all four with real temp files before any
# of them are read for anything but cleanup; remote-sweep mode never
# creates worktree/branch temp files at all, so they stay empty here and
# an eventual `rm -f ""` is a harmless no-op.
_wt_records=""
_wt_map=""
_branches=""
_STDIN_FILE=""

# --- read stdin: the pre-push ref-update stream, captured once, up front ---
# MODE=remote-sweep never reads this: it is not a real push, so there is no
# ref-update stream to protect the force-push-orphan trigger with, and
# requiring one here would make a scheduled, non-interactive caller either
# fabricate a fake stream or get refused for having none to give.
if [ "$_MODE" = "push" ]; then
# Overwatch ruling (_R1#167 G1_BOUNCE): a force-push deletes no ref, so the
# leftover check above (content already in trunk) never fires on it, a
# name-keyed hold sees the name still present, and an object-keyed hold sees
# no deletion to refuse. All three are working exactly as designed and all
# three are silent on a force-push that orphans a held commit. The one input
# that DOES see a force-push is the pre-push protocol itself: git puts one
# line per ref being updated on this script's stdin, "<local ref> <local
# sha> <remote ref> <remote sha>". This guard used to consume none of it.
#
# Captured HERE, once, before any other command runs, so the rest of the
# script never has to reason about whether stdin has already been read.
# Nothing downstream of this guard's own invocation (the test-suite step in
# scripts/hooks/pre-push) reads stdin itself, so there is nothing left to
# starve by consuming it here.
#
# A real git pre-push invocation ALWAYS connects stdin to a pipe carrying
# that stream, even when it is empty (git does not invoke the hook at all
# if there is nothing to push). An interactive terminal on stdin means
# nobody piped that stream in at all -- a caller invoking this script
# directly without wiring stdin up, not a legitimate "no ref updates"
# state. Empty stdin (a pipe that yields zero bytes) IS a legitimate state
# and proceeds; the two must not render alike, same shape as the hold
# list's missing-vs-empty distinction above.
if [ -t 0 ]; then
  _block "stdin is a terminal, not the pre-push ref-update stream (git puts one '<local ref> <local sha> <remote ref> <remote sha>' line per updated ref there). Refusing rather than treating an unconnected stdin as 'no ref updates'. Pipe the ref-update stream in, the way git's own pre-push invocation does."
  exit 1
fi
_STDIN_FILE=$(mktemp 2>/dev/null) || { _block "could not create a temp file to capture the pre-push ref-update stream."; exit 1; }
if ! cat >"$_STDIN_FILE" 2>/dev/null; then
  rm -f "$_STDIN_FILE"
  _block "could not read the pre-push ref-update stream from stdin. Not treating an unreadable stdin as 'no ref updates'. No disposability check ran."
  exit 1
fi
fi # $_MODE = push (stdin capture)

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

# An explicit trunk-branch override (5th arg) is validated and used as-is,
# with NO fallback to HEAD-derived resolution on failure: a caller that
# configured a trunk explicitly gets a refusal naming what it configured,
# never a silent switch to a different, unconfigured answer (_R1#171).
if [ -n "$_TRUNK_OVERRIDE" ]; then
  if _g rev-parse --verify --quiet "refs/remotes/$_REMOTE/$_TRUNK_OVERRIDE" >/dev/null 2>&1; then
    TRUNK_BRANCH="$_TRUNK_OVERRIDE"
  else
    rm -f "$_STDIN_FILE"
    _block "configured trunk branch '$_TRUNK_OVERRIDE' does not resolve as '$_REMOTE/$_TRUNK_OVERRIDE' in $_REPO. Not falling back to HEAD-derived resolution for an explicitly configured trunk. No disposability check ran."
    exit 1
  fi
else
  TRUNK_BRANCH=$(_resolve_trunk)
  _trunk_status=$?
  if [ "$_trunk_status" -ne 0 ] || [ -z "$TRUNK_BRANCH" ]; then
    rm -f "$_STDIN_FILE"
    _block "could not resolve trunk from refs/remotes/$_REMOTE/HEAD or 'git remote show $_REMOTE' in $_REPO. Not guessing a branch name. No disposability check ran."
    exit 1
  fi
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
  rm -f "$_STDIN_FILE"
  _block "could not determine shallow-clone status for $_REPO (git rev-parse --is-shallow-repository failed, exit $_shallow_status). Not assuming a full clone. No disposability check ran."
  exit 1
fi
if [ "$_is_shallow" = "true" ]; then
  rm -f "$_STDIN_FILE"
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
  rm -f "$_STDIN_FILE"
  _block "could not resolve an install point: no commit on $TRUNK_REF adds '$_GUARD_PATH'. Not treating every branch as pre-dating install. No disposability check ran."
  exit 1
fi

# --- resolve the hold list: a held ref must never BECOME a disposal --------
# --- candidate, and must never refuse for a reason it would not otherwise -
# Overwatch spec addition (_R1#167, G1_QUEUED addendum), then TP's own
# self-correction on top of it: a held ref that IS a genuine disposal
# candidate gets the hold message printed IN PLACE OF the disposal command
# it would otherwise have received, still refusing (see the loop body,
# where this runs right after _is_content_present says yes). A held ref
# that is NOT a disposal candidate is silent, exactly as an unheld one
# would be -- the guard's first cut at this spec checked every governed
# branch against the hold list before _is_content_present ever ran, which
# refused the push for every held branch in the repo regardless of whether
# it was ever going to be recommended for disposal. Measured against
# agency-doc-kit's nine currently-held refs, that version blocked every
# push through the guard until every hold lifted, which can be weeks -- the
# exact wall Overwatch warned about, and a wall gets bypassed on day one.
# This list is still resolved and validated up front, independent of any
# one branch, so a malformed or unreadable hold list still refuses the
# WHOLE run before any branch is decided either way.
#
# Same trust model as the install point: read from TRUNK_REF's own history
# via `git show`, never the working tree. Forging or lifting a hold this
# way requires rewriting shared trunk history, not editing or deleting a
# file a seat can `rm`.
#
# _HOLD_PATH   defaults to ".hygiene-hold" at trunk root. Overridable as a
#              4th positional arg for a deployment that keeps it elsewhere.
#
# File format: one entry per line, "<branch-name> <sha> <class> [reason...]".
# Blank lines and lines starting with "#" are ignored. The name, a
# resolvable-looking SHA (or the literal "ANY", see below), and the class
# are all REQUIRED on every entry:
#   - a name-only match dies to a rename (the branch keeps its content and
#     its tip but changes the one field the entry keyed on);
#   - a SHA-only match dies to one more commit landing on the held branch
#     (the name survives, the tip does not) -- and a held branch getting
#     another commit is the ordinary case, not the exotic one.
# So a governed branch is held if EITHER its current name matches an
# entry's name column OR its current tip matches an entry's SHA column
# (once that SHA is confirmed to resolve to a real commit this clone has).
# Same OR-reasoning as the two fossil detectors: each half catches what
# the other misses, and here a false hold costs nothing, which makes the
# OR strictly safer than either half alone.
#
# CLASS COLUMN (_R1#167 G1_QUEUED, TP's item 4). One of three literal
# values, case-sensitive, nothing else legal:
#   OPERATOR-HOLD, COORDINATOR-HOLD -- a landing hold: this ref is expected
#     to eventually land and the hold to be lifted. The tip-moved advisory
#     below (name matches, recorded SHA does not) exists for these two
#     classes, because their recorded SHA is a snapshot that is expected to
#     go stale as work continues and needing re-recording is exactly the
#     situation worth flagging.
#   PERMANENT -- not a landing hold. The tip-moved advisory does NOT exist
#     for this class: a permanent hold is pinned by name, not by a
#     snapshot that is expected to catch up, so a SHA mismatch under
#     PERMANENT is reported as an ordinary hold, not as something needing
#     re-recording.
# The literal SHA value "ANY" is legal ONLY when the class column is
# PERMANENT -- it means this entry never pins a specific commit, matching
# by name alone regardless of tip. Under OPERATOR-HOLD or COORDINATOR-HOLD,
# a landing hold's whole point is to pin the exact commit under hold, so
# "ANY" there is a malformed entry, not a wildcard.
#
# An entry missing its SHA column, its class column, or whose name column begins with
# "$_REMOTE/" (looks like a remote-tracking ref pasted straight from a
# census instead of the local branch name the loop below actually walks),
# is a MALFORMED entry: the guard refuses the ENTIRE run and names the
# offending line. A malformed entry is never skipped and never silently
# dropped -- a guard that drops the one entry it could not parse is
# functionally identical, for that ref, to having no hold list at all,
# which is the exact failure this mechanism exists to rule out. Malformed
# hold list is unreadable hold list.
#
# A present-but-EMPTY file (0 bytes tracked at $_HOLD_PATH in trunk) is a
# genuine, silent "zero holds" state, distinguished on purpose from the
# file being absent from trunk entirely or `git show` otherwise failing to
# retrieve it, which REFUSES instead ("could not be read", nothing ran).
# An empty hold list and an unreadable one must never render identically.
_HOLD_PATH="${4:-.hygiene-hold}"
_hold_entries=$(mktemp 2>/dev/null) || { rm -f "$_STDIN_FILE"; _block "could not create a temp file for the hold list."; exit 1; }
: >"$_hold_entries"

# _R1#167 G2_BOUNCE: a hold entry's NAME can carry a byte that survives
# every existing validation (non-empty, not a remote-tracking ref) but can
# never equal a real ref -- a BOM or zero-width space glued to the front of
# a name, most naturally introduced by copying a branch name out of a web
# UI or chat client. That byte defeats the name half of the name-or-SHA OR,
# silently, and the SHA half doesn't always cover for it (PERMANENT+ANY has
# no SHA to fall back on; OPERATOR-HOLD/COORDINATOR-HOLD stop covering the
# moment the tip moves, which is the ordinary case). _HOLD_LIST_POISONED
# records that at least one entry's name is untrustworthy; _is_held
# consults it, once its own real name/SHA matching has already had a
# chance to fire, so a poisoned entry degrades every UNMATCHED branch in
# this run toward held-and-refused rather than toward a silent disposal
# command. Entries with a clean name are entirely unaffected: this flag
# starts empty and nothing here touches it unless a bad byte is found.
_HOLD_LIST_POISONED=""
_hold_poisoned_desc=""

_resolve_hold_list() {
  # Populates $_hold_entries with one TAB-separated
  # "name<TAB>sha<TAB>class<TAB>reason" line per validated entry (sha here
  # is the RECORDED value verbatim, not yet resolved -- resolution happens
  # per-lookup in _is_held so a single unresolvable object in a partial
  # clone never has to be decided here).
  # Returns 1 if the file cannot be read from trunk at all. Exits 1
  # directly, from inside this function, the moment any single entry is
  # malformed -- deliberately not a "return 1" here, so a malformed entry
  # and an unreadable file both stop the run but are reported with their
  # own distinct message.
  _raw_hold=$(_g show "$TRUNK_REF:$_HOLD_PATH" 2>/dev/null)
  _hold_show_status=$?
  if [ "$_hold_show_status" -ne 0 ]; then
    return 1
  fi
  [ -n "$_raw_hold" ] || return 0

  _hold_raw_file=$(mktemp 2>/dev/null) || { _block "could not create a temp file for the hold list."; exit 1; }
  printf '%s\n' "$_raw_hold" >"$_hold_raw_file"
  while IFS= read -r _hold_line; do
    # QA gap (_R1#167 G1_BOUNCE): strip a trailing CR before anything else
    # touches this line. A CRLF-authored file (Windows editor, a paste
    # through a tool that doesn't normalize line endings) attached the CR
    # to whichever field ends the line; on a terse two-column entry that
    # is the SHA, which then failed the hex check with a diagnostic that
    # named the SHA as the problem even though the SHA itself was fine.
    _hold_line=$(printf '%s' "$_hold_line" | tr -d '\r')

    # QA gap (_R1#167 G1_BOUNCE): the blank/comment check below used to
    # match the raw line, so an INDENTED comment or a line of only spaces
    # fell through to data parsing instead of being skipped, and the whole
    # run refused over what was meant to be a harmless formatting choice.
    # Match against a leading-whitespace-trimmed copy instead; the actual
    # name/sha/reason extraction below already tolerates leading
    # whitespace on its own (awk splits on any whitespace), so only this
    # exact-string comparison needed the trim.
    _hold_trimmed=$(printf '%s' "$_hold_line" | LC_ALL=C sed -E 's/^[[:space:]]+//')
    case "$_hold_trimmed" in
      '' | '#'*) continue ;;
    esac
    _hold_name=$(printf '%s\n' "$_hold_line" | awk '{print $1}')
    _hold_sha=$(printf '%s\n' "$_hold_line" | awk '{print $2}')
    _hold_class=$(printf '%s\n' "$_hold_line" | awk '{print $3}')
    # QA-Scout-1 gap on e10fef66: this anchored at column 0, so an entry
    # with LEADING WHITESPACE never matched at all, and the "reason"
    # printed in the eventual hold message was the entire raw line, name,
    # SHA, and class included. Strip leading whitespace first, same as
    # $_hold_trimmed above, before extracting the reason.
    _hold_reason=$(printf '%s\n' "$_hold_line" | LC_ALL=C sed -E 's/^[[:space:]]+//; s/^[^ 	]+[ 	]+[^ 	]+[ 	]+[^ 	]+[ 	]*//')

    if [ -z "$_hold_name" ]; then
      rm -f "$_hold_raw_file"
      _block "hold list '$_HOLD_PATH' at $TRUNK_REF has a malformed entry: '$_hold_line' (visible: $(_visible "$_hold_line")) (no branch name). Refusing the whole run rather than silently dropping one entry."
      exit 1
    fi
    # _R1#167 G2_BOUNCE: reject, don't strip. [[:graph:]] under LC_ALL=C is
    # exactly the visible, non-space, printable ASCII set (0x21-0x7E); a
    # real branch name never needs anything outside it, and a BOM or
    # zero-width space always falls outside it. This is per-line, not
    # per-file: it does not exit, it does not drop the entry, it flags the
    # whole run as poisoned (see _is_held) and lets every other entry keep
    # resolving normally, so a clean neighbour still holds on its own merit.
    if ! printf '%s' "$_hold_name" | LC_ALL=C grep -Eq '^[[:graph:]]+$'; then
      _HOLD_LIST_POISONED=1
      _hold_poisoned_desc="${_hold_poisoned_desc:+$_hold_poisoned_desc; }'$_hold_line' (visible: $(_visible "$_hold_line"))"
      _block "hold list '$_HOLD_PATH' at $TRUNK_REF has an entry whose NAME contains a byte outside the printable set: '$_hold_line' (visible: $(_visible "$_hold_line")). This name can never match a real ref, so it cannot be trusted to say what it does NOT hold. Refusing to let ANY branch fall through to a disposal command in this run until the hold list is fixed. Other, clean entries still hold normally."
    fi
    case "$_hold_name" in
      "$_REMOTE/"*)
        rm -f "$_hold_raw_file"
        _block "hold list '$_HOLD_PATH' at $TRUNK_REF has a malformed entry: '$_hold_line' (visible: $(_visible "$_hold_line")) (entry looks like a remote-tracking ref; hold entries are local branch names)."
        exit 1
        ;;
    esac
    if [ -z "$_hold_sha" ]; then
      rm -f "$_hold_raw_file"
      _block "hold list '$_HOLD_PATH' at $TRUNK_REF has a malformed entry: '$_hold_line' (visible: $(_visible "$_hold_line")) (missing or invalid SHA column; the SHA column is required, a name-only hold does not survive a rename)."
      exit 1
    fi
    # ANY is legal only under class PERMANENT -- validated after we know
    # the class, but the class itself is validated first so a bad class
    # is reported as a bad class and not misread as a bad SHA.
    if [ -z "$_hold_class" ]; then
      rm -f "$_hold_raw_file"
      _block "hold list '$_HOLD_PATH' at $TRUNK_REF has a malformed entry: '$_hold_line' (visible: $(_visible "$_hold_line")) (missing class column; every entry must be one of OPERATOR-HOLD, COORDINATOR-HOLD, PERMANENT)."
      exit 1
    fi
    case "$_hold_class" in
      OPERATOR-HOLD | COORDINATOR-HOLD | PERMANENT) ;;
      *)
        rm -f "$_hold_raw_file"
        _block "hold list '$_HOLD_PATH' at $TRUNK_REF has a malformed entry: '$_hold_line' (visible: $(_visible "$_hold_line")) (unrecognized class '$_hold_class'; must be one of OPERATOR-HOLD, COORDINATOR-HOLD, PERMANENT)."
        exit 1
        ;;
    esac
    if [ "$_hold_sha" = "ANY" ]; then
      if [ "$_hold_class" != "PERMANENT" ]; then
        rm -f "$_hold_raw_file"
        _block "hold list '$_HOLD_PATH' at $TRUNK_REF has a malformed entry: '$_hold_line' (visible: $(_visible "$_hold_line")) (SHA 'ANY' is only legal under class PERMANENT; $_hold_class is a landing hold and must pin an exact commit)."
        exit 1
      fi
    elif ! printf '%s' "$_hold_sha" | grep -Eq '^[0-9a-fA-F]{4,40}$'; then
      rm -f "$_hold_raw_file"
      _block "hold list '$_HOLD_PATH' at $TRUNK_REF has a malformed entry: '$_hold_line' (visible: $(_visible "$_hold_line")) (missing or invalid SHA column; the SHA column is required, a name-only hold does not survive a rename)."
      exit 1
    fi
    printf '%s\t%s\t%s\t%s\n' "$_hold_name" "$_hold_sha" "$_hold_class" "$_hold_reason" >>"$_hold_entries"
  done <"$_hold_raw_file"
  rm -f "$_hold_raw_file"
  return 0
}

if ! _resolve_hold_list; then
  rm -f "$_hold_entries" "$_STDIN_FILE"
  _block "hold list '$_HOLD_PATH' at $TRUNK_REF could not be read. Not treating a hold list that cannot be read as empty. No disposability check ran."
  exit 1
fi

# --- is a governed branch held? checked before any detector runs -----------
_HOLD_MSG=""
_is_held() {
  # $1 = candidate ref (local branch name), $2 = its current tip SHA.
  # Returns 0 and sets _HOLD_MSG if $1 matches a hold entry by name or by
  # tip SHA (or both). Returns 1 (no message set) if the hold list has no
  # entry for this branch under either key.
  _ref=$1
  _tip=$2
  _HOLD_MSG=""
  [ -s "$_hold_entries" ] || return 1

  while IFS="$_TAB" read -r _e_name _e_sha _e_class _e_reason; do
    [ -n "$_e_name" ] || continue
    _name_match=0
    [ "$_e_name" = "$_ref" ] && _name_match=1

    # Ruling 3: an entry's recorded SHA might not exist in this clone (an
    # ordinary state in a partial or single-branch clone, not an instrument
    # failure). Resolve it defensively; an unresolvable SHA never refuses
    # the run, it only means the SHA half of the OR can't be evaluated for
    # this entry, and that fact is reported when the name half is what
    # actually held the branch. "ANY" (PERMANENT class only) is never
    # resolved at all -- it is a wildcard, not a commit reference, and
    # asking git to resolve the literal string "ANY" would just fail the
    # same way a genuinely bad SHA would, which is not what "ANY" means.
    _e_resolved=""
    if [ "$_e_sha" != "ANY" ]; then
      _e_resolved=$(_g rev-parse --verify --quiet "${_e_sha}^{commit}" 2>/dev/null)
    fi
    _sha_match=0
    if [ -n "$_e_resolved" ] && [ "$_e_resolved" = "$_tip" ]; then
      _sha_match=1
    fi

    if [ "$_name_match" -eq 1 ] && [ "$_sha_match" -eq 1 ]; then
      _HOLD_MSG="held: $_ref is under an active hold (recorded $_e_sha). No disposal command. Its owner decides.${_e_reason:+ Reason: $_e_reason}"
      return 0
    fi
    # PERMANENT is not a landing hold: it is pinned by name, so a SHA that
    # is "ANY" (always) or that fails to match the current tip is still an
    # ordinary hold under this class, never the tip-moved advisory below.
    # That advisory exists only for the two landing classes, where a stale
    # recorded SHA is itself the thing worth flagging.
    if [ "$_name_match" -eq 1 ] && [ "$_e_class" = "PERMANENT" ]; then
      _HOLD_MSG="held: $_ref is under an active permanent hold (class PERMANENT). No disposal command. Its owner decides.${_e_reason:+ Reason: $_e_reason}"
      return 0
    fi
    if [ "$_name_match" -eq 1 ] && [ -z "$_e_resolved" ]; then
      _HOLD_MSG="held: $_ref is under an active hold (recorded SHA $_e_sha could not be verified in this clone). No disposal command. Its owner decides.${_e_reason:+ Reason: $_e_reason}"
      return 0
    fi
    if [ "$_name_match" -eq 1 ]; then
      _HOLD_MSG="held: $_ref is under an active hold, but its tip has moved off the recorded SHA ($_e_sha); the hold entry needs re-recording. No disposal command. Its owner decides.${_e_reason:+ Reason: $_e_reason}"
      return 0
    fi
    if [ "$_sha_match" -eq 1 ]; then
      _HOLD_MSG="held: $_ref (recorded in the hold list under a different name, matched by its held commit $_e_sha) is under an active hold. No disposal command. Its owner decides.${_e_reason:+ Reason: $_e_reason}"
      return 0
    fi
  done <"$_hold_entries"

  # _R1#167 G2_BOUNCE: only reached once every real entry has had its own
  # chance to match $_ref by name or by SHA. A poisoned entry's own
  # (still-attempted, above) SHA half may already have matched and
  # returned by now; this is the fallback for a branch nothing matched,
  # while the hold list contains at least one entry whose name we know we
  # cannot trust. Fail closed rather than let an unmatched branch fall
  # through to a disposal command on the strength of a list that has
  # already proven it can hide a real hold.
  if [ -n "$_HOLD_LIST_POISONED" ]; then
    _HOLD_MSG="held: $_ref could not be confirmed clear of the hold list, because $_HOLD_PATH contains at least one entry whose name is unreadable ($_hold_poisoned_desc). No disposal command. Fix the poisoned entry, then re-run."
    return 0
  fi
  return 1
}

# --- trigger 2: refuse any ref UPDATE that would make a held object --------
# --- unreachable, not only a ref DELETION (Overwatch ruling, _R1#167) ------
# A force-push moves a ref to a new commit; it deletes no ref. The old tip
# becomes unreachable and its content is gone by every measure that
# matters, but this guard's three other safeguards are all blind to it: the
# leftover-nag check above is gated on content already being in trunk (a
# force-pushed-away commit was never in trunk, so nothing was "left
# behind" to nag about); a name-keyed hold sees the branch's name still
# present and correct; an object-keyed hold sees no ref DELETION to refuse.
# All three are working exactly as designed and all three are silent. The
# one input that DOES see a force-push is the pre-push protocol itself:
# the "<local ref> <local sha> <remote ref> <remote sha>" stream captured
# into $_STDIN_FILE above, before this or any other check ran.
#
# THIS IS A SEPARATE TRIGGER from the branch-loop leftover nag below, with
# its own refusal reason, so a reader can tell which one fired. And unlike
# the leftover nag -- whose worst failure mode leaves a stale, recoverable
# branch sitting around -- this check protects hand-authored work that, if
# lost, cannot be reconstructed. So this trigger FAILS CLOSED, ALWAYS, on
# every instrument it depends on (stdin itself, git cat-file, git
# merge-base --is-ancestor): an unresolvable state here is never read as
# "nothing to protect." The leftover nag elsewhere in this script also
# happens to fail closed on its own instruments, but that is this guard
# choosing to be stricter than its job requires, not a requirement of that
# check the way it is here. If a future change ever wants to give the
# leftover nag a way to shrug and proceed, this trigger is the one place
# in the file that must never be given the same option.
_zero_oid() {
  # True if $1 is a git null OID (all-zero, sha1 or sha256 width) or empty.
  # A deletion or a ref's prior nonexistence both express as this on the
  # pre-push stdin protocol.
  case "$1" in
    "" | 0000000000000000000000000000000000000000 | 0000000000000000000000000000000000000000000000000000000000000000)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

_ancestor_check() {
  # $1 = candidate ancestor, $2 = candidate descendant. Prints "yes", "no",
  # or "error" -- ANY nonzero exit from git merge-base --is-ancestor other
  # than its documented 1 ("not an ancestor") is an instrument failure, not
  # a negative answer, same contract as every other detector in this file.
  _g merge-base --is-ancestor "$1" "$2" 2>/dev/null
  _ac_status=$?
  if [ "$_ac_status" -eq 0 ]; then
    printf 'yes\n'
  elif [ "$_ac_status" -eq 1 ]; then
    printf 'no\n'
  else
    printf 'error\n'
  fi
}

_check_orphaned_holds() {
  # Reads $_STDIN_FILE (already captured, once, at the top of this script)
  # for pre-push ref-update lines and refuses if any of them would make a
  # held, resolvable commit unreachable. Nothing to do if there is no hold
  # list, or nothing was piped in (a genuinely empty push spec is a real,
  # silent state -- see the stdin-capture comment above).
  [ -s "$_hold_entries" ] || return 0
  [ -s "$_STDIN_FILE" ] || return 0

  # Held, RESOLVABLE objects only (ruling 3: an entry whose recorded SHA
  # this clone does not have is ordinary in a partial clone, not an
  # instrument failure, and there is nothing to check reachability
  # against). Built once, not per ref-update line.
  _held_objs=$(mktemp 2>/dev/null) || {
    rm -f "$_hold_entries" "$_STDIN_FILE"
    _block "could not create a temp file for held-object resolution."
    exit 1
  }
  : >"$_held_objs"
  while IFS="$_TAB" read -r _e_name _e_sha _e_class _e_reason; do
    # "ANY" (PERMANENT class only) pins no specific commit, so there is
    # nothing here for an orphaning force-push to make unreachable.
    [ -n "$_e_sha" ] && [ "$_e_sha" != "ANY" ] || continue
    _e_resolved=$(_g rev-parse --verify --quiet "${_e_sha}^{commit}" 2>/dev/null)
    [ -n "$_e_resolved" ] || continue
    printf '%s\t%s\n' "$_e_resolved" "$_e_name" >>"$_held_objs"
  done <"$_hold_entries"
  if [ ! -s "$_held_objs" ]; then
    rm -f "$_held_objs"
    return 0
  fi

  while IFS=' ' read -r _upd_local_ref _upd_local_sha _upd_remote_ref _upd_remote_sha; do
    [ -n "$_upd_remote_ref" ] || continue
    _zero_oid "$_upd_remote_sha" && continue # ref didn't exist before: nothing to orphan

    if ! _g cat-file -e "$_upd_remote_sha" 2>/dev/null; then
      rm -f "$_held_objs" "$_hold_entries" "$_STDIN_FILE"
      _block "could not resolve the old remote object $_upd_remote_sha for $_upd_remote_ref from the pre-push ref-update stream (git cat-file -e failed). Not treating an unresolvable old tip as 'nothing to orphan'."
      exit 1
    fi

    while IFS="$_TAB" read -r _held_sha _held_name; do
      [ -n "$_held_sha" ] || continue

      _old_reach=$(_ancestor_check "$_held_sha" "$_upd_remote_sha")
      if [ "$_old_reach" = "error" ]; then
        rm -f "$_held_objs" "$_hold_entries" "$_STDIN_FILE"
        _block "could not determine whether held commit $_held_sha (hold entry: $_held_name) is reachable from $_upd_remote_ref's old tip $_upd_remote_sha (git merge-base --is-ancestor failed). Not treating an instrument failure as 'nothing to orphan'."
        exit 1
      fi
      [ "$_old_reach" = "yes" ] || continue

      if _zero_oid "$_upd_local_sha"; then
        _new_reach="no" # deletion: nothing is reachable from the new tip
      elif ! _g cat-file -e "$_upd_local_sha" 2>/dev/null; then
        rm -f "$_held_objs" "$_hold_entries" "$_STDIN_FILE"
        _block "could not resolve the new local object $_upd_local_sha for $_upd_local_ref from the pre-push ref-update stream (git cat-file -e failed). Not treating an unresolvable new tip as 'nothing to orphan'."
        exit 1
      else
        _new_reach=$(_ancestor_check "$_held_sha" "$_upd_local_sha")
        if [ "$_new_reach" = "error" ]; then
          rm -f "$_held_objs" "$_hold_entries" "$_STDIN_FILE"
          _block "could not determine whether held commit $_held_sha (hold entry: $_held_name) would remain reachable from $_upd_local_ref's new tip $_upd_local_sha (git merge-base --is-ancestor failed). Not treating an instrument failure as 'nothing to orphan'."
          exit 1
        fi
      fi

      if [ "$_new_reach" = "no" ]; then
        rm -f "$_held_objs" "$_hold_entries" "$_STDIN_FILE"
        _block "REFUSE: this push would orphan a held object. $_upd_remote_ref would move from $_upd_remote_sha to ${_upd_local_sha:-(deleted)}, and held commit $_held_sha (hold entry: $_held_name) is reachable from the old tip but would not be reachable from the new one. No ref update proceeds. Its owner decides."
        exit 1
      fi
    done <"$_held_objs"
  done <"$_STDIN_FILE"
  rm -f "$_held_objs"
  return 0
}

# remote-sweep is not a real push (no ref-update stream exists to protect),
# so the force-push-orphan trigger has nothing to read and does not run.
[ "$_MODE" = "push" ] && _check_orphaned_holds

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
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "could not determine $_ref's fork point against $_trunk (git merge-base exited $_fork_status, not the documented 'no common ancestor' exit of 1). Not treating an instrument failure as ungoverned. No disposability check ran."
    exit 1
  fi

  _g merge-base --is-ancestor "$INSTALL_SHA" "$_fork" 2>/dev/null
  _anc_status=$?
  if [ "$_anc_status" -gt 1 ]; then
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
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
#
# NOT STABLE ACROSS A MERGE IN RANGE (QA finding, _R1#167 G1_BOUNCE): git
# cherry's per-commit equivalence answer is a property of the WALKED RANGE,
# not a context-free property of the commit. QA proved a commit whose diff
# is byte-identical to one already in trunk reports "-" (equivalent) on its
# own, then reports "+" (no equivalent) once a later merge of trunk into
# the branch, with a hand-resolved conflict folded into the merge commit
# itself, enters the walked range. Same commit, same SHA, same content,
# different answer. The direction is the safe one -- it turns a fossil into
# a MISS, never live work into a false fossil -- and reverse-apply, this
# detector's OR partner, still catches content presence in that shape. But
# that is correct today by the luck of the OR, not by anything that pins
# it, so git cherry alone must never be trusted as the sole detector for
# any branch that may carry a merge commit.
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
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
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
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "could not determine $_ref's merge-base with $_trunk (git merge-base exited $_base_status). Not treating an instrument failure as not-present."
    exit 1
  fi

  _scratch=$(mktemp -d 2>/dev/null) || {
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "could not create a scratch directory to check $_ref's content presence."
    exit 1
  }
  _patch="$_scratch/patch.diff"
  _index="$_scratch/index"

  # --binary (TP finding, _R1#167 G1_BOUNCE): a committed .gitattributes
  # line marking a text path binary makes the default diff form a
  # "Binary files ... differ" hunk with no full-index line, which makes
  # `git apply --check` below exit 1 on a genuine fossil -- content
  # genuinely differs and this patch form cannot be applied at all
  # conflate into the same exit code. --binary here makes the diff carry
  # a full binary patch instead, so apply --check evaluates the real
  # content question. Measured to not false-positive on genuinely
  # unmerged work.
  _g diff --binary "$_base" "$_ref" >"$_patch" 2>/dev/null
  _diff_status=$?
  if [ "$_diff_status" -ne 0 ]; then
    # Exit status checked directly (not piped): a failed diff must not be
    # read as an empty, all-present patch (DEFECT 4's own shortcut, right
    # below, requires a genuinely successful empty diff, not a failed one).
    rm -rf "$_scratch"
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
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
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "could not read $_trunk into a scratch index to check $_ref (git read-tree exited $_read_status). Not treating an instrument failure as not-present."
    exit 1
  fi

  # Writes nothing to the working tree. GIT_INDEX_FILE pointed at the
  # scratch index is the whole point: a caller's real staged changes are
  # never touched by this check.
  #
  # DEFECT 1 (_R1#167 G1_BOUNCE 4), and the GIT_TRACE finding on top of it
  # (_R1#167 G1_BOUNCE, Overwatch): a branch whose only change is a file
  # mode flip (e.g. chmod +x, 100644 -> 100755) is genuine, unmerged work.
  # `git apply --check` WARNS about the mode divergence on stderr and
  # still exits 0, because the check is content-only by default. The
  # original fix captured that stderr and failed toward NOT-present on
  # ANY output at all -- which is testing the INSTRUMENT's output, not the
  # actual condition, and GIT_TRACE=1 (or GIT_TRACE2, GIT_CURL_VERBOSE,
  # etc.) puts trace text on that SAME stderr stream. Every branch then
  # read as not-present regardless of its real content, and the guard
  # went quiet-and-wrong on the fossil shape reverse-apply exists to
  # catch: an ordinary multi-commit squash merge. Sanitizing the
  # environment above closes that specific hole, but this check no longer
  # relies on stderr at all, from either source, trace or a genuine mode
  # warning: apply's stderr is discarded unread, and _mode_diverges below
  # tests the actual condition directly by comparing each touched path's
  # file mode between trunk's tree and the branch's tree. That comparison
  # cannot be moved by any environment variable, because it never reads
  # a subprocess's stderr for a verdict.
  #
  # Exit 1 (apply's documented "does not apply") is a genuine negative.
  # Anything higher is apply itself failing to evaluate the question,
  # which refuses rather than silently reporting not-present.
  # --whitespace=nowarn (TP finding, _R1#167 G1_BOUNCE): apply.whitespace
  # set to warn or fix, at repo OR global config scope, makes apply print
  # a whitespace warning and still exit 0 on a DELETING fossil (reverse-
  # applying an addition is a deletion, so whitespace checks fire on the
  # patch's added lines, which for a deletion means the lines the branch
  # removed). This check never reads apply's stderr for a verdict, but
  # relying on the exit code alone was already correct; --whitespace=nowarn
  # here is belt-and-suspenders against any future code path that starts
  # reading that stream, and documents that this check does not depend on
  # ambient apply.whitespace config either way.
  GIT_INDEX_FILE="$_index" _g apply --whitespace=nowarn --cached --reverse --check "$_patch" >/dev/null 2>/dev/null
  _apply_status=$?
  rm -rf "$_scratch"
  if [ "$_apply_status" -eq 0 ]; then
    if _mode_diverges "$_ref" "$_trunk" "$_base"; then
      return 1
    fi
    return 0
  fi
  if [ "$_apply_status" -gt 1 ]; then
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "could not check whether $_ref reverse-applies onto $_trunk (git apply exited $_apply_status). Not treating an instrument failure as not-present."
    exit 1
  fi
  return 1
}

# --- DEFECT 1's replacement check: mode divergence, tested directly, ------
# --- never inferred from a subprocess's stderr --------------------------
# $1 = candidate ref, $2 = trunk ref, $3 = their merge-base. Returns 0
# (true) if any path the patch touches has a different file mode in
# trunk's tree than in the branch's tree. A path missing from trunk's tree
# entirely is a content difference, not a mode difference, and is already
# what apply's own exit code above is for; this only fires when both
# sides resolve to a real tree entry and the two modes disagree.
_mode_diverges() {
  _mref=$1
  _mtrunk=$2
  _mbase=$3
  _mpaths_file=$(mktemp 2>/dev/null) || {
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "could not create a temp file to compare mode divergence for $_mref."
    exit 1
  }
  _g diff --name-only "$_mbase" "$_mref" >"$_mpaths_file" 2>/dev/null
  _mpaths_status=$?
  if [ "$_mpaths_status" -ne 0 ]; then
    rm -f "$_mpaths_file" "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "could not list $_mref's changed paths against $_mbase (git diff --name-only exited $_mpaths_status). Not treating an instrument failure as no mode divergence."
    exit 1
  fi
  _mdiverges=1
  while IFS= read -r _mpath; do
    [ -z "$_mpath" ] && continue
    _trunk_mode=$(_g ls-tree "$_mtrunk" -- "$_mpath" 2>/dev/null | awk '{print $1}')
    _ref_mode=$(_g ls-tree "$_mref" -- "$_mpath" 2>/dev/null | awk '{print $1}')
    if [ -n "$_trunk_mode" ] && [ -n "$_ref_mode" ] && [ "$_trunk_mode" != "$_ref_mode" ]; then
      _mdiverges=0
      break
    fi
  done <"$_mpaths_file"
  rm -f "$_mpaths_file"
  return "$_mdiverges"
}

# --- combined content-presence check: ahead-count, then both detectors, ---
# --- cherry (ancestry) advisory, reverse-apply (content) authoritative. ----
# DEFECT 5 (_R1#167 G1_BOUNCE 2): plain OR let cherry alone authorize a
# disposal command. cherry answers an ANCESTRY question (does trunk's
# history contain a commit with this patch-id); reverse-apply answers a
# CONTENT question (does trunk's actual tree already hold this change).
# Content landing and later being reverted is the case where they diverge:
# cherry still says "- <sha>" forever, because history never forgets a
# patch-id, but the content is gone and this branch is its only remaining
# copy. Cherry alone used to short-circuit before reverse-apply ever ran,
# so that divergence was never observed and the guard printed the same
# "Disposal: git branch -D" line for a genuine fossil and for the one
# branch holding the last copy of reverted work.
#
# Both detectors now always run (no short-circuit on cherry's hit): a
# reverse-apply PRESENT verdict is sufficient on its own to authorize
# disposal, agreeing or not with cherry, because it is asking the content
# question directly against trunk's real tree -- this is also what still
# catches the squash-of-multiple-commits shape cherry cannot see (ruling
# 1's "multi" case). A cherry-only hit, with reverse-apply saying NOT
# present, is reported as a disagreement: no disposal command, because
# ancestry alone does not prove the content is still there to reclaim by
# deleting the branch. See the DISPUTED branch below.
_DETECTOR=""
_CONTENT_MODE=""
_is_content_present() {
  # $1 = candidate ref, $2 = trunk ref. Sets _DETECTOR to the name of
  # whichever check fired, for the BLOCK line -- a combined boolean that
  # doesn't say which detector caught it hides a detector silently going
  # dark, which is the exact class of gap this fix exists to close. Sets
  # _CONTENT_MODE to "confirmed" (reverse-apply itself found the content
  # present, safe to dispose) or "disputed" (cherry alone fired, reverse-
  # apply disagreed) whenever this returns 0; callers must check
  # _CONTENT_MODE before printing any disposal command.
  _ref=$1
  _trunk=$2
  _DETECTOR=""
  _CONTENT_MODE=""

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
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "could not determine how many commits $_ref is ahead of $_trunk (git rev-list --count exited $_ahead_status). Not treating an instrument failure as a fresh, nothing-to-check branch."
    exit 1
  fi
  [ "$_ahead" -gt 0 ] || return 1

  # Both detectors run every time now (_R1#167 G1_BOUNCE 2): cherry's hit
  # alone used to return immediately, which is exactly what let a reverted-
  # but-patch-id-matching branch print a disposal command without reverse-
  # apply ever getting a chance to disagree. cherry is still run first
  # because it is cheaper (no scratch index, no patch file, no read-
  # tree/apply forks), but its result is now advisory: it only sets
  # _cherry_hit for the agreement check below, it never returns on its own.
  _cherry_hit=1
  if _is_cherry_fossil "$_ref" "$_trunk"; then
    _cherry_hit=0
  fi

  _ra_hit=1
  if _is_reverse_apply_fossil "$_ref" "$_trunk"; then
    _ra_hit=0
  fi

  if [ "$_ra_hit" -eq 0 ]; then
    # reverse-apply is a direct content check against trunk's actual tree,
    # so its PRESENT verdict authorizes disposal on its own -- agreeing
    # with cherry or not. This is also what still catches ruling 1's
    # "multi" shape (a squash of several commits into one diff, which
    # cherry cannot match against trunk's separately-committed history).
    if [ "$_cherry_hit" -eq 0 ]; then
      _DETECTOR="git cherry (patch-id) and reverse-apply, in agreement"
    else
      _DETECTOR="reverse-apply"
    fi
    _CONTENT_MODE="confirmed"
    return 0
  fi

  if [ "$_cherry_hit" -eq 0 ]; then
    # cherry alone: ancestry says a commit with this patch-id is in
    # trunk's history, but reverse-apply, asking the content question
    # directly, could not confirm the change is present in trunk's actual
    # tree. That disagreement is the destructive case (content landed,
    # then was reverted, and this branch is the only remaining copy) --
    # never authorize a disposal command from ancestry alone. Report it
    # as disputed instead; the caller prints a BLOCK line naming the
    # disagreement and continues without a Disposal: line.
    _DETECTOR="git cherry (patch-id)"
    _CONTENT_MODE="disputed"
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
_DIRTY_UNKNOWN_REASON=""
_count_dirty() {
  # $1 = worktree path. Sets _DIRTY_STATE, _DIRTY_COUNT, and (when
  # _DIRTY_STATE is "unknown") _DIRTY_UNKNOWN_REASON (globals, POSIX sh has
  # no multi-value return). unknown must be treated by the caller exactly
  # like DISPOSABLE-BUT-DIRTY: refuse, no removal command.
  _wt=$1
  _out=$(git -C "$_wt" status --porcelain 2>/dev/null)
  _status=$?
  if [ "$_status" -ne 0 ]; then
    _DIRTY_STATE="unknown"
    _DIRTY_COUNT=0
    _DIRTY_UNKNOWN_REASON="git status could not be read (corrupt or unreadable .git)"
    return
  fi
  if [ -n "$_out" ]; then
    _DIRTY_STATE="dirty"
    _DIRTY_COUNT=$(printf '%s\n' "$_out" | grep -c .)
    return
  fi

  # TP reproduced live (_R1#167 G1_BOUNCE), on the same guard's own newest
  # SHA: `git status --porcelain` reads clean above even when a registered
  # submodule is UNINITIALIZED and its working directory holds real,
  # uncommitted, unrecoverable content -- git is blind to anything under an
  # uninitialized gitlink, so a `worktree remove --force` recommendation
  # here silently destroys that content with no object, stash, or reflog
  # entry left behind. `git worktree add` leaves submodules uninitialized
  # BY DEFAULT, so prototyping inside the submodule path before running
  # `git submodule update --init` is an ordinary sequence, not a corner
  # case. Do NOT fix this by running `git submodule update --init` here:
  # this guard must not mutate the thing it is inspecting, and initializing
  # a submodule can itself overwrite the very files at risk. `git
  # submodule status` marks an uninitialized entry with a leading '-' on
  # its SHA column; treat that, PLUS a non-empty working directory at its
  # path, as UNKNOWN dirty state -- the same "cannot measure, so refuse"
  # shape this file already uses for a corrupt .git (above) and a locked
  # worktree (below), now a third caller of it.
  #
  # --recursive (TP/QA, _R1#167 G1_BOUNCE): without it, `git submodule
  # status` only reports one level deep. A submodule nested inside an
  # INITIALIZED top-level submodule (superproject -> mid (initialized) ->
  # mid/inner (uninitialized)) never shows its own leading '-' in the
  # non-recursive output -- the top-level entry looks healthy and the
  # nested one is invisible, so real content under mid/inner reads clean
  # and gets handed a destructive removal command. Reproduced live and
  # confirmed: the '-' for the nested entry appears under --recursive and
  # not without it. --recursive's paths are already relative to the
  # superproject root (e.g. "mid/inner"), so the existing
  # "$_wt/$_sub_path" probe below needs no change for nesting itself.
  _sub_out=$(git -C "$_wt" submodule status --recursive 2>/dev/null)
  _sub_status=$?
  if [ "$_sub_status" -ne 0 ]; then
    _DIRTY_STATE="unknown"
    _DIRTY_COUNT=0
    _DIRTY_UNKNOWN_REASON="git submodule status could not be read"
    return
  fi
  if [ -n "$_sub_out" ]; then
    _sub_file=$(mktemp 2>/dev/null) || {
      _DIRTY_STATE="unknown"
      _DIRTY_COUNT=0
      _DIRTY_UNKNOWN_REASON="could not create a temp file to read submodule status"
      return
    }
    printf '%s\n' "$_sub_out" >"$_sub_file"
    while IFS= read -r _sub_line; do
      [ -n "$_sub_line" ] || continue
      case "$_sub_line" in
        -*)
          # TP reproduced live on this guard's own newest SHA at the time:
          # a submodule path containing a space (e.g. "my sub") still got
          # a destructive removal command, because awk splits on
          # whitespace and `{print $2}` returned only "my" -- the guard
          # then probed a directory that never existed, found it "empty",
          # and fell through to clean. `git submodule status` output is
          # fixed-width for the flag+SHA: one flag character (here always
          # '-', matched by the case above) followed by exactly 40 hex
          # characters, then one space, then the path verbatim -- with no
          # trailing "(describe)" suffix, because describing a ref needs a
          # working tree an uninitialized submodule doesn't have (verified
          # own-hands: an initialized entry gets " (heads/...)", an
          # uninitialized one never does). Cut positionally instead of
          # splitting on whitespace, so a space OR a single quote in the
          # path survives intact.
          _sub_path=$(printf '%s\n' "$_sub_line" | cut -c43-)
          if [ -n "$_sub_path" ] && [ -n "$(find "$_wt/$_sub_path" -mindepth 1 -print -quit 2>/dev/null)" ]; then
            rm -f "$_sub_file"
            _DIRTY_STATE="unknown"
            _DIRTY_COUNT=0
            _DIRTY_UNKNOWN_REASON="submodule '$_sub_path' is uninitialized and its working directory is non-empty; git status is blind to it"
            return
          fi
          ;;
      esac
    done <"$_sub_file"
    rm -f "$_sub_file"
  fi

  _DIRTY_STATE="clean"
  _DIRTY_COUNT=0
}

# --- MODE: remote-sweep (opeff#1040) ----------------------------------------
# The branch loop below only ever sees refs/heads/, so a branch that was
# merged into trunk and then had its LOCAL branch deleted, but was never
# deleted on the remote, is invisible to every check above it. GitHub's
# auto-delete-on-merge setting only fires for a PR merged through GitHub's
# own merge button; a repo that also lands work by pushing a squash or a
# commit-tree SHA directly never trips that checkbox, which is why the
# fleet's remote-branch backlog exists at all.
#
# This mode walks refs/remotes/$_REMOTE/ instead of refs/heads/ and applies
# the SAME content-presence test as the branch loop below: both detectors
# (_is_cherry_fossil, _is_reverse_apply_fossil) through the same
# _is_content_present combiner, confirmed-vs-disputed exactly as before,
# and the SAME hold list via _is_held, keyed on the bare branch name so one
# hold list covers a branch whether it is being checked locally or here.
#
# Two differences from the local branch loop, both deliberate:
#
# 1. NO install-point governance filter. The "only branches forked at or
#    after install are governed" rule (see SCOPE, top of file) exists so a
#    guard that BLOCKS a live push does not demand a backlog cleanup as its
#    entry fee. This mode blocks nothing -- it has no worktree to disturb
#    and prints a delete command it never runs -- so there is no
#    enforceability wall to protect, and the whole existing remote backlog
#    is in scope from this mode's first run, not just what accumulates after
#    today.
# 2. The disposal command is `git push $_REMOTE --delete <branch>`, never
#    `git worktree remove --force` or `git branch -D`. A remote delete is
#    NOT reflog-recoverable on this machine the way a local branch delete
#    is (the commit stays reachable in some clone until it is gc'd, but
#    this guard has no way to know who else has one). This mode therefore
#    NEVER runs that command; it only ever prints it, once, per branch, for
#    a human to choose to run.
#
# Freshness of refs/remotes/$_REMOTE/ is this mode's CALLER's job, not this
# script's: this mode walks whatever the most recent `git fetch $_REMOTE
# --prune` left behind. It does not fetch on its own, so a stale
# remote-tracking snapshot reports stale results -- see
# scripts/hygiene-guard-remote-sweep.sh, the scheduled caller that runs the
# fetch first.
if [ "$_MODE" = "remote-sweep" ]; then
  _remote_refs_file=$(mktemp 2>/dev/null) || {
    rm -f "$_hold_entries"
    _block "could not create a temp file for remote-branch enumeration."
    exit 1
  }
  _g for-each-ref --format='%(refname:short)' "refs/remotes/$_REMOTE/" >"$_remote_refs_file" 2>/dev/null
  _rr_status=$?
  if [ "$_rr_status" -ne 0 ]; then
    rm -f "$_remote_refs_file" "$_hold_entries"
    _block "could not enumerate remote-tracking refs under refs/remotes/$_REMOTE/ (git for-each-ref exited $_rr_status). Not treating a failed listing as zero remote branches. No remote sweep ran."
    exit 1
  fi

  # cut, not read+IFS, for the same reason the branch/worktree records below
  # use cut: a name containing a literal tab is not a real concern here (git
  # ref names cannot contain one), but there is no reason to reach for a
  # weaker tool than the rest of this file already standardized on.
  while IFS= read -r _rref; do
    [ -n "$_rref" ] || continue
    # refs/remotes/<remote>/HEAD is a symbolic ref pointing at trunk, not a
    # branch of its own; deleting it would be deleting the remote's default
    # branch pointer, never a real disposal candidate. Measured live on
    # this ticket's own bed: `%(refname:short)` collapses that symref to
    # the BARE remote name ("origin"), not "origin/HEAD" -- for-each-ref's
    # own short-name logic for a remote's HEAD symref, not a formatting
    # choice this script makes. Skipped by exact match on the bare remote
    # name FIRST, before the prefix-strip below (which would otherwise
    # leave it unchanged, since "origin" does not start with "origin/",
    # and let it through as a fake "branch" whose content is trivially
    # trunk's own tip -- confirmed live: it prints a nonsensical `git push
    # origin --delete origin` without this check).
    [ "$_rref" = "$_REMOTE" ] && continue
    _rbranch=${_rref#"$_REMOTE/"}
    [ -n "$_rbranch" ] || continue
    [ "$_rbranch" = "HEAD" ] && continue
    [ "$_rbranch" = "$TRUNK_BRANCH" ] && continue

    # Ancestor check FIRST, ahead of the shared cherry/reverse-apply
    # pipeline (measured live on this ticket's own bed): a TRUE merge (a
    # real merge commit, not a squash) leaves the branch's own tip
    # reachable from trunk through that merge commit's second parent, so
    # `rev-list --count trunk..branch` is 0. _is_content_present's own
    # cheap discriminator treats a zero-ahead branch as "nothing to check
    # yet" (the brand-new, never-diverged case it was written for) and
    # returns before either detector runs -- correct for a fresh branch,
    # but it silently skips a genuinely, fully-merged branch too, since
    # both shapes read as zero-ahead. This is the same asymmetry the
    # squash case has for a different reason (no ancestor edge at all,
    # ahead > 0, needs cherry/reverse-apply); a true merge has the
    # opposite shape (ancestor edge exists, ahead == 0), so it needs the
    # ancestor check the header comment says is "never used here" for
    # squash -- but a squash branch genuinely fails this check (exit 1,
    # "not an ancestor"), so it falls through to the existing pipeline
    # unchanged. Scoped to this remote-sweep arm only: the local
    # branch/worktree loop below is untouched, since this ticket's
    # acceptance is about the remote arm's own behavior, not a change to
    # already-hardened, separately-tested local-branch logic.
    _g merge-base --is-ancestor "$_rref" "$TRUNK_REF" 2>/dev/null
    _ranc_status=$?
    if [ "$_ranc_status" -eq 0 ]; then
      _DETECTOR="ancestor (fully merged into $TRUNK_REF)"
      _CONTENT_MODE="confirmed"
    elif [ "$_ranc_status" -eq 1 ]; then
      if ! _is_content_present "$_rref" "$TRUNK_REF"; then
        continue
      fi
    else
      rm -f "$_remote_refs_file" "$_hold_entries"
      _block "could not determine whether $_rref is an ancestor of $TRUNK_REF (git merge-base --is-ancestor exited $_ranc_status). Not treating an instrument failure as not-an-ancestor."
      exit 1
    fi

    if [ "$_CONTENT_MODE" = "disputed" ]; then
      _block "remote branch DISPUTED: $_rref matches $TRUNK_REF's history by patch-id (git cherry) but reverse-apply could not confirm its content is present in $TRUNK_REF's actual tree. Detectors disagree -- this can mean the change landed on $TRUNK_REF and was later reverted, leaving $_rref the only remaining copy, or it can mean reverse-apply's own known gap. No disposal command. Needs manual verification."
      continue
    fi

    _rtip=$(_g rev-parse --verify --quiet "$_rref" 2>/dev/null)
    if [ -z "$_rtip" ]; then
      rm -f "$_remote_refs_file" "$_hold_entries"
      _block "could not resolve $_rref's own tip commit (git rev-parse failed). Not treating an instrument failure as an unheld remote branch."
      exit 1
    fi
    if _is_held "$_rbranch" "$_rtip"; then
      _block "remote branch $_rref: $_HOLD_MSG"
      continue
    fi

    _block "remote branch already in $TRUNK_REF (detected via $_DETECTOR): $_rref. Disposal: git push $_REMOTE --delete $(_shquote "$_rbranch")"
  done <"$_remote_refs_file"
  rm -f "$_remote_refs_file" "$_hold_entries"

  if [ "$_fail" -eq 0 ]; then
    _info "remote sweep clean. No remote branch under refs/remotes/$_REMOTE/ is fully contained in $TRUNK_REF."
    exit 0
  fi
  echo "hygiene-guard: remote sweep found disposable, held, or disputed remote-branch state relative to $TRUNK_REF. See line(s) above. Nothing was deleted; disposal commands are printed only." >&2
  exit 1
fi

# --- enumerate worktrees. git-common-dir, never directory position ---------
# A worktree whose repo has a submodule registered inside it IS covered:
# see _count_dirty's submodule check above and control 23 (_R1#167
# G1_BOUNCE, TP reproduced live against this guard's own newest SHA at the
# time) -- an uninitialized submodule holding real, uncommitted content
# used to read as clean and get handed a `worktree remove --force`
# recommendation that silently destroyed it. This line used to say that
# shape was untested and the cost accepted; it is not accepted, it is
# fixed, and the old wording is removed rather than left to imply a gap
# that no longer exists.
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

_cur_path=""
_cur_branch=""
_cur_prune=""
_cur_locked=""
_flush_wt_record() {
  if [ -n "$_cur_path" ]; then
    printf '%s\t%s\t%s\t%s\n' "$_cur_path" "$_cur_branch" "$_cur_prune" "$_cur_locked" >>"$_wt_records"
  fi
  _cur_path=""
  _cur_branch=""
  _cur_prune=""
  _cur_locked=""
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
  "locked")
    # QA gap (_R1#167 G1_BOUNCE): `git status` on a locked worktree works
    # fine, so content-presence and dirty-state both read correctly, and
    # the old code printed `git worktree remove --force <path>`, which QA
    # confirmed fails with exit 128 on a locked worktree ("use 'remove -f
    # -f' to override or unlock first"). Not destructive, but a lock is
    # very plausibly deliberate and this parser had no branch for the
    # porcelain `locked` line at all, so it could not even report the
    # state. `locked` with no reason text is its own valid porcelain line.
    _cur_locked="(no reason recorded)"
    ;;
  "locked "*)
    _cur_locked=${_line#locked }
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

# Field extraction below uses `cut -f`, never `read -r ... <multiple vars>`
# with IFS set to a bare tab (bug found this pass, _R1#167 G1_BOUNCE): when
# IFS consists solely of characters from the shell's default whitespace set
# (space/tab/newline) -- even a single tab, set on its own -- `read` treats
# ADJACENT delimiters as ONE, collapsing an empty middle field into the
# next one. This record's third field ($_prune) is legitimately empty on
# every non-prunable-but-locked worktree, immediately followed by a
# non-empty fourth field ($_locked), which is exactly the shape that
# collapses: `read` silently handed the LOCK REASON to `_prune`, so a
# locked-but-not-prunable worktree misreported as prunable (wrong BLOCK
# entirely) and then vanished from `_wt_map` (its now-non-empty `_prune`
# failed the `-z` guard below), so the branch loop found no worktree
# record for it at all and fell through to the ordinary "branch already in
# trunk, git branch -D" path. `cut -f` never collapses delimiters, so it
# does not have this failure mode.
#
# Report prunable records first: always safe to recommend, dirty check does
# not apply (there is no working tree left to lose).
while IFS= read -r _wtr_line; do
  _path=$(printf '%s' "$_wtr_line" | cut -d "$_TAB" -f1)
  _prune=$(printf '%s' "$_wtr_line" | cut -d "$_TAB" -f3)
  [ -n "$_prune" ] || continue
  _block "worktree record already prunable: $_path ($_prune). Disposal: git worktree prune"
done <"$_wt_records"

# Map of non-prunable, non-main worktree paths keyed by branch, carrying
# each worktree's lock state along with its path.
_wt_map=$(mktemp 2>/dev/null) || { rm -f "$_wt_records"; _block "could not create a temp file for the worktree/branch map."; exit 1; }
: >"$_wt_map"
while IFS= read -r _wtr_line; do
  _path=$(printf '%s' "$_wtr_line" | cut -d "$_TAB" -f1)
  _branch=$(printf '%s' "$_wtr_line" | cut -d "$_TAB" -f2)
  _prune=$(printf '%s' "$_wtr_line" | cut -d "$_TAB" -f3)
  _locked=$(printf '%s' "$_wtr_line" | cut -d "$_TAB" -f4)
  [ -z "$_prune" ] || continue
  [ -n "$_branch" ] || continue
  [ "$_path" = "$_main_path" ] && continue
  printf '%s\t%s\t%s\n' "$_branch" "$_path" "$_locked" >>"$_wt_map"
done <"$_wt_records"

# --- walk every local branch, decide disposability ---------------------------
_branches=$(mktemp 2>/dev/null) || { rm -f "$_wt_records" "$_wt_map"; _block "could not create a temp file for branch enumeration."; exit 1; }
_g for-each-ref --format='%(refname:short)' refs/heads/ >"$_branches" 2>/dev/null
_branches_status=$?
if [ "$_branches_status" -ne 0 ]; then
  # Same class as the worktree-list check above: a failed listing must
  # refuse, not silently process zero branches as a clean repo.
  rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
  _block "could not enumerate local branches: 'git for-each-ref refs/heads/' failed in $_REPO (exit $_branches_status). Not treating a failed listing as zero branches. No disposability check ran."
  exit 1
fi
if [ ! -s "$_branches" ]; then
  # ONE CONTRACT (Overwatch actuator): TP's own fault injection proved this
  # exact shape, `for-each-ref` exiting 0 with empty output, collapses the
  # guard to a false "clean". Unlike worktree list, an empty branch list at
  # exit 0 CAN be genuine (a repo where the only local branch is trunk
  # itself, filtered out below before ever reaching this loop's body -- see
  # "passes when the only branch is trunk itself"), OR a repo with no
  # local branches at all (a detached HEAD with nothing checked out).
  # Distinguish a lie from the genuine case with an independent query that
  # does NOT depend on trunk's name or on trunk being the branch that is
  # checked out (_R1#173): `git symbolic-ref -q HEAD` reports whatever
  # local branch HEAD is actually attached to, if any. If HEAD resolves to
  # a refs/heads/* ref, at least one local branch provably exists, so an
  # empty for-each-ref listing is provably a lie regardless of which
  # branch that is or whether it happens to be trunk. A detached HEAD
  # leaves symbolic-ref silent, and that is the one shape where an empty
  # listing must still be trusted.
  _sym_head=$(_g symbolic-ref --quiet HEAD 2>/dev/null)
  if [ -n "$_sym_head" ]; then
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "'git for-each-ref refs/heads/' in $_REPO returned nothing, even though HEAD is attached to '$_sym_head'. Not treating an empty listing as zero branches. No disposability check ran."
    exit 1
  fi
fi

while IFS= read -r _branch; do
  [ -n "$_branch" ] || continue
  [ "$_branch" = "$TRUNK_BRANCH" ] && continue
  _branch_governed "$_branch" "$TRUNK_REF" || continue

  # Ancestor check first (jasonburks23/_R1#179, parity with the remote-sweep
  # arm's own fix under opeff#1040): a TRUE merge (a real merge commit, not
  # a squash) leaves this branch's own tip reachable from trunk through
  # that merge commit's second parent, so `rev-list --count trunk..branch`
  # is 0. _is_content_present's own cheap discriminator treats a
  # zero-ahead branch as "nothing to check yet" (the brand-new,
  # never-diverged case it was written for) and returns before either
  # detector runs -- correct for a fresh branch, but it silently skips a
  # genuinely, fully-merged branch too, since both shapes read as
  # zero-ahead. A squash-merged branch has no ancestor edge at all
  # (exit 1), so it falls through to the existing content detectors
  # unchanged.
  #
  # Measured live on this ticket's own bed: a brand-new branch pointed at
  # trunk's own current tip (control 8's "ordinary first act of any
  # ticket" case, and the zero-commit fixtures control 2 already covers)
  # is ALSO trivially an ancestor of trunk, `merge-base --is-ancestor`
  # cannot tell "just created, never diverged" apart from "diverged, did
  # real work, got merged back" on its own. Only a branch whose tip is
  # DISTINCT from trunk's tip, yet still an ancestor, has actually
  # traveled through a real merge commit's second parent. Skip the
  # is-ancestor call entirely when the tips are identical, and let it fall
  # through to the existing zero-ahead discriminator unchanged, rather
  # than flagging every fresh branch the moment it is created.
  _anc_branch_tip=$(_g rev-parse --verify --quiet "refs/heads/$_branch" 2>/dev/null)
  _anc_trunk_tip=$(_g rev-parse --verify --quiet "$TRUNK_REF" 2>/dev/null)
  if [ -z "$_anc_branch_tip" ] || [ -z "$_anc_trunk_tip" ]; then
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "could not resolve $_branch or $TRUNK_REF to a commit for the ancestor check (git rev-parse failed). Not treating an instrument failure as not-an-ancestor."
    exit 1
  fi
  if [ "$_anc_branch_tip" = "$_anc_trunk_tip" ]; then
    _anc_status=1
  else
    _g merge-base --is-ancestor "refs/heads/$_branch" "$TRUNK_REF" 2>/dev/null
    _anc_status=$?
  fi
  if [ "$_anc_status" -eq 0 ]; then
    _DETECTOR="ancestor (fully merged into $TRUNK_REF)"
    _CONTENT_MODE="confirmed"
  elif [ "$_anc_status" -eq 1 ]; then
    # Content presence is decided from refs in the main repo; it never
    # requires reading the worktree. Decide it FIRST so a worktree that is
    # not a disposal candidate is never blocked over its own unreadable
    # dirty state. Reordered per TP bounce on 3d90a3b: an unrelated
    # worktree with a corrupt .git pointer must not block the whole push.
    if ! _is_content_present "$_branch" "$TRUNK_REF"; then
      continue
    fi
  else
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "could not determine whether $_branch is an ancestor of $TRUNK_REF (git merge-base --is-ancestor exited $_anc_status). Not treating an instrument failure as not-an-ancestor."
    exit 1
  fi

  # DEFECT 5 (_R1#167 G1_BOUNCE 2): a DISPUTED verdict means cherry (ancestry)
  # fired but reverse-apply (content, checked directly against trunk's tree)
  # disagreed. Report the disagreement and stop for this branch, before the
  # hold check or any dirty/locked worktree logic -- none of that changes
  # the answer, because no disposal command is going to be printed either
  # way. Byte-identical to the destructive-case regression bed: the reverted
  # arm must render this, never "Disposal: git branch -D $_branch".
  if [ "$_CONTENT_MODE" = "disputed" ]; then
    _block "branch DISPUTED: $_branch matches $TRUNK_REF's history by patch-id (git cherry) but reverse-apply could not confirm its content is present in $TRUNK_REF's actual tree. Detectors disagree -- this can mean the change landed on $TRUNK_REF and was later reverted, leaving $_branch the only remaining copy, or it can mean reverse-apply's own known gap (an append past a hunk boundary trunk has since grown past). No disposal command. Needs manual verification."
    continue
  fi

  # TP's own self-correction (_R1#167 G1_BOUNCE, after 4e7fa0ad): the hold
  # check runs HERE, only for a branch that has just been decided a real
  # disposal candidate, never earlier. Overwatch's actual requirement was
  # that a held ref never BECOME a disposal candidate, not that a held ref
  # refuse the run regardless of whether it was ever going near disposal.
  # TP's first relay of that requirement made every held branch refuse
  # every push, candidate or not -- measured on agency-doc-kit, where nine
  # refs sit under hold today and none of them would ever be recommended
  # for disposal, yet every push through this guard blocked anyway. A wall
  # that blocks a repo for weeks either gets bypassed with --no-verify or
  # gets "fixed" by deleting the hold file, and both outcomes are the
  # protection disappearing. So: a branch that is not content-present never
  # reaches this check at all (say nothing, it was never the guard's
  # business); a branch that IS content-present resolves its own tip and
  # checks the hold, and a held one gets the hold message printed IN PLACE
  # OF a disposal command, never in addition to a silent branch, and never
  # for a branch that would have been silent anyway.
  _branch_tip=$(_g rev-parse --verify --quiet "refs/heads/$_branch" 2>/dev/null)
  if [ -z "$_branch_tip" ]; then
    rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"
    _block "could not resolve $_branch's own tip commit (git rev-parse failed). Not treating an instrument failure as an unheld branch."
    exit 1
  fi
  if _is_held "$_branch" "$_branch_tip"; then
    _block "$_HOLD_MSG"
    continue
  fi

  _wt_path=$(awk -F"$_TAB" -v b="$_branch" '$1==b{print $2; exit}' "$_wt_map")
  _wt_locked=$(awk -F"$_TAB" -v b="$_branch" '$1==b{print $3; exit}' "$_wt_map")

  if [ -n "$_wt_path" ] && [ -n "$_wt_locked" ]; then
    # QA gap (_R1#167 G1_BOUNCE): git status reads fine on a locked
    # worktree, so this has to be checked before the dirty-state branches
    # below, not folded into them -- a locked worktree's dirty state is
    # genuinely knowable here, it just must never turn into a `remove
    # --force` (or `-f -f`) recommendation. A lock is a human saying do not
    # touch this; the guard's job is to report that, not to teach anyone
    # how to override a deliberate lock.
    _block "worktree LOCKED: $_branch ($_wt_path) already in $TRUNK_REF (detected via $_DETECTOR), but the worktree record is locked ($_wt_locked). No removal command. Its owner decides."
    continue
  fi

  if [ -n "$_wt_path" ]; then
    _count_dirty "$_wt_path"
    case "$_DIRTY_STATE" in
      unknown)
        # DEFECT 2: git status itself failed (e.g. a corrupt or unreadable
        # .git pointer). Zero-dirty and cannot-measure-dirty must never
        # render identically. Refused exactly like DISPOSABLE-BUT-DIRTY: no
        # removal command, owner decides.
        _block "worktree UNKNOWN dirty-state: $_branch ($_wt_path) -- $_DIRTY_UNKNOWN_REASON. No removal command. Its owner decides."
        continue
        ;;
      dirty)
        _block "worktree DISPOSABLE-BUT-DIRTY: $_branch ($_wt_path) already in $TRUNK_REF (detected via $_DETECTOR), holds $_DIRTY_COUNT uncommitted change(s). No removal command. Its owner decides."
        continue
        ;;
    esac
    _block "worktree already in $TRUNK_REF (detected via $_DETECTOR): $_branch ($_wt_path). Disposal: git worktree remove --force $(_shquote "$_wt_path")"
  elif [ "$_branch" = "$_main_branch" ]; then
    _block "branch already in $TRUNK_REF (detected via $_DETECTOR, checked out in the main worktree): $_branch. Disposal: git checkout $TRUNK_BRANCH && git branch -D $_branch"
  else
    _block "branch already in $TRUNK_REF (detected via $_DETECTOR): $_branch. Disposal: git branch -D $_branch"
  fi
done <"$_branches"

rm -f "$_wt_records" "$_wt_map" "$_branches" "$_hold_entries" "$_STDIN_FILE"

if [ "$_fail" -eq 0 ]; then
  _info "clean. No local branch or worktree is fully contained in $TRUNK_REF."
  exit 0
fi

echo "hygiene-guard: REFUSE. Fossil state found relative to $TRUNK_REF. See BLOCK line(s) above. Clean these up, then push again." >&2
exit 1
