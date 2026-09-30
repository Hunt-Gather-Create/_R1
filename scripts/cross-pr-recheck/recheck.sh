#!/usr/bin/env bash
# Posts or edits a stale-notice comment on each open PR targeting runway
# after a push moves the tip, _R1#190. Replaces the old rerun-based
# amplifier; see the calling workflow's header for why that approach was
# abandoned and what property this one still holds.
#
# Runs two ways. From the Actions job, on a real push, DRY_RUN unset,
# posting for real. From a person's own machine with their own gh auth,
# DRY_RUN=1, read only, printing what it would have done without posting
# or editing anything. Both paths run this exact file, so the dry run is
# never a separate reimplementation that can drift from what ships.
#
# Requires: gh, git, jq. Requires a checkout with full history, fetch
# depth 0, since the ancestry check below needs to walk from an arbitrary
# PR head back to an arbitrary runway commit, not just the last one.
set -euo pipefail

: "${GH_REPO:?GH_REPO must be set}"
: "${NEW_TIP:?NEW_TIP must be set, the new runway tip sha}"
CROSS_PR_RECHECK_BOUND="${CROSS_PR_RECHECK_BOUND:-15}"
DRY_RUN="${DRY_RUN:-0}"
MARKER="<!-- cross-pr-recheck -->"
# In the real Actions job, actions/checkout clones GH_REPO itself as
# origin, so origin is correct there. A person's own local clone of
# their own fork has origin pointing somewhere else, so REMOTE lets a
# local dry run point the fetch at whichever remote actually has
# GH_REPO, for example upstream, without this file diverging from what
# CI runs.
REMOTE="${REMOTE:-origin}"

if ! open_prs_json=$(gh pr list --repo "$GH_REPO" --base runway --state open --json number,headRefOid --limit 500); then
  echo "COULD NOT LIST OPEN PRS TARGETING RUNWAY. This is an infrastructure failure, not a zero-PRs pass. Failing red rather than reporting a quiet skip."
  exit 1
fi

# gh pr list can exit 0 and still hand back something that is not a
# list, the JSON literal null or an empty object being the two shapes
# seen in practice on the rerun-based version of this file. Same guard,
# carried over unchanged.
if ! echo "$open_prs_json" | jq -e 'type == "array"' >/dev/null; then
  echo "gh pr list returned something that is not a JSON array. Raw response: $open_prs_json. This is not the same as a confirmed zero. Failing red rather than treating a malformed response as an empty list."
  exit 1
fi

total=$(echo "$open_prs_json" | jq 'length')
echo "Found $total open PRs targeting runway."

if [ "$total" -eq 0 ]; then
  echo "No open PRs targeting runway. This is a confirmed zero from a successful listing, not a failed lookup, so this run is green."
  exit 0
fi

bounded_json=$(echo "$open_prs_json" | jq --argjson n "$CROSS_PR_RECHECK_BOUND" '.[0:$n]')
bounded_count=$(echo "$bounded_json" | jq 'length')
dropped_count=$((total - bounded_count))

if [ "$dropped_count" -gt 0 ]; then
  dropped_numbers=$(echo "$open_prs_json" | jq --argjson n "$CROSS_PR_RECHECK_BOUND" -c '.[$n:] | map(.number)')
  echo "BOUND is $CROSS_PR_RECHECK_BOUND open PRs per push. Dropping $dropped_count PRs past the bound, named here, not silently: $dropped_numbers"
fi

short_tip="${NEW_TIP:0:7}"
comment_body="$MARKER
Runway moved to \`$short_tip\` after this PR's last push. The checks above may be testing an older base. Push a new commit or rebase onto runway to re-test.

This comment is edited in place on each push to runway, never reposted. Posted by cross-pr-recheck.yml, _R1#190."

failures=0

while IFS= read -r pr; do
  number=$(echo "$pr" | jq -r '.number')
  head_sha=$(echo "$pr" | jq -r '.headRefOid')

  if ! git fetch --quiet "$REMOTE" "refs/pull/$number/head" 2>/tmp/cross-pr-recheck-fetch-err; then
    echo "COULD NOT FETCH PR #$number's head at $head_sha to check ancestry. Marking this job red rather than skipping it quietly."
    cat /tmp/cross-pr-recheck-fetch-err
    failures=$((failures + 1))
    continue
  fi
  fetched_head=$(git rev-parse FETCH_HEAD)

  ancestor_exit=0
  git merge-base --is-ancestor "$NEW_TIP" "$fetched_head" || ancestor_exit=$?

  if [ "$ancestor_exit" -eq 0 ]; then
    echo "PR #$number at $head_sha: already based on $short_tip or later. Skipping, its checks are current."
    continue
  elif [ "$ancestor_exit" -ne 1 ]; then
    echo "PR #$number at $head_sha: git merge-base --is-ancestor exited $ancestor_exit, neither a confirmed ancestor nor a confirmed non ancestor. Cannot determine staleness. Marking this job red rather than skipping it quietly."
    failures=$((failures + 1))
    continue
  fi

  echo "PR #$number at $head_sha: stale relative to $short_tip."

  if ! existing_comment_id=$(gh api "repos/$GH_REPO/issues/$number/comments" --paginate | jq -r --arg marker "$MARKER" '[.[] | select(.body | startswith($marker))] | .[0].id // empty'); then
    echo "COULD NOT LIST COMMENTS on PR #$number to find an existing marker comment. Marking this job red rather than skipping it quietly."
    failures=$((failures + 1))
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    if [ -n "$existing_comment_id" ]; then
      echo "DRY RUN: would EDIT comment $existing_comment_id on PR #$number with:"
    else
      echo "DRY RUN: would POST a new comment on PR #$number with:"
    fi
    echo "---"
    echo "$comment_body"
    echo "---"
    continue
  fi

  if [ -n "$existing_comment_id" ]; then
    if gh api -X PATCH "repos/$GH_REPO/issues/comments/$existing_comment_id" -f body="$comment_body" >/dev/null; then
      echo "PR #$number: edited existing stale-notice comment $existing_comment_id."
    else
      echo "COULD NOT EDIT comment $existing_comment_id on PR #$number. Marking this job red rather than skipping it quietly."
      failures=$((failures + 1))
    fi
  else
    if gh api -X POST "repos/$GH_REPO/issues/$number/comments" -f body="$comment_body" >/dev/null; then
      echo "PR #$number: posted a new stale-notice comment."
    else
      echo "COULD NOT POST a stale-notice comment on PR #$number. Marking this job red rather than skipping it quietly."
      failures=$((failures + 1))
    fi
  fi
done < <(echo "$bounded_json" | jq -c '.[]')

if [ "$failures" -gt 0 ]; then
  echo "$failures of $bounded_count PRs in the bounded set could not be checked or commented. Failing red rather than reporting a quiet pass."
  exit 1
fi

echo "Checked all $bounded_count PRs in the bounded set."
