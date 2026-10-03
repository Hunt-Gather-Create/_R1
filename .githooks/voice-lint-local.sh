# _R1#184: same fleet voice rule, extended to added lines in staged code
# files. The markdown-only arm above left 19 dash lines in .ts comments and
# report strings ungated. Same two code points, same refusal shape, the
# offending file type named in the message. One glob per loop pass so the
# message can name exactly which type tripped it, same as the markdown arm.
for _code_glob in '*.ts' '*.tsx' '*.js' '*.mjs' '*.sh'; do
  _added_code=$(git diff --cached --unified=0 --diff-filter=ACM -- "$_code_glob" 2>/dev/null | grep -E '^\+' | grep -v '^+++' || true)
  if [ -n "$_added_code" ]; then
    _code_hits=$(printf '%s\n' "$_added_code" | perl -CS -ne 'print if /[\x{2013}\x{2014}]/')
    if [ -n "$_code_hits" ]; then
      echo "pre-commit BLOCK (fleet voice): em/en dash in newly added $_code_glob. Rewrite with a period, comma, colon, or semicolon; never a hyphen or other stand-in."
      printf '%s\n' "$_code_hits" | head -5
      echo "Fix the flagged lines. If you believe the gate is wrong, ask Overwatch."
      exit 1
    fi
  fi
done
