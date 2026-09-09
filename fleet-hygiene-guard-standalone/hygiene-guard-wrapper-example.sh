#!/bin/sh
# hygiene-guard-wrapper-example.sh -- NOT a hook. This shows the one line an
# existing pre-push chain needs to call hygiene-guard.sh, matching the exact
# pattern opeff's own .githooks/pre-push already uses to call
# pre-push-corruption-guard.sh:
#
#   _guard="$(dirname "$0")/pre-push-corruption-guard.sh"
#   if [ -x "$_guard" ]; then
#     printf '%s\n' "$_ppstdin" | "$_guard" || exit 1
#   fi
#
# hygiene-guard.sh reads no stdin (git's ref lines are irrelevant to it: it
# inspects the repo's current branches and worktrees, not the specific refs
# being pushed), so its call site is even simpler than C2's. Drop this block
# into .githooks/pre-push, alongside the existing C2 corruption-guard call,
# ordered wherever the operator/Overwatch decide it should run in the chain
# (this file takes no position on ordering, that's their call, not this
# guard's):

_hygiene_guard="$(dirname "$0")/hygiene-guard.sh"
if [ -x "$_hygiene_guard" ]; then
  "$_hygiene_guard" || exit 1
elif [ -f "$_hygiene_guard" ]; then
  sh "$_hygiene_guard" || exit 1
else
  echo "pre-push WARN [hygiene-guard]: guard not found at $_hygiene_guard (push not guarded)." >&2
fi

# That's the whole integration: one existence check, one call, one
# `|| exit 1`. hygiene-guard.sh's own exit code IS the verdict (control D5);
# nothing here re-derives pass/fail from printed text.
